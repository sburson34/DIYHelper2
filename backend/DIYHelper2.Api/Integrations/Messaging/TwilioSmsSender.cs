using System.Net.Http.Headers;
using System.Text;

namespace DIYHelper2.Api.Integrations.Messaging;

/// <summary>
/// Twilio implementation of <see cref="ISmsSender"/>. Posts to Twilio's REST API
/// directly (form-encoded, Basic auth = AccountSid:AuthToken) so it works the
/// moment credentials are set — no SDK dependency. Fail-soft: any error returns
/// an unavailable <see cref="SmsResult"/> rather than throwing. SSRF-guarded like
/// every external client (api.twilio.com is public, so the guard passes it).
/// </summary>
public class TwilioSmsSender : ISmsSender
{
    private readonly HttpClient _http;
    private readonly TwilioOptions _options;
    private readonly ILogger<TwilioSmsSender> _logger;

    public TwilioSmsSender(HttpClient http, TwilioOptions options, ILogger<TwilioSmsSender> logger)
    {
        _http = http;
        _options = options;
        _logger = logger;
        _http.Timeout = TimeSpan.FromSeconds(15);
    }

    public bool IsConfigured => _options.IsConfigured;

    public async Task<SmsResult> SendAsync(string toPhone, string body, string? fromOverride = null, CancellationToken ct = default)
    {
        if (!IsConfigured)
            return SmsResult.Unavailable("SMS is not configured for this deployment.");
        var from = string.IsNullOrWhiteSpace(fromOverride) ? _options.FromNumber : fromOverride;
        if (string.IsNullOrWhiteSpace(from))
            return SmsResult.Unavailable("No sending number is configured.");
        if (string.IsNullOrWhiteSpace(toPhone))
            return SmsResult.Unavailable("No destination number.");

        try
        {
            var url = $"https://api.twilio.com/2010-04-01/Accounts/{_options.AccountSid}/Messages.json";
            var form = new List<KeyValuePair<string, string>>
            {
                new("To", toPhone),
                new("From", from!),
                new("Body", body),
            };
            using var req = new HttpRequestMessage(HttpMethod.Post, url)
            {
                Content = new FormUrlEncodedContent(form),
            };
            var basic = Convert.ToBase64String(Encoding.ASCII.GetBytes($"{_options.AccountSid}:{_options.AuthToken}"));
            req.Headers.Authorization = new AuthenticationHeaderValue("Basic", basic);

            using var resp = await _http.SendAsync(req, ct);
            var respBody = await resp.Content.ReadAsStringAsync(ct);
            if (!resp.IsSuccessStatusCode)
            {
                _logger.LogWarning("Twilio SMS send failed: {Status}", resp.StatusCode);
                return SmsResult.Unavailable("The SMS provider rejected the message.");
            }
            using var doc = System.Text.Json.JsonDocument.Parse(respBody);
            var sid = doc.RootElement.TryGetProperty("sid", out var s) ? s.GetString() : null;
            return SmsResult.Success(sid);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Twilio SMS send threw.");
            return SmsResult.Unavailable("Could not reach the SMS provider.");
        }
    }
}
