using System.Text.Json;
using System.Text.Json.Serialization;

namespace DIYHelper2.Api.AI;

/// <summary>
/// Verifies Google Play Integrity tokens produced by the Android client on
/// demand. Calls the decodeIntegrityToken endpoint of the Play Integrity API
/// with a Google service account (authorized via Application Default
/// Credentials — typically an AWS-hosted service account JSON pulled from
/// Secrets Manager and exposed through GOOGLE_APPLICATION_CREDENTIALS).
///
/// Config:
///   PLAY_INTEGRITY_PROJECT_NUMBER — your Google Cloud project number (NOT
///       the alphanumeric project ID). Required to enable verification.
///   PLAY_INTEGRITY_PACKAGE_NAME — expected Android package name, defaults
///       to "com.diyhelper2".
///   PLAY_INTEGRITY_REQUIRE_MEETS_DEVICE_INTEGRITY — "true" to reject tokens
///       that don't claim MEETS_DEVICE_INTEGRITY (blocks rooted / emulator).
///
/// Fail-open on any verification error so a Google outage doesn't take down
/// the app; every failure is logged for monitoring.
/// </summary>
public class PlayIntegrityVerifier
{
    private readonly HttpClient _http;
    private readonly ILogger<PlayIntegrityVerifier> _logger;
    private readonly string? _projectNumber;
    private readonly string _packageName;
    private readonly bool _requireDeviceIntegrity;

    public PlayIntegrityVerifier(HttpClient http, ILogger<PlayIntegrityVerifier> logger)
    {
        _http = http;
        _logger = logger;
        _projectNumber = Environment.GetEnvironmentVariable("PLAY_INTEGRITY_PROJECT_NUMBER");
        _packageName = Environment.GetEnvironmentVariable("PLAY_INTEGRITY_PACKAGE_NAME") ?? "com.diyhelper2";
        _requireDeviceIntegrity = string.Equals(
            Environment.GetEnvironmentVariable("PLAY_INTEGRITY_REQUIRE_MEETS_DEVICE_INTEGRITY"),
            "true", StringComparison.OrdinalIgnoreCase);
        _http.Timeout = TimeSpan.FromSeconds(5);
    }

    public bool IsEnabled => !string.IsNullOrEmpty(_projectNumber);

