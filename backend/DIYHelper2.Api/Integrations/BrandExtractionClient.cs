using System.Text.RegularExpressions;

namespace DIYHelper2.Api.Integrations;

/// <summary>Draft brand identity scraped from a company's website. Every field
/// is best-effort — the Brand Studio shows it as a starting point a human
/// confirms/adjusts, never a finished config.</summary>
public record BrandExtractionResult(
    string Url,
    string? CompanyName,
    string? Primary,
    string? Secondary,
    string? Accent,
    List<string> ColorCandidates,
    string? Logo,
    List<string> LogoCandidates,
    List<string> Fonts,
    string? PrivacyPolicyUrl,
    string? TermsUrl,
    List<string> Warnings);

/// <summary>
/// Scrapes a customer's website to seed a white-label brand: dominant brand
/// colors, logo, company name, fonts, and legal links. Runs through the shared
/// <c>SsrfGuardHandler</c> (registered in Program.cs) so a hostile/typo'd URL
/// can't be bounced at instance metadata or loopback. Fully fail-soft: any
/// fetch/parse failure yields a partial result with a warning, never a throw.
/// </summary>
public class BrandExtractionClient
{
    private const int MaxHtmlBytes = 3 * 1024 * 1024;
    private const int MaxCssFiles = 3;

    private readonly HttpClient _http;
    private readonly ILogger<BrandExtractionClient> _logger;

    public BrandExtractionClient(HttpClient http, ILogger<BrandExtractionClient> logger)
    {
        _http = http;
        _logger = logger;
        _http.Timeout = TimeSpan.FromSeconds(10);
        _http.MaxResponseContentBufferSize = MaxHtmlBytes;
        // A real UA — some sites 403 the default .NET client.
        if (!_http.DefaultRequestHeaders.UserAgent.Any())
            _http.DefaultRequestHeaders.UserAgent.ParseAdd("Mozilla/5.0 (compatible; BrandStudioBot/1.0)");
    }

    public async Task<BrandExtractionResult> ExtractAsync(Uri url, CancellationToken ct = default)
    {
        var warnings = new List<string>();
        string html;
        try
        {
            html = await _http.GetStringAsync(url, ct);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Brand extraction failed to fetch {Url}", url);
            return new BrandExtractionResult(url.ToString(), null, null, null, null,
                new(), null, new(), new(), null, null,
                new() { "Could not load that site. Check the URL, or enter the brand details by hand." });
        }

        var companyName = FirstGroup(html,
            @"<meta[^>]+property=[""']og:site_name[""'][^>]+content=[""']([^""']+)[""']")
            ?? CleanTitle(FirstGroup(html, @"<title[^>]*>([^<]+)</title>"));

        // Gather colors from the HTML and a few same-origin stylesheets.
        var colorText = html;
        foreach (var css in CssLinks(html, url).Take(MaxCssFiles))
        {
            try { colorText += "\n" + await _http.GetStringAsync(css, ct); }
            catch { /* one bad stylesheet shouldn't fail the whole extraction */ }
        }

        var themeColor = FirstGroup(html, @"<meta[^>]+name=[""']theme-color[""'][^>]+content=[""']([^""']+)[""']");
        var ranked = RankBrandColors(colorText, themeColor);
        var primary = ranked.ElementAtOrDefault(0);
        var secondary = ranked.ElementAtOrDefault(1);
        var accent = ranked.ElementAtOrDefault(2);
        if (primary is null)
            warnings.Add("Couldn't detect a clear brand color — pick one from the site by hand.");

        var logos = LogoCandidates(html, url);
        if (logos.Count == 0)
            warnings.Add("No logo found automatically. Upload the company's logo instead.");

        var fonts = Fonts(html, colorText);
        var privacy = FindLegalLink(html, url, "privacy");
        var terms = FindLegalLink(html, url, "terms");

        return new BrandExtractionResult(
            url.ToString(), companyName,
            primary, secondary, accent, ranked,
            logos.FirstOrDefault(), logos,
            fonts, privacy, terms, warnings);
    }

    // ── Color ranking ────────────────────────────────────────────────
    // Collect every hex / rgb() color, count frequency, drop near-grayscale and
    // near-white/black (those are backgrounds/text, not brand), and return the
    // most-used saturated colors as primary/secondary/accent. A theme-color meta
    // is a strong signal, so it's forced to the front.
    private static List<string> RankBrandColors(string text, string? themeColor)
    {
        var counts = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);

        foreach (Match m in Regex.Matches(text, @"#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b"))
            Bump(counts, NormalizeHex(m.Groups[1].Value));

