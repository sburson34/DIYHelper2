using System.Collections.Concurrent;
using System.Text.Json;
using DIYHelper2.Api.Services;

namespace DIYHelper2.Api.Integrations;

public record GeocodeResult(double Lat, double Lng);

/// <summary>
/// Google Geocoding wrapper for job service addresses. Deliberately FAIL-SOFT:
/// any miss (no key configured, timeout, non-OK status, malformed payload)
/// returns null so bookings and console edits never fail on geocoding — the
/// job simply stays un-geocoded and lands in the route view's "unroutable"
/// bucket. Key comes from <see cref="RuntimeConfigStore.GoogleApiKey"/>
/// (populated post-Secrets-Manager; the Geocoding API must be enabled on it).
/// SSRF-guarded typed HttpClient like every other external integration.
/// </summary>
public class GeocodingClient
{
    // Successful lookups only (a transient failure shouldn't be pinned).
    // Static because typed clients are transient; addresses don't move, so no TTL.
    private static readonly ConcurrentDictionary<string, GeocodeResult> _cache =
        new(StringComparer.OrdinalIgnoreCase);

    private readonly HttpClient _http;
    private readonly RuntimeConfigStore _config;
    private readonly ILogger<GeocodingClient> _logger;

    public GeocodingClient(HttpClient http, RuntimeConfigStore config, ILogger<GeocodingClient> logger)
    {
        _http = http;
        _config = config;
        _logger = logger;
        // A geocode is a nice-to-have on the booking hot path — never let it
        // hold a customer's submit for longer than this.
        _http.Timeout = TimeSpan.FromSeconds(3);
    }

    public bool IsConfigured => !string.IsNullOrEmpty(_config.GoogleApiKey);

    public async Task<GeocodeResult?> GeocodeAsync(string? address, CancellationToken ct = default)
    {
        if (!IsConfigured || string.IsNullOrWhiteSpace(address)) return null;
        var key = address.Trim();
        if (_cache.TryGetValue(key, out var hit)) return hit;

        try
        {
            var url = "https://maps.googleapis.com/maps/api/geocode/json"
                + $"?address={Uri.EscapeDataString(key)}&key={_config.GoogleApiKey}";
            using var resp = await _http.GetAsync(url, ct);
            if (!resp.IsSuccessStatusCode) return null;

            using var doc = JsonDocument.Parse(await resp.Content.ReadAsStringAsync(ct));
            var root = doc.RootElement;
            if (root.TryGetProperty("status", out var status) && status.GetString() != "OK") return null;
            if (!root.TryGetProperty("results", out var results)
                || results.ValueKind != JsonValueKind.Array
                || results.GetArrayLength() == 0) return null;

            var location = results[0].GetProperty("geometry").GetProperty("location");
            var result = new GeocodeResult(
                location.GetProperty("lat").GetDouble(),
                location.GetProperty("lng").GetDouble());
            _cache[key] = result;
            return result;
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Geocoding failed for an address ({Length} chars).", key.Length);
            return null;
        }
    }
}