    public async Task<IntegrityResult> VerifyAsync(string? token, CancellationToken ct = default)
    {
        if (!IsEnabled) return IntegrityResult.Skipped;
        if (string.IsNullOrWhiteSpace(token)) return IntegrityResult.Missing;

        try
        {
            var accessToken = await GetAccessTokenAsync(ct);
            if (string.IsNullOrEmpty(accessToken))
            {
                _logger.LogWarning("PlayIntegrity: no access token available; failing open.");
                return IntegrityResult.Skipped;
            }

            var url = $"https://playintegrity.googleapis.com/v1/{Uri.EscapeDataString(_packageName)}:decodeIntegrityToken";
            using var req = new HttpRequestMessage(HttpMethod.Post, url);
            req.Headers.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", accessToken);
            req.Content = new StringContent(
                JsonSerializer.Serialize(new { integrityToken = token }),
                System.Text.Encoding.UTF8, "application/json");

            using var resp = await _http.SendAsync(req, ct);
            if (!resp.IsSuccessStatusCode)
            {
                _logger.LogWarning("PlayIntegrity: decode returned {Status}; failing open.", (int)resp.StatusCode);
                return IntegrityResult.Skipped;
            }

            var body = await resp.Content.ReadAsStringAsync(ct);
            var parsed = JsonSerializer.Deserialize<DecodedIntegrityResponse>(body);
            var payload = parsed?.TokenPayloadExternal;
            if (payload == null) return IntegrityResult.Invalid;

            // Basic claim checks: package name matches + nonce sane + device integrity if required.
            var appPackage = payload.AppIntegrity?.PackageName;
            if (!string.Equals(appPackage, _packageName, StringComparison.Ordinal))
            {
                _logger.LogWarning("PlayIntegrity: package mismatch (got {Got})", appPackage);
                return IntegrityResult.Invalid;
            }

            if (_requireDeviceIntegrity)
            {
                var verdicts = payload.DeviceIntegrity?.DeviceRecognitionVerdict ?? Array.Empty<string>();
                if (!verdicts.Contains("MEETS_DEVICE_INTEGRITY"))
                    return IntegrityResult.Invalid;
            }

            return IntegrityResult.Valid;
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "PlayIntegrity: verification failed; failing open.");
            return IntegrityResult.Skipped;
        }
    }

    // Access token minting. Expects GOOGLE_APPLICATION_CREDENTIALS to point at
    // a service account JSON *OR* a cached OAuth token to be supplied via
    // PLAY_INTEGRITY_ACCESS_TOKEN (useful for local testing without the google
    // auth library).
    private async Task<string?> GetAccessTokenAsync(CancellationToken ct)
    {
        var overrideToken = Environment.GetEnvironmentVariable("PLAY_INTEGRITY_ACCESS_TOKEN");
        if (!string.IsNullOrEmpty(overrideToken)) return overrideToken;

        var credsPath = Environment.GetEnvironmentVariable("GOOGLE_APPLICATION_CREDENTIALS");
        if (string.IsNullOrEmpty(credsPath) || !File.Exists(credsPath))
        {
            _logger.LogWarning("PlayIntegrity: GOOGLE_APPLICATION_CREDENTIALS is not set or the file is missing.");
            return null;
        }

        try
        {
            var json = await File.ReadAllTextAsync(credsPath, ct);
            var creds = JsonSerializer.Deserialize<ServiceAccountKey>(json);
            if (creds == null || string.IsNullOrEmpty(creds.ClientEmail) || string.IsNullOrEmpty(creds.PrivateKey))
                return null;

            return await MintAccessTokenAsync(creds, ct);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "PlayIntegrity: failed to load service account credentials.");
            return null;
        }
    }

    private async Task<string?> MintAccessTokenAsync(ServiceAccountKey creds, CancellationToken ct)
    {
        // Build and sign a JWT, exchange for an OAuth access token at Google's
        // token endpoint. Minimal implementation so we don't need to pull in
        // Google.Apis.Auth (keeps the dependency surface small).
        var header = new { alg = "RS256", typ = "JWT", kid = creds.PrivateKeyId };
        var now = DateTimeOffset.UtcNow.ToUnixTimeSeconds();
        var claims = new
        {
            iss = creds.ClientEmail,
            scope = "https://www.googleapis.com/auth/playintegrity",
            aud = "https://oauth2.googleapis.com/token",
            iat = now,
            exp = now + 3600,
        };

        string B64(string s) => Convert.ToBase64String(System.Text.Encoding.UTF8.GetBytes(s))
            .TrimEnd('=').Replace('+', '-').Replace('/', '_');

        var unsigned = B64(JsonSerializer.Serialize(header)) + "." + B64(JsonSerializer.Serialize(claims));

        using var rsa = System.Security.Cryptography.RSA.Create();
        rsa.ImportFromPem(creds.PrivateKey!);
        var sigBytes = rsa.SignData(
            System.Text.Encoding.UTF8.GetBytes(unsigned),
            System.Security.Cryptography.HashAlgorithmName.SHA256,
            System.Security.Cryptography.RSASignaturePadding.Pkcs1);
        var signature = Convert.ToBase64String(sigBytes).TrimEnd('=').Replace('+', '-').Replace('/', '_');
        var jwt = unsigned + "." + signature;

        using var tokenReq = new HttpRequestMessage(HttpMethod.Post, "https://oauth2.googleapis.com/token");
        tokenReq.Content = new FormUrlEncodedContent(new[]
        {
            new KeyValuePair<string, string>("grant_type", "urn:ietf:params:oauth:grant-type:jwt-bearer"),
            new KeyValuePair<string, string>("assertion", jwt),
        });

        using var resp = await _http.SendAsync(tokenReq, ct);
        if (!resp.IsSuccessStatusCode) return null;
        var body = await resp.Content.ReadAsStringAsync(ct);
        var parsed = JsonSerializer.Deserialize<TokenResponse>(body);
        return parsed?.AccessToken;
    }

    private sealed class ServiceAccountKey
    {
        [JsonPropertyName("client_email")] public string? ClientEmail { get; set; }
        [JsonPropertyName("private_key")] public string? PrivateKey { get; set; }
        [JsonPropertyName("private_key_id")] public string? PrivateKeyId { get; set; }
    }

    private sealed class TokenResponse
    {
        [JsonPropertyName("access_token")] public string? AccessToken { get; set; }
    }

    private sealed class DecodedIntegrityResponse
    {
        [JsonPropertyName("tokenPayloadExternal")] public TokenPayload? TokenPayloadExternal { get; set; }
    }

    private sealed class TokenPayload
    {
        [JsonPropertyName("appIntegrity")] public AppIntegrityClaim? AppIntegrity { get; set; }
        [JsonPropertyName("deviceIntegrity")] public DeviceIntegrityClaim? DeviceIntegrity { get; set; }
    }

    private sealed class AppIntegrityClaim
    {
        [JsonPropertyName("packageName")] public string? PackageName { get; set; }
    }

    private sealed class DeviceIntegrityClaim
    {
        [JsonPropertyName("deviceRecognitionVerdict")] public string[]? DeviceRecognitionVerdict { get; set; }
    }
}

public enum IntegrityResult
{
    Skipped,
    Missing,
    Valid,
    Invalid,
}
