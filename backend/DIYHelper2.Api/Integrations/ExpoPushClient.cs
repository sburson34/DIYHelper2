using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace DIYHelper2.Api.Integrations;

/// <summary>A single push message to one Expo token.</summary>
public record ExpoPushMessage(
    string To,
    string Title,
    string Body,
    string? Subtitle = null,
    string? ImageUrl = null,
    object? Data = null);

/// <summary>Result of enqueuing one message with Expo. On success <see cref="Id"/>
/// is a receipt id to poll later; on failure <see cref="ErrorCode"/> carries
/// Expo's machine-readable reason (e.g. "DeviceNotRegistered").</summary>
public record ExpoPushTicket(bool Ok, string? Id, string? ErrorCode, string? Message);

/// <summary>Delivery outcome for a previously-issued ticket id.</summary>
public record ExpoPushReceipt(bool Ok, string? ErrorCode, string? Message);

/// <summary>
/// Thin wrapper over the Expo push service (https://exp.host/--/api/v2/push).
/// The app registers Expo push tokens; this client fans a composed broadcast
/// out to them and later polls delivery receipts.
///
/// <para>
/// Registered as a typed HttpClient with the shared <c>SsrfGuardHandler</c> in
/// Program.cs. The guard is a private-range denylist, so the public
/// <c>exp.host</c> endpoint passes through unchanged. Fail-soft on network
/// error (logs a warning, returns error tickets) — a push outage must never
/// take the API down, matching <see cref="AI.ModerationService"/>.
/// </para>
/// </summary>
public class ExpoPushClient
{
    // Expo accepts at most 100 messages per /push/send call.
    private const int SendChunkSize = 100;
    // And at most 1000 ids per /push/getReceipts call.
    private const int ReceiptChunkSize = 1000;

    private const string SendUrl = "https://exp.host/--/api/v2/push/send";
    private const string ReceiptsUrl = "https://exp.host/--/api/v2/push/getReceipts";

    private static readonly JsonSerializerOptions JsonOpts = new()
    {
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
    };

    private readonly HttpClient _http;
    private readonly ILogger<ExpoPushClient> _logger;

    public ExpoPushClient(HttpClient http, ILogger<ExpoPushClient> logger)
    {
        _http = http;
        _logger = logger;
        _http.Timeout = TimeSpan.FromSeconds(30);
    }

    /// <summary>
    /// Sends every message, chunked into batches of 100. Returns one ticket per
    /// input message, in the same order, so the caller can correlate tickets
    /// back to tokens. Never throws — a failed chunk yields error tickets for
    /// each of its messages.
    /// </summary>
    public async Task<IReadOnlyList<ExpoPushTicket>> SendAsync(
        IReadOnlyList<ExpoPushMessage> messages, CancellationToken ct = default)
    {
        var tickets = new List<ExpoPushTicket>(messages.Count);
        for (var i = 0; i < messages.Count; i += SendChunkSize)
        {
            var chunk = messages.Skip(i).Take(SendChunkSize).ToList();
            tickets.AddRange(await SendChunkAsync(chunk, ct));
        }
        return tickets;
    }

    private async Task<IReadOnlyList<ExpoPushTicket>> SendChunkAsync(
        IReadOnlyList<ExpoPushMessage> chunk, CancellationToken ct)
    {
        try
        {
            var payload = chunk.Select(m => new ExpoSendDto
            {
                To = m.To,
                Title = m.Title,
                Body = m.Body,
                Subtitle = string.IsNullOrWhiteSpace(m.Subtitle) ? null : m.Subtitle,
                Sound = "default",
                Data = m.Data,
                RichContent = string.IsNullOrWhiteSpace(m.ImageUrl)
                    ? null
                    : new ExpoRichContent { Image = m.ImageUrl },
            }).ToArray();

            using var req = new HttpRequestMessage(HttpMethod.Post, SendUrl);
            req.Content = new StringContent(
                JsonSerializer.Serialize(payload, JsonOpts), Encoding.UTF8, "application/json");

            using var resp = await _http.SendAsync(req, ct);
            var raw = await resp.Content.ReadAsStringAsync(ct);
            if (!resp.IsSuccessStatusCode)
            {
                _logger.LogWarning("Expo push send returned {Status}: {Body}", (int)resp.StatusCode, Truncate(raw));
                return ErrorTickets(chunk.Count, $"expo_http_{(int)resp.StatusCode}");
            }

            var parsed = JsonSerializer.Deserialize<ExpoSendResponse>(raw);
            var data = parsed?.Data;
            if (data is null || data.Count == 0)
                return ErrorTickets(chunk.Count, "expo_empty_response");

            return data.Select(d => d.Status == "ok"
                ? new ExpoPushTicket(true, d.Id, null, null)
                : new ExpoPushTicket(false, null, d.Details?.Error, d.Message)).ToList();
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Expo push send failed; returning error tickets.");
            return ErrorTickets(chunk.Count, "expo_exception");
        }
    }

