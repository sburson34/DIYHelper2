using System.Net.Http.Json;
using System.Text.Json.Serialization;
using DIYHelper2.Api.Data;
using DIYHelper2.Api.Models;

namespace DIYHelper2.Api.Integrations.Crm;

/// <summary>
/// Owns the Jobber OAuth 2.0 token lifecycle: exchanging an authorization code
/// for tokens, refreshing an expired access token, and persisting the result
/// (encrypted) onto a <see cref="BrandCrmConnection"/>.
///
/// <para>
/// Jobber access tokens are short-lived (~60 min) and refresh tokens ROTATE — a
/// refresh returns a brand-new refresh token and invalidates the old one, so we
/// must persist the new one every time (<see cref="ApplyTokens"/> does this).
/// </para>
///
/// <para>Registered as a typed HttpClient with the shared SsrfGuardHandler.
/// Fail-soft: network/HTTP errors return null rather than throwing, so a Jobber
/// outage degrades to "lead not pushed" instead of failing the customer submit.</para>
/// </summary>
public class JobberTokenService
{
    private const string TokenUrl = "https://api.getjobber.com/api/oauth/token";
    // Refresh a little early so we never present a token that expires mid-flight.
    private static readonly TimeSpan ExpirySkew = TimeSpan.FromMinutes(2);

    private readonly HttpClient _http;
    private readonly JobberOptions _opts;
    private readonly CrmTokenProtector _protector;
    private readonly AppDbContext _db;
    private readonly ILogger<JobberTokenService> _logger;

    public JobberTokenService(
        HttpClient http,
        JobberOptions opts,
        CrmTokenProtector protector,
        AppDbContext db,
        ILogger<JobberTokenService> logger)
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

    /// <summary>Exchange an OAuth authorization code for tokens. Returns null on
    /// failure. Does not touch the database — the caller persists via
    /// <see cref="ApplyTokens"/>.</summary>
    public Task<TokenResponse?> ExchangeCodeAsync(string code, CancellationToken ct = default) =>
        RequestAsync(new Dictionary<string, string>
        {
            ["client_id"] = _opts.ClientId ?? "",
            ["client_secret"] = _opts.ClientSecret ?? "",
            ["grant_type"] = "authorization_code",
            ["code"] = code,
            ["redirect_uri"] = _opts.RedirectUri ?? "",
        }, ct);

    /// <summary>
    /// Returns a currently-valid, decrypted access token for the connection,
    /// refreshing (and persisting the rotated tokens) if the cached one is
    /// expired or missing. Returns null if no refresh is possible or the refresh
    /// fails.
    /// </summary>
    public async Task<string?> GetValidAccessTokenAsync(BrandCrmConnection conn, CancellationToken ct = default)
    {
        if (conn.AccessTokenEnc is not null
            && conn.AccessTokenExpiresAt is { } exp
            && exp - ExpirySkew > DateTime.UtcNow)
        {
            return _protector.Unprotect(conn.AccessTokenEnc);
        }

        if (conn.RefreshTokenEnc is null)
        {
            _logger.LogWarning("Jobber connection for brand {Brand} has no refresh token; needs re-auth.", conn.BrandSlug);
            return null;
        }

        var refreshToken = _protector.Unprotect(conn.RefreshTokenEnc);
        var tok = await RequestAsync(new Dictionary<string, string>
        {
            ["client_id"] = _opts.ClientId ?? "",
            ["client_secret"] = _opts.ClientSecret ?? "",
            ["grant_type"] = "refresh_token",
            ["refresh_token"] = refreshToken,
        }, ct);

        if (tok is null) return null;

        ApplyTokens(conn, tok);
        await _db.SaveChangesAsync(ct);
        return tok.AccessToken;
    }

    /// <summary>Encrypt and store a token response onto a connection. Persists the
    /// rotated refresh token when Jobber returns one. Caller is responsible for
    /// SaveChanges (except <see cref="GetValidAccessTokenAsync"/>, which saves
    /// itself after a refresh).</summary>
    public void ApplyTokens(BrandCrmConnection conn, TokenResponse tok)
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
            using var content = new FormUrlEncodedContent(form);
            using var resp = await _http.PostAsync(TokenUrl, content, ct);
            if (!resp.IsSuccessStatusCode)
            {
                _logger.LogWarning("Jobber token endpoint returned HTTP {Status}", (int)resp.StatusCode);
                return null;
            }
            var tok = await resp.Content.ReadFromJsonAsync<TokenResponse>(ct);
            if (tok is null || string.IsNullOrEmpty(tok.AccessToken))
            {
                _logger.LogWarning("Jobber token response was empty or missing access_token.");
                return null;
            }
            return tok;
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Jobber token request threw.");
            return null;
        }
    }
}
