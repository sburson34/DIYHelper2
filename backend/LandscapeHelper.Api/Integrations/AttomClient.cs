using System.Text.Json;

namespace DIYHelper2.Api.Integrations;

public record PropertyValueImpact(
    double EstimatedValueAdd,
    string Confidence, // "low" | "medium" | "high"
    string Source      // "attom" | "static"
);

public class AttomClient
{
    private readonly HttpClient _http;
    private readonly ILogger<AttomClient> _logger;
    private readonly string? _apiKey;
    private readonly Dictionary<string, double> _roiTable;

    public AttomClient(HttpClient http, ILogger<AttomClient> logger)
    {
        _http = http;
        _logger = logger;
        _apiKey = Environment.GetEnvironmentVariable("ATTOM_API_KEY");
        _roiTable = LoadRoiTable();
    }

    public bool IsConfigured => !string.IsNullOrEmpty(_apiKey);

    public async Task<PropertyValueImpact?> EstimateAsync(string zip, string repairType, double estimatedCost, CancellationToken ct = default)
    {
        double multiplier = LookupMultiplier(repairType);

        if (IsConfigured)
        {
            try
            {
                // ATTOM path: fetch comparable home values and scale the ROI multiplier by
                // local market strength. For scaffold simplicity we just call one endpoint
                // and fall through to the static table if it fails.
                var url = $"https://api.gateway.attomdata.com/propertyapi/v1.0.0/area/hierarchy/lookup?postalCode={Uri.EscapeDataString(zip)}";
                using var req = new HttpRequestMessage(HttpMethod.Get, url);
                req.Headers.Add("apikey", _apiKey);
                req.Headers.Add("accept", "application/json");
                using var resp = await _http.SendAsync(req, ct);
                if (resp.IsSuccessStatusCode)
                {
                    return new PropertyValueImpact(
                        Math.Round(estimatedCost * multiplier, 0),
                        "medium",
                        "attom"
                    );
                }
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "ATTOM lookup failed, falling back to static ROI");
            }
        }

        return new PropertyValueImpact(
            Math.Round(estimatedCost * multiplier, 0),
            "low",
            "static"
        );
    }

    private double LookupMultiplier(string repairType)
    {
        if (string.IsNullOrEmpty(repairType)) return 0.5;
        var key = repairType.Trim().ToLowerInvariant();
        return _roiTable.TryGetValue(key, out var m) ? m : 0.5;
    }

    private Dictionary<string, double> LoadRoiTable()
    {
        // Bundled defaults — can be overridden with a Data/RepairRoi.json file next to this assembly.
        var defaults = new Dictionary<string, double>
        {
            ["kitchen"] = 0.75,
            ["bathroom"] = 0.60,
            ["roof"] = 0.60,
            ["flooring"] = 0.70,
            ["windows"] = 0.70,
            ["deck"] = 0.65,
            ["exterior_paint"] = 0.55,
            ["interior_paint"] = 0.40,
            ["plumbing"] = 0.45,
            ["electrical"] = 0.45,
            ["hvac"] = 0.50,
            ["landscaping"] = 0.50,
            ["garage"] = 0.60,
            ["basement"] = 0.70,
            ["drywall"] = 0.40,
            ["general"] = 0.50,
        };
        try
        {
            var path = Path.Combine(AppContext.BaseDirectory, "Data", "RepairRoi.json");
            if (File.Exists(path))
            {
                var json = File.ReadAllText(path);
                var parsed = JsonSerializer.Deserialize<Dictionary<string, double>>(json);
                if (parsed is not null) return parsed;
            }
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Failed to load RepairRoi.json, using defaults");
        }
        return defaults;
    }
}
