using System.Security.Cryptography;
using System.Text;
using DIYHelper2.Api.Data;
using Microsoft.EntityFrameworkCore;
using Sburson.Shared.Auth;

namespace DIYHelper2.Api.Middleware;

/// <summary>
/// Configuration for <see cref="AdminAuthMiddleware"/>. These are the
/// SUPER-ADMIN credentials (you) — a super-admin sees every brand's leads. If
/// either is null/empty the super-admin path is disabled, but per-brand logins
/// (from the Brands table) still work.
/// </summary>
public sealed class AdminAuthOptions
{
    public string? Username { get; init; }
    public string? Password { get; init; }
}

/// <summary>
/// Multi-tenant HTTP Basic Auth gate for admin surfaces:
///   - /admin/*             (dashboard HTML/JS/CSS)
///   - /api/help-requests   GET (list, detail), PUT, DELETE
///   - /api/brands          GET (brand list for the dashboard)
///   - /api/feedback        GET (list)
///
/// Two credential tiers, checked in order:
///   1. SUPER-ADMIN — the <see cref="AdminAuthOptions"/> config creds
///      (ADMIN_USERNAME / ADMIN_PASSWORD). Sets <c>Items["IsSuperAdmin"]=true</c>
///      and grants access to all brands' data.
///   2. PER-BRAND — a <c>Brand.DashboardUsername</c> + BCrypt
///      <c>DashboardPasswordHash</c> row (white-label tenant). Sets
///      <c>Items["BrandScope"]=slug</c>; handlers must scope their queries to it.
///
/// Fail-closed: <c>_next</c> is reached only on a positive super-admin or brand
/// match; anything else returns 401. The per-brand path always runs a BCrypt
/// verify (against <see cref="PasswordHasher.DummyHash"/> on a lookup miss) so
/// response time never reveals whether a username exists.
///
/// The mobile app still reaches /api/help-requests POST and /api/feedback POST
/// without Basic Auth — those are user submit flows gated by X-App-Key instead.
/// </summary>
public class AdminAuthMiddleware
{
    private readonly RequestDelegate _next;
    private readonly string? _username;
    private readonly string? _password;

    // ── Brute-force throttle ──────────────────────────────────────────
    // Per-IP failed-login accounting. The dashboard is the branding company's
    // primary interface with the product, so its login is a high-value target;
    // BCrypt already slows guessing, but a lockout caps online brute force.
    private const int MaxFailures = 10;                                  // per window
    private static readonly TimeSpan FailureWindow = TimeSpan.FromMinutes(5);
    private static readonly TimeSpan LockoutDuration = TimeSpan.FromMinutes(15);
    private static readonly System.Collections.Concurrent.ConcurrentDictionary<string, AttemptRecord> _attempts = new();

    private sealed class AttemptRecord
    {
        public int Failures;
        public DateTime WindowStart;
        public DateTime? LockedUntil;
    }

    public AdminAuthMiddleware(RequestDelegate next, AdminAuthOptions options)
    {
        _next = next;
        _username = options.Username;
        _password = options.Password;
    }

