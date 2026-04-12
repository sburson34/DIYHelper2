using System.Text.Json;

namespace DIYHelper2.Api.Integrations;

public record PaintColor(string Brand, string Name, string Code, string Hex);

public record PaintMatch(string Brand, string Name, string Code, string Hex, double DeltaE);

public record PaintMatchResult(string DominantHex, List<PaintMatch> Matches);

public class PaintColorClient
{
    private readonly ILogger<PaintColorClient> _logger;
    private readonly List<PaintColor> _palette;

    public PaintColorClient(ILogger<PaintColorClient> logger)
    {
        _logger = logger;
        _palette = LoadPalette();
    }

    public PaintMatchResult Match(byte[] imageBytes, int topK = 3)
    {
        // Pure .NET dominant-color extraction without ImageSharp: JPEG decode is not in
        // the BCL, so instead we use a deterministic block-average over the raw bytes.
        // This is crude but works well enough for scaffold. When ImageSharp is added as a
        // dependency, swap this for a proper pixel-level average in LAB space.
        var dominant = CrudeDominantHex(imageBytes);
        var (dr, dg, db) = HexToRgb(dominant);
        var (dl, da, dbLab) = RgbToLab(dr, dg, db);

        var matches = _palette
            .Select(p =>
            {
                var (pr, pg, pb) = HexToRgb(p.Hex);
                var (pl, paL, pbLab) = RgbToLab(pr, pg, pb);
                var dE = DeltaE76(dl, da, dbLab, pl, paL, pbLab);
                return new PaintMatch(p.Brand, p.Name, p.Code, p.Hex, Math.Round(dE, 2));
            })
            .OrderBy(m => m.DeltaE)
            .Take(topK)
            .ToList();

        return new PaintMatchResult(dominant, matches);
    }

    // ── crude dominant color: sample bytes, bin into 4-bit buckets, return most-common ──
    private string CrudeDominantHex(byte[] data)
    {
        var buckets = new Dictionary<int, int>();
        // Skip JPEG header noise, step through the data
        for (int i = 512; i + 3 < data.Length; i += 199)
        {
            int r = data[i] & 0xF0;
            int g = data[i + 1] & 0xF0;
            int b = data[i + 2] & 0xF0;
            int key = (r << 16) | (g << 8) | b;
            buckets[key] = buckets.TryGetValue(key, out var c) ? c + 1 : 1;
        }
        if (buckets.Count == 0) return "#808080";
        var top = buckets.OrderByDescending(kv => kv.Value).First().Key;
        int rr = (top >> 16) & 0xFF;
        int gg = (top >> 8) & 0xFF;
        int bb = top & 0xFF;
        return $"#{rr:X2}{gg:X2}{bb:X2}";
    }

    private static (int r, int g, int b) HexToRgb(string hex)
    {
        hex = hex.TrimStart('#');
        if (hex.Length != 6) return (128, 128, 128);
        return (
            Convert.ToInt32(hex.Substring(0, 2), 16),
            Convert.ToInt32(hex.Substring(2, 2), 16),
            Convert.ToInt32(hex.Substring(4, 2), 16)
        );
    }

    private static (double L, double a, double b) RgbToLab(int r, int g, int b)
    {
        double rn = r / 255.0, gn = g / 255.0, bn = b / 255.0;
        rn = rn > 0.04045 ? Math.Pow((rn + 0.055) / 1.055, 2.4) : rn / 12.92;
        gn = gn > 0.04045 ? Math.Pow((gn + 0.055) / 1.055, 2.4) : gn / 12.92;
        bn = bn > 0.04045 ? Math.Pow((bn + 0.055) / 1.055, 2.4) : bn / 12.92;
        double x = (rn * 0.4124 + gn * 0.3576 + bn * 0.1805) / 0.95047;
        double y = (rn * 0.2126 + gn * 0.7152 + bn * 0.0722) / 1.00000;
        double z = (rn * 0.0193 + gn * 0.1192 + bn * 0.9505) / 1.08883;
        x = x > 0.008856 ? Math.Pow(x, 1.0 / 3) : (7.787 * x) + 16.0 / 116;
        y = y > 0.008856 ? Math.Pow(y, 1.0 / 3) : (7.787 * y) + 16.0 / 116;
        z = z > 0.008856 ? Math.Pow(z, 1.0 / 3) : (7.787 * z) + 16.0 / 116;
        return ((116 * y) - 16, 500 * (x - y), 200 * (y - z));
    }

    private static double DeltaE76(double l1, double a1, double b1, double l2, double a2, double b2)
    {
        var dl = l1 - l2;
        var da = a1 - a2;
        var db = b1 - b2;
        return Math.Sqrt(dl * dl + da * da + db * db);
    }

    private List<PaintColor> LoadPalette()
    {
        try
        {
            var path = Path.Combine(AppContext.BaseDirectory, "Data", "PaintColors.json");
            if (File.Exists(path))
            {
                var json = File.ReadAllText(path);
                var parsed = JsonSerializer.Deserialize<List<PaintColor>>(json, new JsonSerializerOptions
                {
                    PropertyNameCaseInsensitive = true
                });
                if (parsed is not null && parsed.Count > 0) return parsed;
            }
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Failed to load PaintColors.json, using defaults");
        }
        return DefaultPalette();
    }

    private static List<PaintColor> DefaultPalette() => new()
    {
        new("Sherwin-Williams", "Alabaster", "SW 7008", "#EDEAE0"),
        new("Sherwin-Williams", "Agreeable Gray", "SW 7029", "#D1C7B8"),
        new("Sherwin-Williams", "Pure White", "SW 7005", "#EDECE6"),
        new("Sherwin-Williams", "Naval", "SW 6244", "#3C4A5E"),
        new("Sherwin-Williams", "Repose Gray", "SW 7015", "#CCC6BB"),
        new("Sherwin-Williams", "Tricorn Black", "SW 6258", "#2F2F2F"),
        new("Sherwin-Williams", "Rainwashed", "SW 6211", "#BFD0C7"),
        new("Sherwin-Williams", "Accessible Beige", "SW 7036", "#D0C3AE"),
        new("Benjamin Moore", "Simply White", "OC-117", "#EFEFE4"),
        new("Benjamin Moore", "Hale Navy", "HC-154", "#434F5C"),
        new("Benjamin Moore", "Revere Pewter", "HC-172", "#CCC3B1"),
        new("Benjamin Moore", "Chantilly Lace", "OC-65", "#F4F4EF"),
        new("Benjamin Moore", "White Dove", "OC-17", "#EFEDE1"),
        new("Benjamin Moore", "Wrought Iron", "2124-10", "#3E3E3C"),
        new("Benjamin Moore", "Classic Gray", "OC-23", "#DFDAD1"),
        new("Benjamin Moore", "Edgecomb Gray", "HC-173", "#D3C9B9"),
        new("Behr", "Ultra Pure White", "PPU18-06", "#FFFFFF"),
        new("Behr", "Silver Drop", "790C-2", "#E2E0D7"),
        new("Behr", "Swiss Coffee", "12", "#EFE9DB"),
        new("Behr", "Cracked Pepper", "PPU18-01", "#424141"),
        new("Behr", "Blank Canvas", "DC-003", "#EEE9DB"),
        new("Behr", "Modern White", "HDC-MD-22", "#E5E1D3"),
        new("Farrow & Ball", "Pigeon", "25", "#9A9B8F"),
        new("Farrow & Ball", "Strong White", "2001", "#E5DFD2"),
        new("Farrow & Ball", "Downpipe", "26", "#5F6265"),
    };
}
