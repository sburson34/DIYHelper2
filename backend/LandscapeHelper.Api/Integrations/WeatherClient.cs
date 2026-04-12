using System.Collections.Concurrent;
using System.Text.Json;

namespace DIYHelper2.Api.Integrations;

public record WeatherDay(
    string Date,
    double TempF,
    double PrecipProb,
    double WindMph,
    string Condition,
    bool GoodForOutdoorWork
);

public record WeatherForecast(string Location, List<WeatherDay> Forecast);

public class WeatherClient
{
    private readonly HttpClient _http;
    private readonly ILogger<WeatherClient> _logger;
    private readonly string? _apiKey;

    // 1h cache keyed by zip+days
    private static readonly ConcurrentDictionary<string, (DateTime fetched, WeatherForecast forecast)> _cache = new();
    private static readonly TimeSpan _ttl = TimeSpan.FromHours(1);

    public WeatherClient(HttpClient http, ILogger<WeatherClient> logger)
    {
        _http = http;
        _logger = logger;
        _apiKey = Environment.GetEnvironmentVariable("OPENWEATHER_API_KEY");
    }

    public bool IsConfigured => !string.IsNullOrEmpty(_apiKey);

    public async Task<WeatherForecast?> GetForecastAsync(string zip, int days = 5, CancellationToken ct = default)
    {
        if (!IsConfigured || string.IsNullOrWhiteSpace(zip)) return null;
        var cacheKey = $"{zip}::{days}";
        if (_cache.TryGetValue(cacheKey, out var hit) && DateTime.UtcNow - hit.fetched < _ttl)
            return hit.forecast;

        try
        {
            // Geocode zip → lat/lon first
            var geoUrl = $"https://api.openweathermap.org/geo/1.0/zip?zip={Uri.EscapeDataString(zip)},US&appid={_apiKey}";
            using var geoResp = await _http.GetAsync(geoUrl, ct);
            if (!geoResp.IsSuccessStatusCode) return null;
            using var geoDoc = JsonDocument.Parse(await geoResp.Content.ReadAsStringAsync(ct));
            double lat = geoDoc.RootElement.GetProperty("lat").GetDouble();
            double lon = geoDoc.RootElement.GetProperty("lon").GetDouble();
            string locationName = geoDoc.RootElement.TryGetProperty("name", out var n) ? n.GetString() ?? zip : zip;

            // 5-day / 3-hour forecast (free tier)
            var fcUrl = $"https://api.openweathermap.org/data/2.5/forecast?lat={lat}&lon={lon}&units=imperial&appid={_apiKey}";
            using var fcResp = await _http.GetAsync(fcUrl, ct);
            if (!fcResp.IsSuccessStatusCode) return null;
            using var fcDoc = JsonDocument.Parse(await fcResp.Content.ReadAsStringAsync(ct));

            // Reduce 3-hour slots into per-day midday entries (approx noon)
            var byDay = new Dictionary<string, (double temp, double pop, double wind, string cond)>();
            if (fcDoc.RootElement.TryGetProperty("list", out var list) && list.ValueKind == JsonValueKind.Array)
            {
                foreach (var entry in list.EnumerateArray())
                {
                    string dt = entry.GetProperty("dt_txt").GetString() ?? "";
                    // Take the midday (12:00:00) slot as that day's representative
                    if (!dt.Contains("12:00:00")) continue;
                    string day = dt.Substring(0, 10);
                    double temp = entry.GetProperty("main").GetProperty("temp").GetDouble();
                    double pop = entry.TryGetProperty("pop", out var popEl) ? popEl.GetDouble() * 100 : 0;
                    double wind = entry.GetProperty("wind").GetProperty("speed").GetDouble();
                    string cond = "clear";
                    if (entry.TryGetProperty("weather", out var we) && we.ValueKind == JsonValueKind.Array)
                    {
                        foreach (var w in we.EnumerateArray())
                        {
                            if (w.TryGetProperty("main", out var mm)) cond = mm.GetString() ?? "clear";
                            break;
                        }
                    }
                    byDay[day] = (temp, pop, wind, cond);
                }
            }

            var forecast = new List<WeatherDay>();
            foreach (var kvp in byDay.OrderBy(k => k.Key).Take(days))
            {
                bool good = kvp.Value.pop < 30 && kvp.Value.wind < 15 && kvp.Value.temp >= 45 && kvp.Value.temp <= 90;
                forecast.Add(new WeatherDay(kvp.Key, kvp.Value.temp, kvp.Value.pop, kvp.Value.wind, kvp.Value.cond, good));
            }

            var result = new WeatherForecast(locationName, forecast);
            _cache[cacheKey] = (DateTime.UtcNow, result);
            return result;
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Weather lookup failed for zip {Zip}", zip);
            return null;
        }
    }
}
