using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace DIYHelper2.Api.Services;

/// <summary>The scope a validated console session resolves to.</summary>
public sealed record AdminSessionPrincipal(bool IsSuperAdmin, string? Brand);

/// <summary>
/// Mints and validates the owner-console session tokens carried by the
/// <c>dh_admin_session</c> cookie. A token is a compact
/// <c>base64url(payload).base64url(hmac)</c> string (clone of the
/// <see cref="TechTokenService"/> pattern) carrying
/// <c>{sub: "super"|brandSlug, sup: bool, exp: unixSeconds}</c> — signed with
/// HMAC-SHA256 so the server can trust it without a session store.
///
/// <para>Key comes from <c>ADMIN_SESSION_KEY</c> (any string; hashed to 32
/// bytes), with an ephemeral per-process fallback + warning if unset — same
/// posture as <c>TECH_TOKEN_KEY</c>. Production MUST set it or console logins
/// won't survive a redeploy.</para>
///
/// <para>Lifetime defaults to 12 hours; override with
/// <c>ADMIN_SESSION_HOURS</c> (clamped to 1–24).</para>
/// </summary>
public class AdminSessionService
{
    public const string CookieName = "dh_admin_session";

    private readonly byte[] _key;

    public TimeSpan Lifetime { get; }

    public AdminSessionService(ILogger<AdminSessionService> logger)
    {
        var raw = Environment.GetEnvironmentVariable("ADMIN_SESSION_KEY");
        if (!string.IsNullOrWhiteSpace(raw))
        {
            _key = SHA256.HashData(Encoding.UTF8.GetBytes(raw));
        }
        else
        {
            _key = RandomNumberGenerator.GetBytes(32);
            logger.LogWarning(
                "ADMIN_SESSION_KEY not set — using an ephemeral in-process key. Console sessions won't survive a restart; set ADMIN_SESSION_KEY in production.");
        }

        var hours = 12;
        if (int.TryParse(Environment.GetEnvironmentVariable("ADMIN_SESSION_HOURS"), out var h))
            hours = Math.Clamp(h, 1, 24);
        Lifetime = TimeSpan.FromHours(hours);
    }

    public string Issue(bool isSuperAdmin, string? brandSlug)
    {
        var payload = new TokenPayload
        {
            sub = isSuperAdmin ? "super" : (brandSlug ?? ""),
            sup = isSuperAdmin,
            exp = DateTimeOffset.UtcNow.Add(Lifetime).ToUnixTimeSeconds(),
        };
        var p = Base64Url(JsonSerializer.SerializeToUtf8Bytes(payload));
        return $"{p}.{Base64Url(Sign(p))}";
    }

    public AdminSessionPrincipal? Validate(string? token)
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
            if (payload is null || string.IsNullOrEmpty(payload.sub)) return null;
            if (DateTimeOffset.UtcNow.ToUnixTimeSeconds() > payload.exp) return null;
            return payload.sup
                ? new AdminSessionPrincipal(true, null)
                : new AdminSessionPrincipal(false, payload.sub);
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
        public string sub { get; set; } = "";
        public bool sup { get; set; }
        public long exp { get; set; }
    }
}
