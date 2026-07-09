using System.Net.Http.Json;
using System.Text.Json.Serialization;
using DIYHelper2.Api.Data;
using DIYHelper2.Api.Models;

namespace DIYHelper2.Api.Integrations.Crm;

/// <summary>
/// Owns the Housecall Pro OAuth 2.0 token lifecycle: exchanging an authorization
/// code for tokens, refreshing an expired access token, and persisting the
/// result (encrypted) onto a <see cref="BrandCrmConnection"/>.
///
/// <para>
/// Differs from Jobber in two ways confirmed against Housecall's tested OAuth
/// client: the token endpoint expects a <b>JSON</b> body (not form-urlencoded),
/// and access tokens are long-lived (~30 days) but still carry a refresh token.
/// </para>
///
/// <para>Registered as a typed HttpClient with the shared SsrfGuardHandler.
/// Fail-soft: returns null on network/HTTP error rather than throwing.</para>
/// </summary>
public class HousecallTokenService
{
    private const string TokenUrl = "https://api.housecallpro.com/oauth/token";
    private static readonly TimeSpan ExpirySkew = TimeSpan.FromMinutes(5);

    private readonly HttpClient _http;
    private readonly HousecallOptions _opts;
    private readonly CrmTokenProtector _protector;
    private readonly AppDbContext _db;
    private readonly ILogger<HousecallTokenService> _logger;

    public HousecallTokenService(
        HttpClient http,
        HousecallOptions opts,
        CrmTokenProtector protector,
        AppDbContext db,
        ILogger<HousecallTokenService> logger)
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
    /// failure; the caller persists via <see cref="ApplyTokens"/>.</summary>
    public Task<TokenResponse?> ExchangeCodeAsync(string code, CancellationToken ct = default) =>
        RequestAsync(new
        {
            client_id = _opts.ClientId,
            client_secret = _opts.ClientSecret,
            grant_type = "authorization_code",
            code,
            redirect_uri = _opts.RedirectUri,
        }, ct);

    /// <summary>Returns a valid, decrypted access token, refreshing (and
    /// persisting) if the cached one is expired/missing. Null if no refresh is
    /// possible or it fails.</summary>
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
            _logger.LogWarning("Housecall connection for brand {Brand} has no refresh token; needs re-auth.", conn.BrandSlug);
            return null;
        }

        var refreshToken = _protector.Unprotect(conn.RefreshTokenEnc);
        var tok = await RequestAsync(new
        {
            client_id = _opts.ClientId,
            client_secret = _opts.ClientSecret,
            grant_type = "refresh_token",
            refresh_token = refreshToken,
        }, ct);

        if (tok is null) return null;

        ApplyTokens(conn, tok);
        await _db.SaveChangesAsync(ct);
        return tok.AccessToken;
    }

    /// <summary>Encrypt and store a token response onto a connection (persisting a
    /// rotated refresh token when present). Caller saves, except
    /// <see cref="GetValidAccessTokenAsync"/> which saves itself after a refresh.</summary>
    public void ApplyTokens(BrandCrmConnection conn, TokenResponse tok)
    {
        conn.AccessTokenEnc = _protector.Protect(tok.AccessToken);
        if (!string.IsNullOrEmpty(tok.RefreshToken))
            conn.RefreshTokenEnc = _protector.Protect(tok.RefreshToken);
        conn.AccessTokenExpiresAt = DateTime.UtcNow.AddSeconds(tok.ExpiresIn);
        conn.UpdatedAt = DateTime.UtcNow;
    }

    private async Task<TokenResponse?> RequestAsync(object jsonBody, CancellationToken ct)
    {
        try
        {
            // Housecall's token endpoint takes a JSON body (confirmed against its
            // OAuth client), unlike the form-encoded convention Jobber uses.
            using var resp = await _http.PostAsJsonAsync(TokenUrl, jsonBody, ct);
            if (!resp.IsSuccessStatusCode)
            {
                _logger.LogWarning("Housecall token endpoint returned HTTP {Status}", (int)resp.StatusCode);
                return null;
            }
            var tok = await resp.Content.ReadFromJsonAsync<TokenResponse>(ct);
            if (tok is null || string.IsNullOrEmpty(tok.AccessToken))
            {
                _logger.LogWarning("Housecall token response was empty or missing access_token.");
                return null;
            }
            return tok;
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Housecall token request threw.");
            return null;
        }
    }
}
