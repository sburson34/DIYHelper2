using System.Collections.Concurrent;
using System.Text.Json;

namespace DIYHelper2.Api.Integrations;

public record ChemicalSafety(
    string Chemical,
    int? Cid,
    List<string> Hazards,
    List<string> GhsPictograms,
    string? FirstAid,
    string? Storage
);

public class PubChemClient
{
    private readonly HttpClient _http;
    private readonly ILogger<PubChemClient> _logger;

    private static readonly ConcurrentDictionary<string, (DateTime fetched, ChemicalSafety data)> _cache = new();
    private static readonly TimeSpan _ttl = TimeSpan.FromDays(7);

    public PubChemClient(HttpClient http, ILogger<PubChemClient> logger)
    {
        _http = http;
        _logger = logger;
    }

    public async Task<ChemicalSafety?> LookupAsync(string chemical, CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(chemical)) return null;
        var key = chemical.Trim().ToLowerInvariant();
        if (_cache.TryGetValue(key, out var hit) && DateTime.UtcNow - hit.fetched < _ttl)
            return hit.data;

        try
        {
            // 1) Resolve name → CID
            var cidUrl = $"https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/name/{Uri.EscapeDataString(chemical)}/cids/JSON";
            using var cidResp = await _http.GetAsync(cidUrl, ct);
            if (!cidResp.IsSuccessStatusCode) return null;
            using var cidDoc = JsonDocument.Parse(await cidResp.Content.ReadAsStringAsync(ct));
            int? cid = null;
            if (cidDoc.RootElement.TryGetProperty("IdentifierList", out var idl) &&
                idl.TryGetProperty("CID", out var cids) && cids.ValueKind == JsonValueKind.Array)
            {
                foreach (var c in cids.EnumerateArray()) { cid = c.GetInt32(); break; }
            }
            if (cid is null) return null;

            // 2) Fetch safety section
            var viewUrl = $"https://pubchem.ncbi.nlm.nih.gov/rest/pug_view/data/compound/{cid}/JSON?heading=GHS+Classification";
            using var viewResp = await _http.GetAsync(viewUrl, ct);
            var hazards = new List<string>();
            if (viewResp.IsSuccessStatusCode)
            {
                using var viewDoc = JsonDocument.Parse(await viewResp.Content.ReadAsStringAsync(ct));
                // Shallow traversal — collect any String values under the Record tree that look like hazard statements
                CollectHazardStrings(viewDoc.RootElement, hazards);
            }

            var safety = new ChemicalSafety(
                chemical,
                cid,
                hazards.Take(8).ToList(),
                new List<string>(),
                null,
                null
            );
            _cache[key] = (DateTime.UtcNow, safety);
            return safety;
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "PubChem lookup failed for {Chem}", chemical);
            return null;
        }
    }

    private static void CollectHazardStrings(JsonElement el, List<string> acc)
    {
        if (acc.Count > 20) return;
        if (el.ValueKind == JsonValueKind.Object)
        {
            foreach (var prop in el.EnumerateObject())
            {
                if (prop.Name == "String" && prop.Value.ValueKind == JsonValueKind.String)
                {
                    var s = prop.Value.GetString();
                    if (!string.IsNullOrEmpty(s) &&
                        (s.Contains("H3", StringComparison.Ordinal) || s.Contains("H2", StringComparison.Ordinal) ||
                         s.Contains("Causes", StringComparison.OrdinalIgnoreCase) ||
                         s.Contains("Harmful", StringComparison.OrdinalIgnoreCase) ||
                         s.Contains("Toxic", StringComparison.OrdinalIgnoreCase) ||
                         s.Contains("Flammable", StringComparison.OrdinalIgnoreCase) ||
                         s.Contains("Irritat", StringComparison.OrdinalIgnoreCase)))
                        acc.Add(s);
                }
                else
                {
                    CollectHazardStrings(prop.Value, acc);
                }
            }
        }
        else if (el.ValueKind == JsonValueKind.Array)
        {
            foreach (var child in el.EnumerateArray()) CollectHazardStrings(child, acc);
        }
    }
}
