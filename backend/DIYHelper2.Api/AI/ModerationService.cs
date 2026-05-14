using System.Text.Json;
using System.Text.Json.Serialization;

namespace DIYHelper2.Api.AI;

/// <summary>
/// Thin wrapper over OpenAI's /v1/moderations endpoint. Used as a pre-check on
/// user-supplied text before it reaches GPT-4o, so prompts that violate the
/// usage policy (hate, sexual/minors, violence, self-harm, illicit) are
/// rejected at the edge rather than spending tokens on a refusal.
///
/// Fail-open on network error: if the moderation call itself fails, we let the
/// request through. This is a defense-in-depth layer, not the sole gate — a
/// moderation outage should not take the whole API down.
/// </summary>
public class ModerationService
{
    private readonly HttpClient _http;
    private readonly AiKeyStore _keys;
    private readonly ILogger<ModerationService> _logger;

    public ModerationService(HttpClient http, AiKeyStore keys, ILogger<ModerationService> logger)
    {
        _http = http;
        _keys = keys;
        _logger = logger;
        _http.Timeout = TimeSpan.FromSeconds(8);
    }

    public async Task<ModerationResult> CheckAsync(string? text, CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(text)) return ModerationResult.Allowed;
        if (string.IsNullOrEmpty(_keys.OpenAiKey)) return ModerationResult.Allowed;

        try
        {
            using var req = new HttpRequestMessage(HttpMethod.Post, "https://api.openai.com/v1/moderations");
            req.Headers.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", _keys.OpenAiKey);
            var payload = JsonSerializer.Serialize(new { model = "omni-moderation-latest", input = text });
            req.Content = new StringContent(payload, System.Text.Encoding.UTF8, "application/json");

            using var resp = await _http.SendAsync(req, ct);
            if (!resp.IsSuccessStatusCode)
            {
                _logger.LogWarning("Moderation API returned {Status}; failing open.", (int)resp.StatusCode);
                return ModerationResult.Allowed;
            }

            var body = await resp.Content.ReadAsStringAsync(ct);
            var parsed = JsonSerializer.Deserialize<ModerationResponse>(body);
            var result = parsed?.Results?.FirstOrDefault();
            if (result == null) return ModerationResult.Allowed;

            if (!result.Flagged) return ModerationResult.Allowed;

            var categories = (result.Categories ?? new())
                .Where(kv => kv.Value)
                .Select(kv => kv.Key)
                .ToArray();
            return new ModerationResult(false, categories);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Moderation check failed; failing open.");
            return ModerationResult.Allowed;
        }
    }

    private sealed class ModerationResponse
    {
        [JsonPropertyName("results")] public List<ModerationEntry>? Results { get; set; }
    }

    private sealed class ModerationEntry
    {
        [JsonPropertyName("flagged")] public bool Flagged { get; set; }
        [JsonPropertyName("categories")] public Dictionary<string, bool>? Categories { get; set; }
    }
}

public readonly record struct ModerationResult(bool IsAllowed, string[] FlaggedCategories)
{
    public static readonly ModerationResult Allowed = new(true, Array.Empty<string>());
}
