using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace DIYHelper2.Api.Services;

/// <summary>The technician + brand a validated tech token resolves to.</summary>
public record TechPrincipal(int TechId, string Brand);

/// <summary>
/// Mints and validates the bearer tokens the mobile "tech mode" uses. A token is
/// a compact <c>base64url(payload).base64url(hmac)</c> string carrying the
/// technician id, brand slug, and an expiry — signed with HMAC-SHA256 so the
/// server can trust it without a session store.
///
/// <para>Key comes from <c>TECH_TOKEN_KEY</c> (any string; hashed to 32 bytes),
/// with an ephemeral per-process fallback + warning if unset — same posture as
/// <see cref="Integrations.Crm.CrmTokenProtector"/>. Production MUST set it or
/// tech logins won't survive a redeploy.</para>
/// </summary>
public class TechTokenService
{
    private static readonly TimeSpan Lifetime = TimeSpan.FromDays(30);
    private readonly byte[] _key;

    public TechTokenService(ILogger<TechTokenService> logger)
    {
        var raw = Environment.GetEnvironmentVariable("TECH_TOKEN_KEY");
        if (!string.IsNullOrWhiteSpace(raw))
        {
            _key = SHA256.HashData(Encoding.UTF8.GetBytes(raw));
        }
        else
        {
            _key = RandomNumberGenerator.GetBytes(32);
            logger.LogWarning(
                "TECH_TOKEN_KEY not set — using an ephemeral in-process key. Tech sessions won't survive a restart; set TECH_TOKEN_KEY in production.");
        }
    }

    public string Issue(int techId, string brand)
    {
        var payload = new TokenPayload
        {
            tid = techId,
            brand = brand,
            exp = DateTimeOffset.UtcNow.Add(Lifetime).ToUnixTimeSeconds(),
        };
        var p = Base64Url(JsonSerializer.SerializeToUtf8Bytes(payload));
        return $"{p}.{Base64Url(Sign(p))}";
    }

    public TechPrincipal? Validate(string? token)
    {
        if (string.IsNullOrWhiteSpace(token)) return null;
        var parts = token.Split('.');
        if (parts.Length != 2) return null;

        byte[] gotSig;
        try { gotSig = FromBase64Url(parts[1]); }
        catch { return null; }
        if (!CryptographicOperations.FixedTimeEquals(Sign(parts[0]), gotSig)) return null;

        try
        {
            var payload = JsonSerializer.Deserialize<TokenPayload>(FromBase64Url(parts[0]));
            if (payload is null || payload.tid <= 0 || string.IsNullOrEmpty(payload.brand)) return null;
            if (DateTimeOffset.UtcNow.ToUnixTimeSeconds() > payload.exp) return null;
            return new TechPrincipal(payload.tid, payload.brand);
        }
        catch { return null; }
    }

    private byte[] Sign(string p)
    {
        using var h = new HMACSHA256(_key);
        return h.ComputeHash(Encoding.ASCII.GetBytes(p));
    }

    private static string Base64Url(byte[] b) =>
        Convert.ToBase64String(b).TrimEnd('=').Replace('+', '-').Replace('/', '_');

    private static byte[] FromBase64Url(string s)
    {
        var t = s.Replace('-', '+').Replace('_', '/');
        t += (t.Length % 4) switch { 2 => "==", 3 => "=", _ => "" };
        return Convert.FromBase64String(t);
    }

    private class TokenPayload
    {
        public int tid { get; set; }
        public string brand { get; set; } = "";
        public long exp { get; set; }
    }
}
