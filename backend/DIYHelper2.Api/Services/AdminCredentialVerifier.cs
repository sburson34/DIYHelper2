using System.Security.Cryptography;
using System.Text;
using DIYHelper2.Api.Data;
using Microsoft.EntityFrameworkCore;
using Sburson.Shared.Auth;

namespace DIYHelper2.Api.Services;

/// <summary>Who a successful admin credential check resolved to: the
/// super-admin (all brands) or a single brand's scoped dashboard login.</summary>
public sealed record AdminIdentity(bool IsSuperAdmin, string? BrandScope);

/// <summary>
/// The single implementation of the two-tier admin credential check and the
/// per-IP brute-force throttle, shared by <see cref="Middleware.AdminAuthMiddleware"/>
/// (Basic auth path) and the <c>POST /admin/session</c> login endpoint so a
/// failed console login and a failed Basic attempt feed the SAME lockout.
///
/// <para>Tiers, checked in order:
///   1. SUPER-ADMIN — the ADMIN_USERNAME / ADMIN_PASSWORD config creds
///      (populated post-Secrets-Manager via <see cref="Configure"/>).
///   2. PER-BRAND — a <c>Brand.DashboardUsername</c> + BCrypt
///      <c>DashboardPasswordHash</c> row. Always verifies against a hash
///      (dummy on a lookup miss) so a missing username is
///      timing-indistinguishable from a wrong password.</para>
///
/// <para>Throttle: 10 failures per 5-minute window per IP → 15-minute lockout.
/// State is static (process-wide) so every auth surface shares it.</para>
/// </summary>
public class AdminCredentialVerifier
{
    private const int MaxFailures = 10;                                  // per window
    private static readonly TimeSpan FailureWindow = TimeSpan.FromMinutes(5);
    public static readonly TimeSpan LockoutDuration = TimeSpan.FromMinutes(15);
    private static readonly System.Collections.Concurrent.ConcurrentDictionary<string, AttemptRecord> _attempts = new();

    private sealed class AttemptRecord
    {
        public int Failures;
        public DateTime WindowStart;
        public DateTime? LockedUntil;
    }

    private string? _username;
    private string? _password;

    /// <summary>Set the super-admin credentials. Called once from Program.cs
    /// after the Secrets Manager bundle resolves (same post-build population
    /// pattern as <c>AiKeyStore</c> / <c>RuntimeConfigStore</c>). Null/empty
    /// disables the super-admin tier; per-brand logins still work.</summary>
    public void Configure(string? username, string? password)
    {
        _username = username;
        _password = password;
    }

    /// <summary>Check a username/password against both tiers. Null = invalid.
    /// Does NOT touch the throttle — callers register failure/success so they
    /// control what counts as an attempt.</summary>
    public async Task<AdminIdentity?> VerifyAsync(AppDbContext db, string user, string pass)
    {
        // Tier 1: super-admin config creds → full cross-brand access.
        if (!string.IsNullOrEmpty(_username) && !string.IsNullOrEmpty(_password)
            && FixedTimeEquals(user, _username) && FixedTimeEquals(pass, _password))
        {
            return new AdminIdentity(true, null);
        }

        // Tier 2: per-brand scoped login. Always verify against a hash (dummy on
        // miss) so a missing username is timing-indistinguishable from a wrong
        // password — BCrypt's cost dominates the DB-lookup variance.
        var brand = await db.Brands
            .Where(b => b.DashboardUsername == user)
            .Select(b => new { b.Slug, b.DashboardPasswordHash, b.IsActive })
            .FirstOrDefaultAsync();

        var passwordOk = PasswordHasher.Verify(pass, brand?.DashboardPasswordHash ?? PasswordHasher.DummyHash);

        if (brand is not null && brand.IsActive && passwordOk)
            return new AdminIdentity(false, brand.Slug);

        return null;
    }

    public static string ClientIp(HttpContext context) =>
        context.Request.Headers["X-Forwarded-For"].FirstOrDefault()?.Split(',').FirstOrDefault()?.Trim()
        ?? context.Connection.RemoteIpAddress?.ToString()
        ?? "unknown";

    public bool IsLockedOut(string ip) =>
        ip != "unknown"
        && _attempts.TryGetValue(ip, out var rec)
        && rec.LockedUntil is { } until
        && until > DateTime.UtcNow;

    public void RegisterFailure(string ip)
    {
        // No resolvable client IP (in-memory test host) → nothing to throttle by.
        // In production the ALB always sets X-Forwarded-For / RemoteIpAddress.
        if (ip == "unknown") return;
        var rec = _attempts.GetOrAdd(ip, _ => new AttemptRecord { WindowStart = DateTime.UtcNow });
        lock (rec)
        {
            var now = DateTime.UtcNow;
            // Reset the counting window if it has elapsed (and no active lock).
            if (rec.LockedUntil is null && now - rec.WindowStart > FailureWindow)
            {
                rec.WindowStart = now;
                rec.Failures = 0;
            }
            rec.Failures++;
            if (rec.Failures >= MaxFailures)
                rec.LockedUntil = now + LockoutDuration;
        }
    }

    public void RegisterSuccess(string ip) => _attempts.TryRemove(ip, out _);

    private static bool FixedTimeEquals(string a, string b)
    {
        var ab = Encoding.UTF8.GetBytes(a ?? "");
        var bb = Encoding.UTF8.GetBytes(b ?? "");
        return CryptographicOperations.FixedTimeEquals(ab, bb);
    }
}