    // AppDbContext is injected per-request via convention-based middleware method
    // injection (the middleware itself stays a singleton, so no captive
    // dependency). Needed to validate per-brand dashboard credentials.
    public async Task InvokeAsync(HttpContext context, AppDbContext db)
    {
        if (!RequiresAuth(context.Request))
        {
            await _next(context);
            return;
        }

        // Strict, self-contained CSP + no-store on every admin response
        // (documents and API). The shared SecurityHeadersMiddleware sets
        // nosniff / frame-options / referrer-policy but no CSP; the portal is a
        // same-origin app with zero inline script/style, so a strict policy adds
        // real XSS defense-in-depth without breaking it.
        ApplyAdminSecurityHeaders(context);

        var clientIp = ClientIp(context);

        // Refuse early if this IP is in a lockout window.
        if (IsLockedOut(clientIp))
        {
            context.Response.StatusCode = 429;
            context.Response.Headers["Retry-After"] = ((int)LockoutDuration.TotalSeconds).ToString();
            context.Response.ContentType = "application/json";
            await context.Response.WriteAsync(
                System.Text.Json.JsonSerializer.Serialize(new { error = "Too many failed attempts. Try again later.", code = "admin_locked_out" }));
            return;
        }

        if (!TryParseBasic(context.Request, out var user, out var pass))
        {
            await WriteChallenge(context, "Authentication required.");
            return;
        }

        // Tier 1: super-admin config creds → full cross-brand access.
        if (!string.IsNullOrEmpty(_username) && !string.IsNullOrEmpty(_password)
            && FixedTimeEquals(user, _username) && FixedTimeEquals(pass, _password))
        {
            RegisterSuccess(clientIp);
            context.Items["IsSuperAdmin"] = true;
            await _next(context);
            return;
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
        {
            RegisterSuccess(clientIp);
            context.Items["BrandScope"] = brand.Slug;
            await _next(context);
            return;
        }

        RegisterFailure(clientIp);
        await WriteChallenge(context, "Invalid credentials.");
    }

    // Registers strict security headers on the response just before it starts,
    // so they land on static-file (HTML/JS/CSS) responses too.
    private static void ApplyAdminSecurityHeaders(HttpContext context)
    {
        var isDocument = (context.Request.Path.Value ?? "")
            .StartsWith("/admin", StringComparison.OrdinalIgnoreCase);
        context.Response.OnStarting(() =>
        {
            var headers = context.Response.Headers;
            // Sensitive lead/customer data — never cache in a shared browser.
            headers["Cache-Control"] = "no-store";
            headers["Pragma"] = "no-cache";
            if (isDocument)
            {
                // Self-contained app: only same-origin script/style, data: images
                // for base64 thumbnails, no framing, no external anything.
                headers["Content-Security-Policy"] =
                    "default-src 'self'; " +
                    "script-src 'self'; " +
                    "style-src 'self'; " +
                    "img-src 'self' data: https:; " +
                    "font-src 'self'; " +
                    "connect-src 'self'; " +
                    "object-src 'none'; " +
                    "base-uri 'none'; " +
                    "form-action 'self'; " +
                    "frame-ancestors 'none'";
            }
            return Task.CompletedTask;
        });
    }

    private static string ClientIp(HttpContext context) =>
        context.Request.Headers["X-Forwarded-For"].FirstOrDefault()?.Split(',').FirstOrDefault()?.Trim()
        ?? context.Connection.RemoteIpAddress?.ToString()
        ?? "unknown";

    private static bool IsLockedOut(string ip) =>
        ip != "unknown"
        && _attempts.TryGetValue(ip, out var rec)
        && rec.LockedUntil is { } until
        && until > DateTime.UtcNow;

    private static void RegisterFailure(string ip)
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

    private static void RegisterSuccess(string ip) => _attempts.TryRemove(ip, out _);

    private static bool RequiresAuth(HttpRequest req)
    {
        var path = req.Path.Value ?? "";

        if (path.StartsWith("/admin", StringComparison.OrdinalIgnoreCase))
            return true;

        // Admin-only /api/help-requests operations: list (GET), detail (GET),
        // update (PUT), delete (DELETE). POST is the customer create flow.
        if (path.StartsWith("/api/help-requests", StringComparison.OrdinalIgnoreCase)
            && !HttpMethods.IsPost(req.Method))
            return true;

        // Brand list for the dashboard (super-admin: all; scoped: own).
        if (path.StartsWith("/api/brands", StringComparison.OrdinalIgnoreCase))
            return true;

        // Push composer surfaces (audience, send, test, campaigns, cancel) are
        // admin-only. The mobile register/unregister POSTs stay public (gated by
        // X-App-Key), like /api/help-requests POST.
        if (path.StartsWith("/api/push", StringComparison.OrdinalIgnoreCase)
            && !path.Equals("/api/push/register", StringComparison.OrdinalIgnoreCase)
            && !path.Equals("/api/push/unregister", StringComparison.OrdinalIgnoreCase))
            return true;

        // Admin-only /api/feedback list (GET). POST is customer submit.
        if (path.Equals("/api/feedback", StringComparison.OrdinalIgnoreCase)
            && HttpMethods.IsGet(req.Method))
            return true;

        return false;
    }

    private static bool TryParseBasic(HttpRequest req, out string user, out string pass)
    {
        user = ""; pass = "";
        var header = req.Headers["Authorization"].FirstOrDefault();
        if (string.IsNullOrEmpty(header)) return false;
        if (!header.StartsWith("Basic ", StringComparison.OrdinalIgnoreCase)) return false;

        try
        {
            var b64 = header.Substring("Basic ".Length).Trim();
            var decoded = Encoding.UTF8.GetString(Convert.FromBase64String(b64));
            var idx = decoded.IndexOf(':');
            if (idx <= 0) return false;
            user = decoded.Substring(0, idx);
            pass = decoded.Substring(idx + 1);
            return true;
        }
        catch
        {
            return false;
        }
    }

    private static async Task WriteChallenge(HttpContext ctx, string message)
    {
        ctx.Response.StatusCode = 401;
        ctx.Response.Headers["WWW-Authenticate"] = "Basic realm=\"DIYHelper2 Admin\", charset=\"UTF-8\"";
        ctx.Response.ContentType = "application/json";
        await ctx.Response.WriteAsync(
            System.Text.Json.JsonSerializer.Serialize(new { error = message, code = "admin_unauthorized" }));
    }

    private static bool FixedTimeEquals(string a, string b)
    {
        var ab = Encoding.UTF8.GetBytes(a ?? "");
        var bb = Encoding.UTF8.GetBytes(b ?? "");
        return CryptographicOperations.FixedTimeEquals(ab, bb);
    }
}
