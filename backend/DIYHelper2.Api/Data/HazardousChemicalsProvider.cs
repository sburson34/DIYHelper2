using System.Text.Json;

namespace DIYHelper2.Api.Data;

/// <summary>
/// Hazardous-chemical keyword list loaded once at startup for PubChem
/// enrichment in /api/analyze. Missing/malformed data file degrades to an
/// empty set (no enrichment) rather than failing startup — same semantics as
/// the original Program.cs local.
/// </summary>
public class HazardousChemicalsProvider
{
    public IReadOnlySet<string> Names { get; }

    public HazardousChemicalsProvider()
    {
        HashSet<string> names;
        try
        {
            var hazPath = Path.Combine(AppContext.BaseDirectory, "Data", "HazardousChemicals.json");
            if (File.Exists(hazPath))
            {
                var list = JsonSerializer.Deserialize<List<string>>(File.ReadAllText(hazPath)) ?? new();
                names = new HashSet<string>(list.Select(s => s.ToLowerInvariant()));
            }
            else
            {
                names = new HashSet<string>();
            }
        }
        catch
        {
            names = new HashSet<string>();
        }
        Names = names;
    }
}
