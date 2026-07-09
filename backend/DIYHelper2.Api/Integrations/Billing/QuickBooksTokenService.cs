using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json.Serialization;
using DIYHelper2.Api.Data;
using DIYHelper2.Api.Integrations.Crm;
using DIYHelper2.Api.Models;

namespace DIYHelper2.Api.Integrations.Billing;

/// <summary>
/// QuickBooks Online OAuth 2.0 token lifecycle — the accounting-side twin of
/// <see cref="Crm.JobberTokenService"/>. Exchanges an authorization code for
/// tokens, refreshes an expired access token, and persists the result (encrypted
/// via the shared <see cref="CrmTokenProtector"/>) onto a
/// <see cref="BrandAccountingConnection"/>.
///
/// <para>Intuit's token endpoint authenticates the app with HTTP Basic
/// (client_id:client_secret) rather than body params, and its refresh tokens
/// rotate — so we persist the new refresh token every time. Fail-soft: network/
/// HTTP errors return null instead of throwing.</para>
/// </summary>
public class QuickBooksTokenService
{
    private const string TokenUrl = "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer";
    private static readonly TimeSpan ExpirySkew = TimeSpan.FromMinutes(2);

    private readonly HttpClient _http;
    private readonly QuickBooksOptions _opts;
    private readonly CrmTokenProtector _protector;
    private readonly AppDbContext _db;
    private readonly ILogger<QuickBooksTokenService> _logger;

    public QuickBooksTokenService(
        HttpClient http, QuickBooksOptions opts, CrmTokenProtector protector,
        AppDbContext db, ILogger<QuickBooksTokenService> logger)
    {
        _http = http;
        _opts = opts;
        _protector = protector;
        _db = db;
        _logger = logger;
        _http.Timeout = TimeSpan.FromSeconds(20);
    }

    public sealed record TokenResponse(
        [property: JsonPropertyName("access_token")] string AccessToken,
        [property: JsonPropertyName("refresh_token")] string? RefreshToken,
        [property: JsonPropertyName("expires_in")] int ExpiresIn);

    public Task<TokenResponse?> ExchangeCodeAsync(string code, CancellationToken ct = default) =>
        RequestAsync(new Dictionary<string, string>
        {
            ["grant_type"] = "authorization_code",
            ["code"] = code,
            ["redirect_uri"] = _opts.RedirectUri ?? "",
        }, ct);

    public async Task<string?> GetValidAccessTokenAsync(BrandAccountingConnection conn, CancellationToken ct = default)
    {
        if (conn.AccessTokenEnc is not null
            && conn.AccessTokenExpiresAt is { } exp
            && exp - ExpirySkew > DateTime.UtcNow)
        {
            return _protector.Unprotect(conn.AccessTokenEnc);
        }

        if (conn.RefreshTokenEnc is null)
        {
            _logger.LogWarning("QBO connection for brand {Brand} has no refresh token; needs re-auth.", conn.BrandSlug);
            return null;
        }

        var refreshToken = _protector.Unprotect(conn.RefreshTokenEnc);
        var tok = await RequestAsync(new Dictionary<string, string>
        {
            ["grant_type"] = "refresh_token",
            ["refresh_token"] = refreshToken,
        }, ct);
        if (tok is null) return null;

        ApplyTokens(conn, tok);
        await _db.SaveChangesAsync(ct);
        return tok.AccessToken;
    }

    public void ApplyTokens(BrandAccountingConnection conn, TokenResponse tok)
    {
        conn.AccessTokenEnc = _protector.Protect(tok.AccessToken);
        if (!string.IsNullOrEmpty(tok.RefreshToken))
            conn.RefreshTokenEnc = _protector.Protect(tok.RefreshToken);
        conn.AccessTokenExpiresAt = DateTime.UtcNow.AddSeconds(tok.ExpiresIn);
        conn.UpdatedAt = DateTime.UtcNow;
    }

    private async Task<TokenResponse?> RequestAsync(Dictionary<string, string> form, CancellationToken ct)
    {
        try
        {
            using var req = new HttpRequestMessage(HttpMethod.Post, TokenUrl)
            {
                Content = new FormUrlEncodedContent(form),
            };
            var basic = Convert.ToBase64String(Encoding.ASCII.GetBytes($"{_opts.ClientId}:{_opts.ClientSecret}"));
            req.Headers.Authorization = new AuthenticationHeaderValue("Basic", basic);
            req.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));

            using var resp = await _http.SendAsync(req, ct);
            if (!resp.IsSuccessStatusCode)
            {
                _logger.LogWarning("QBO token endpoint returned HTTP {Status}", (int)resp.StatusCode);
                return null;
            }
            var tok = await resp.Content.ReadFromJsonAsync<TokenResponse>(ct);
            if (tok is null || string.IsNullOrEmpty(tok.AccessToken))
            {
                _logger.LogWarning("QBO token response was empty or missing access_token.");
                return null;
            }
            return tok;
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "QBO token request threw.");
            return null;
        }
    }
}