    /// <summary>
    /// Polls delivery receipts for previously-issued ticket ids. Returns a map
    /// of ticket id → receipt; ids Expo hasn't resolved yet are simply absent
    /// from the map. Never throws.
    /// </summary>
    public async Task<IReadOnlyDictionary<string, ExpoPushReceipt>> GetReceiptsAsync(
        IReadOnlyList<string> ticketIds, CancellationToken ct = default)
    {
        var result = new Dictionary<string, ExpoPushReceipt>();
        for (var i = 0; i < ticketIds.Count; i += ReceiptChunkSize)
        {
            var chunk = ticketIds.Skip(i).Take(ReceiptChunkSize).ToList();
            try
            {
                using var req = new HttpRequestMessage(HttpMethod.Post, ReceiptsUrl);
                req.Content = new StringContent(
                    JsonSerializer.Serialize(new { ids = chunk }, JsonOpts), Encoding.UTF8, "application/json");

                using var resp = await _http.SendAsync(req, ct);
                if (!resp.IsSuccessStatusCode)
                {
                    _logger.LogWarning("Expo getReceipts returned {Status}", (int)resp.StatusCode);
                    continue;
                }

                var raw = await resp.Content.ReadAsStringAsync(ct);
                var parsed = JsonSerializer.Deserialize<ExpoReceiptsResponse>(raw);
                if (parsed?.Data is null) continue;

                foreach (var (id, r) in parsed.Data)
                {
                    result[id] = r.Status == "ok"
                        ? new ExpoPushReceipt(true, null, null)
                        : new ExpoPushReceipt(false, r.Details?.Error, r.Message);
                }
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "Expo getReceipts failed for a chunk.");
            }
        }
        return result;
    }

    private static ExpoPushTicket[] ErrorTickets(int count, string code)
        => Enumerable.Range(0, count).Select(_ => new ExpoPushTicket(false, null, code, null)).ToArray();

    private static string Truncate(string s) => s.Length <= 500 ? s : s[..500];

    // ── Expo wire shapes ──────────────────────────────────────────────
    private sealed class ExpoSendDto
    {
        [JsonPropertyName("to")] public string To { get; set; } = "";
        [JsonPropertyName("title")] public string Title { get; set; } = "";
        [JsonPropertyName("body")] public string Body { get; set; } = "";
        [JsonPropertyName("subtitle")] public string? Subtitle { get; set; }
        [JsonPropertyName("sound")] public string? Sound { get; set; }
        [JsonPropertyName("data")] public object? Data { get; set; }
        [JsonPropertyName("richContent")] public ExpoRichContent? RichContent { get; set; }
    }

    private sealed class ExpoRichContent
    {
        [JsonPropertyName("image")] public string? Image { get; set; }
    }

    private sealed class ExpoSendResponse
    {
        [JsonPropertyName("data")] public List<ExpoTicketDto>? Data { get; set; }
    }

    private sealed class ExpoTicketDto
    {
        [JsonPropertyName("status")] public string? Status { get; set; }
        [JsonPropertyName("id")] public string? Id { get; set; }
        [JsonPropertyName("message")] public string? Message { get; set; }
        [JsonPropertyName("details")] public ExpoDetails? Details { get; set; }
    }

    private sealed class ExpoReceiptsResponse
    {
        [JsonPropertyName("data")] public Dictionary<string, ExpoReceiptDto>? Data { get; set; }
    }

    private sealed class ExpoReceiptDto
    {
        [JsonPropertyName("status")] public string? Status { get; set; }
        [JsonPropertyName("message")] public string? Message { get; set; }
        [JsonPropertyName("details")] public ExpoDetails? Details { get; set; }
    }

    private sealed class ExpoDetails
    {
        [JsonPropertyName("error")] public string? Error { get; set; }
    }
}