        foreach (Match m in Regex.Matches(text, @"rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})", RegexOptions.IgnoreCase))
        {
            var hex = RgbToHex(m.Groups[1].Value, m.Groups[2].Value, m.Groups[3].Value);
            if (hex != null) Bump(counts, hex);
        }

        var ranked = counts
            .Select(kv => (Hex: kv.Key, Count: kv.Value))
            .Where(c => IsBrandCandidate(c.Hex))
            .OrderByDescending(c => c.Count)
            .Select(c => c.Hex)
            .ToList();

        // De-duplicate near-identical hues so secondary/accent are visibly distinct.
        var distinct = new List<string>();
        foreach (var hex in ranked)
        {
            if (distinct.Any(d => HueClose(d, hex))) continue;
            distinct.Add(hex);
            if (distinct.Count >= 6) break;
        }

        var themeHex = NormalizeHex(themeColor);
        if (themeHex != null && IsBrandCandidate(themeHex))
        {
            distinct.RemoveAll(d => string.Equals(d, themeHex, StringComparison.OrdinalIgnoreCase));
            distinct.Insert(0, themeHex);
        }
        return distinct;
    }

    private static void Bump(Dictionary<string, int> d, string? hex)
    {
        if (hex == null) return;
        d[hex] = d.TryGetValue(hex, out var n) ? n + 1 : 1;
    }

    private static bool IsBrandCandidate(string hex)
    {
        var (r, g, b) = Rgb(hex);
        var (h, s, l) = ToHsl(r, g, b);
        // Skip grays (low saturation) and near-white/near-black (backgrounds/text).
        return s >= 0.18 && l >= 0.12 && l <= 0.88;
    }

    private static bool HueClose(string a, string b)
    {
        var (ra, ga, ba) = Rgb(a);
        var (rb, gb, bb) = Rgb(b);
        var (ha, _, la) = ToHsl(ra, ga, ba);
        var (hb, _, lb) = ToHsl(rb, gb, bb);
        var dh = Math.Abs(ha - hb);
        dh = Math.Min(dh, 360 - dh);
        return dh < 18 && Math.Abs(la - lb) < 0.18;
    }

    // ── Logos ────────────────────────────────────────────────────────
    private static List<string> LogoCandidates(string html, Uri baseUri)
    {
        var found = new List<string>();
        void Add(string? href) { var abs = Absolute(href, baseUri); if (abs != null && !found.Contains(abs)) found.Add(abs); }

        // Apple touch icon and og:image are usually the highest-res marks.
        foreach (Match m in Regex.Matches(html, @"<link[^>]+rel=[""'][^""']*apple-touch-icon[^""']*[""'][^>]*>", RegexOptions.IgnoreCase))
            Add(FirstGroup(m.Value, @"href=[""']([^""']+)[""']"));
        Add(FirstGroup(html, @"<meta[^>]+property=[""']og:image[""'][^>]+content=[""']([^""']+)[""']"));
        foreach (Match m in Regex.Matches(html, @"<link[^>]+rel=[""'][^""']*icon[^""']*[""'][^>]*>", RegexOptions.IgnoreCase))
            Add(FirstGroup(m.Value, @"href=[""']([^""']+)[""']"));
        // A header <img> whose src/alt/class mentions "logo".
        foreach (Match m in Regex.Matches(html, @"<img[^>]+>", RegexOptions.IgnoreCase))
            if (Regex.IsMatch(m.Value, @"logo", RegexOptions.IgnoreCase))
                Add(FirstGroup(m.Value, @"src=[""']([^""']+)[""']"));

        return found.Take(6).ToList();
    }

    private static List<string> Fonts(string html, string css)
    {
        var fonts = new List<string>();
        // Google Fonts <link href="...family=Inter:...">
        foreach (Match m in Regex.Matches(html, @"fonts\.googleapis\.com/css2?\?[^""']*family=([^""'&:]+)", RegexOptions.IgnoreCase))
            AddFont(fonts, Uri.UnescapeDataString(m.Groups[1].Value).Replace('+', ' '));
        // First non-generic font-family in CSS.
        foreach (Match m in Regex.Matches(css, @"font-family\s*:\s*([^;}""']+)", RegexOptions.IgnoreCase))
        {
            var first = m.Groups[1].Value.Split(',')[0].Trim().Trim('"', '\'');
            if (!string.IsNullOrWhiteSpace(first) && !IsGenericFont(first)) { AddFont(fonts, first); }
            if (fonts.Count >= 4) break;
        }
        return fonts.Take(4).ToList();
    }

    private static void AddFont(List<string> fonts, string name)
    {
        name = name.Trim();
        if (name.Length is > 1 and < 40 && !fonts.Contains(name, StringComparer.OrdinalIgnoreCase))
            fonts.Add(name);
    }

    private static bool IsGenericFont(string f) =>
        new[] { "inherit", "initial", "sans-serif", "serif", "monospace", "system-ui", "-apple-system", "cursive" }
            .Contains(f.ToLowerInvariant());

    private static string? FindLegalLink(string html, Uri baseUri, string keyword)
    {
        foreach (Match m in Regex.Matches(html, @"<a[^>]+href=[""']([^""']+)[""'][^>]*>(.*?)</a>", RegexOptions.IgnoreCase | RegexOptions.Singleline))
        {
            var href = m.Groups[1].Value;
            var textAndHref = href + " " + m.Groups[2].Value;
            if (Regex.IsMatch(textAndHref, keyword, RegexOptions.IgnoreCase))
                return Absolute(href, baseUri);
        }
        return null;
    }

    private static IEnumerable<Uri> CssLinks(string html, Uri baseUri)
    {
        // Most sites serve their CSS from a CDN (a different host), which is
        // where the brand colors live. Follow those too — the SsrfGuardHandler
        // still blocks internal/loopback targets, and MaxCssFiles caps the fan-out.
        // Prefer same-origin first (usually the site's own theme).
        var links = new List<Uri>();
        foreach (Match m in Regex.Matches(html, @"<link[^>]+rel=[""']stylesheet[""'][^>]*>", RegexOptions.IgnoreCase))
        {
            var href = FirstGroup(m.Value, @"href=[""']([^""']+)[""']");
            var abs = Absolute(href, baseUri);
            if (abs != null && Uri.TryCreate(abs, UriKind.Absolute, out var uri)
                && (uri.Scheme == Uri.UriSchemeHttp || uri.Scheme == Uri.UriSchemeHttps))
                links.Add(uri);
        }
        return links.OrderByDescending(u => u.Host == baseUri.Host);
    }

    // ── Small helpers ────────────────────────────────────────────────
    private static string? FirstGroup(string input, string pattern)
    {
        var m = Regex.Match(input, pattern, RegexOptions.IgnoreCase | RegexOptions.Singleline);
        return m.Success ? m.Groups[1].Value.Trim() : null;
    }

    private static string? CleanTitle(string? title)
    {
        if (string.IsNullOrWhiteSpace(title)) return null;
        // "Acme Home | Deck builders" -> "Acme Home"
        var cut = title.Split('|', '–', '—', '-')[0].Trim();
        return string.IsNullOrWhiteSpace(cut) ? title.Trim() : cut;
    }

    private static string? Absolute(string? href, Uri baseUri)
    {
        if (string.IsNullOrWhiteSpace(href) || href.StartsWith("data:")) return null;
        return Uri.TryCreate(baseUri, href, out var abs) ? abs.ToString() : null;
    }

    private static string? NormalizeHex(string? value)
    {
        if (string.IsNullOrWhiteSpace(value)) return null;
        var hex = value.Trim().TrimStart('#');
        if (hex.Length == 3) hex = $"{hex[0]}{hex[0]}{hex[1]}{hex[1]}{hex[2]}{hex[2]}";
        return Regex.IsMatch(hex, "^[0-9a-fA-F]{6}$") ? "#" + hex.ToUpperInvariant() : null;
    }

    private static string? RgbToHex(string r, string g, string b) =>
        int.TryParse(r, out var ri) && int.TryParse(g, out var gi) && int.TryParse(b, out var bi)
        && ri <= 255 && gi <= 255 && bi <= 255
            ? $"#{ri:X2}{gi:X2}{bi:X2}"
            : null;

    private static (int r, int g, int b) Rgb(string hex)
    {
        var h = hex.TrimStart('#');
        return (Convert.ToInt32(h.Substring(0, 2), 16),
                Convert.ToInt32(h.Substring(2, 2), 16),
                Convert.ToInt32(h.Substring(4, 2), 16));
    }

    private static (double h, double s, double l) ToHsl(int r, int g, int b)
    {
        double rn = r / 255.0, gn = g / 255.0, bn = b / 255.0;
        double max = Math.Max(rn, Math.Max(gn, bn)), min = Math.Min(rn, Math.Min(gn, bn));
        double l = (max + min) / 2, h = 0, s = 0;
        if (max != min)
        {
            var d = max - min;
            s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
            if (max == rn) h = (gn - bn) / d + (gn < bn ? 6 : 0);
            else if (max == gn) h = (bn - rn) / d + 2;
            else h = (rn - gn) / d + 4;
            h *= 60;
        }
        return (h, s, l);
    }
}
