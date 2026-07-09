using System.Net;
using System.Text.Json;
using DIYHelper2.Tests.Infrastructure;

namespace DIYHelper2.Tests.Integration;

/// <summary>
/// Brand Studio's website scraper: given a customer URL it seeds colors, logo,
/// company name, fonts, and legal links. The site fetch is stubbed via
/// <see cref="ApiFactory.FakeBrandExtractHandler"/> so nothing hits the network.
/// </summary>
public class BrandExtractionTests : IClassFixture<ApiFactory>
{
    private readonly ApiFactory _factory;

    public BrandExtractionTests(ApiFactory factory) => _factory = factory;

    // Uses example.com because the SSRF guard (still in the client chain during
    // tests) resolves the host for real — a non-resolving TLD would be treated
    // as unreachable. The response body is still the fake below.
    private const string SampleHtml = """
        <html><head>
          <title>Acme Home Services | Deck &amp; Patio Builders</title>
          <meta property="og:site_name" content="Acme Home">
          <meta name="theme-color" content="#2E7D32">
          <link rel="apple-touch-icon" href="/img/logo-192.png">
          <meta property="og:image" content="https://example.com/og.png">
          <link rel="stylesheet" href="https://example.com/site.css">
          <link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;700&display=swap" rel="stylesheet">
        </head><body>
          <header><img src="/img/acme-logo.svg" alt="Acme logo"></header>
          <a href="/privacy-policy">Privacy Policy</a>
          <a href="/terms">Terms of Service</a>
          <button style="background:#2E7D32;color:#fff">Get a quote</button>
          <span style="color:#F9A825">Save today</span>
        </body></html>
        """;

    // A stylesheet reinforcing the brand green plus an amber accent.
    private const string SampleCss = """
        :root { --brand: #2E7D32; }
        .btn { background:#2E7D32; }
        .cta { background:#2E7D32; }
        .badge { background:#F9A825; color:#111; }
        body { background:#ffffff; color:#222222; font-family: Poppins, sans-serif; }
        """;

    private void StubSite()
    {
        _factory.FakeBrandExtractHandler.Responder = req =>
        {
            var path = req.RequestUri?.AbsolutePath ?? "";
            var body = path.EndsWith(".css") ? SampleCss : SampleHtml;
            return Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK)
            {
                Content = new StringContent(body, System.Text.Encoding.UTF8, path.EndsWith(".css") ? "text/css" : "text/html"),
            });
        };
    }

    [Fact]
    public async Task Extract_PullsColorsLogoNameFontsAndLegalLinks()
    {
        StubSite();
        var admin = _factory.CreateAdminClient();
        var resp = await admin.GetAsync("/api/brands/extract?url=https://example.com");
        Assert.Equal(HttpStatusCode.OK, resp.StatusCode);

        var json = JsonDocument.Parse(await resp.Content.ReadAsStringAsync()).RootElement;

        // theme-color wins primary; amber shows up as another candidate.
        Assert.Equal("#2E7D32", json.GetProperty("primary").GetString());
        var candidates = json.GetProperty("colorCandidates").EnumerateArray().Select(e => e.GetString()).ToList();
        Assert.Contains("#2E7D32", candidates);
        Assert.Contains("#F9A825", candidates);
        // Neutral background/text must NOT be treated as brand colors.
        Assert.DoesNotContain("#FFFFFF", candidates);
        Assert.DoesNotContain("#222222", candidates);

        Assert.Equal("Acme Home", json.GetProperty("companyName").GetString());

        var logos = json.GetProperty("logoCandidates").EnumerateArray().Select(e => e.GetString()!).ToList();
        Assert.Contains(logos, l => l.Contains("logo-192.png"));    // apple-touch-icon, resolved absolute
        Assert.All(logos, l => Assert.StartsWith("https://example.com/", l));

        var fonts = json.GetProperty("fonts").EnumerateArray().Select(e => e.GetString()).ToList();
        Assert.Contains("Poppins", fonts);

        Assert.Contains("privacy", json.GetProperty("privacyPolicyUrl").GetString()!, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("terms", json.GetProperty("termsUrl").GetString()!, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task Extract_RejectsNonHttpUrl()
    {
        var admin = _factory.CreateAdminClient();
        Assert.Equal(HttpStatusCode.BadRequest, (await admin.GetAsync("/api/brands/extract?url=ftp://x")).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await admin.GetAsync("/api/brands/extract?url=not-a-url")).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await admin.GetAsync("/api/brands/extract")).StatusCode);
    }

    [Fact]
    public async Task Extract_FailsSoft_WhenSiteUnreachable()
    {
        _factory.FakeBrandExtractHandler.Responder = _ => throw new HttpRequestException("dns fail");
        var admin = _factory.CreateAdminClient();
        var resp = await admin.GetAsync("/api/brands/extract?url=https://unreachable.example");
        Assert.Equal(HttpStatusCode.OK, resp.StatusCode);   // graceful, not a 500
        var json = JsonDocument.Parse(await resp.Content.ReadAsStringAsync()).RootElement;
        Assert.True(json.GetProperty("warnings").GetArrayLength() > 0);
        Assert.True(json.GetProperty("primary").ValueKind == JsonValueKind.Null);
    }

    [Fact]
    public async Task Extract_RequiresAdminAuth()
    {
        var anon = _factory.CreateClient();
        Assert.Equal(HttpStatusCode.Unauthorized, (await anon.GetAsync("/api/brands/extract?url=https://example.com")).StatusCode);
    }

    [Fact]
    public async Task ProxyImage_ReturnsImageBytes_ForImageContentType()
    {
        var png = new byte[] { 0x89, 0x50, 0x4E, 0x47, 1, 2, 3, 4 }; // PNG magic + filler
        _factory.FakeBrandExtractHandler.Responder = _ => Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK)
        {
            Content = new ByteArrayContent(png).WithType("image/png"),
        });

        var admin = _factory.CreateAdminClient();
        var resp = await admin.GetAsync("/api/brands/proxy-image?url=https://example.com/logo.png");
        Assert.Equal(HttpStatusCode.OK, resp.StatusCode);
        Assert.Equal("image/png", resp.Content.Headers.ContentType?.MediaType);
        Assert.Equal(png, await resp.Content.ReadAsByteArrayAsync());
    }

    [Fact]
    public async Task ProxyImage_Rejects_NonImageContent()
    {
        _factory.FakeBrandExtractHandler.Responder = _ => Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK)
        {
            Content = new StringContent("<html>not an image</html>", System.Text.Encoding.UTF8, "text/html"),
        });
        var admin = _factory.CreateAdminClient();
        Assert.Equal(HttpStatusCode.NotFound, (await admin.GetAsync("/api/brands/proxy-image?url=https://example.com/x")).StatusCode);
    }

    [Fact]
    public async Task ProxyImage_RequiresAuth_AndValidUrl()
    {
        Assert.Equal(HttpStatusCode.Unauthorized,
            (await _factory.CreateClient().GetAsync("/api/brands/proxy-image?url=https://example.com/x.png")).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest,
            (await _factory.CreateAdminClient().GetAsync("/api/brands/proxy-image?url=notaurl")).StatusCode);
    }
}

internal static class ByteContentExtensions
{
    public static ByteArrayContent WithType(this ByteArrayContent c, string mediaType)
    {
        c.Headers.ContentType = new System.Net.Http.Headers.MediaTypeHeaderValue(mediaType);
        return c;
    }
}
