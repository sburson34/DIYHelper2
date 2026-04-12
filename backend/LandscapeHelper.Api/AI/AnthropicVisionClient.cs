using System.Net.Http.Json;
using System.Text.Json;

namespace DIYHelper2.Api.AI;

/// <summary>
/// Thin wrapper over the Anthropic Messages API (REST). Avoids a heavy SDK dep so we can
/// keep the csproj minimal. Supports multi-image vision requests.
/// </summary>
public class AnthropicVisionClient : IAIVisionClient
{
    private readonly HttpClient _http;
    private readonly string _apiKey;
    private readonly string _model;
    private readonly ILogger<AnthropicVisionClient> _logger;

    public string ProviderName => "anthropic";

    public AnthropicVisionClient(HttpClient http, string apiKey, ILogger<AnthropicVisionClient> logger, string model = "claude-opus-4-6")
    {
        _http = http;
        _apiKey = apiKey;
        _model = model;
        _logger = logger;
    }

    public async Task<string> CompleteAsync(AIChatRequest request, CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrEmpty(_apiKey))
            throw new InvalidOperationException("ANTHROPIC_API_KEY is not configured.");

        var content = new List<object>();
        foreach (var img in request.Images)
        {
            content.Add(new
            {
                type = "image",
                source = new
                {
                    type = "base64",
                    media_type = string.IsNullOrEmpty(img.MimeType) ? "image/jpeg" : img.MimeType,
                    data = Convert.ToBase64String(img.Data)
                }
            });
        }
        content.Add(new { type = "text", text = request.User });

        var payload = new
        {
            model = _model,
            max_tokens = 4096,
            system = request.System,
            messages = new object[]
            {
                new { role = "user", content = content.ToArray() }
            }
        };

        using var req = new HttpRequestMessage(HttpMethod.Post, "https://api.anthropic.com/v1/messages");
        req.Headers.Add("x-api-key", _apiKey);
        req.Headers.Add("anthropic-version", "2023-06-01");
        req.Content = JsonContent.Create(payload);

        using var resp = await _http.SendAsync(req, cancellationToken);
        string body = await resp.Content.ReadAsStringAsync(cancellationToken);
        if (!resp.IsSuccessStatusCode)
        {
            _logger.LogError("Anthropic API error {Status}: {Body}", (int)resp.StatusCode, body);
            throw new HttpRequestException($"Anthropic API error {(int)resp.StatusCode}");
        }

        using var doc = JsonDocument.Parse(body);
        // Response shape: { content: [ { type: "text", text: "..." }, ... ] }
        if (doc.RootElement.TryGetProperty("content", out var contentArr) && contentArr.ValueKind == JsonValueKind.Array)
        {
            foreach (var el in contentArr.EnumerateArray())
            {
                if (el.TryGetProperty("type", out var t) && t.GetString() == "text" &&
                    el.TryGetProperty("text", out var tx))
                {
                    return tx.GetString()?.Trim() ?? "";
                }
            }
        }
        return "";
    }
}
