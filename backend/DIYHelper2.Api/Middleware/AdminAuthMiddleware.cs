using System.Text;
using DIYHelper2.Api.Data;
using DIYHelper2.Api.Services;

namespace DIYHelper2.Api.Middleware;

/// <summary>
/// Multi-tenant auth gate for the admin surfaces:
///   - /admin/session       GET only (whoami; POST/DELETE are the login/logout
///                          endpoints and handle themselves)
///   - /api/help-requests   GET (list, detail), PUT, DELETE
///   - /api/brands, /api/technicians, /api/assets, /api/pricebook,
///     /api/inventory, /api/ops, /api/ai, /api/push (composer surfaces),
///     /api/feedback GET, /api/crm + /api/accounting (except OAuth callbacks)
///
/// /admin/* STATIC files (index.html/js/css) are served WITHOUT auth — they
/// are the UI shell only and contain no data; every API the shell calls stays
/// gated here. That lets the console render its own login form.
///
/// Two ways in, checked in order:
///   1. SESSION COOKIE — a valid <c>dh_admin_session</c> HMAC token minted by
///      POST /admin/session (the console login form).
///   2. HTTP BASIC — unchanged legacy path (curl / scripts): super-admin
///      config creds or a per-brand Brand.DashboardUsername + BCrypt hash.
///
/// Both paths resolve through <see cref="AdminCredentialVerifier"/> semantics
/// and stamp the same <c>Items["IsSuperAdmin"]</c> / <c>Items["BrandScope"]</c>
/// (cross-tenant ids 404, not 403, so a scoped user can't probe another
/// brand's id space).
///
/// 401 responses carry a <c>WWW-Authenticate: Basic</c> challenge ONLY when
/// the request actually attempted Basic auth — otherwise the browser's native
/// credentials popup would appear on top of (and defeat) the console's own
/// login form.
///
/// CSRF stance for the cookie path: the session cookie is SameSite=Strict,
/// CORS default-denies browser origins (ALLOWED_ORIGINS is empty unless
/// deliberately configured), and — as defense-in-depth — any state-changing
/// request a modern browser marks <c>Sec-Fetch-Site: cross-site</c> is
/// rejected with 403 below. No CSRF token is needed on top of those three.
///
/// Fail-closed: <c>_next</c> is reached only on a positive cookie, super-admin
/// or brand match; anything else returns 401. Per-IP brute-force lockout is
/// shared with the login endpoint via <see cref="AdminCredentialVerifier"/>.
/// </summary>
public class AdminAuthMiddleware
{
    private readonly RequestDelegate _next;

    public AdminAuthMiddleware(RequestDelegate next) => _next = next;

    // Scoped/per-request dependencies (AppDbContext) are injected via
    // convention-based middleware method injection; the middleware itself stays
    // a singleton, so no captive dependency. The verifier + session service are
    // singletons but injected here too for symmetry/testability.
    public async Task InvokeAsync(
        HttpContext context, AppDbContext db,
        AdminCredentialVerifier verifier, AdminSessionService sessions)
    {
        var path = context.Request.Path.Value ?? "";
        var isAdminPath = path.StartsWith("/admin", StringComparison.OrdinalIgnoreCase);
        var requiresAuth = RequiresAuth(context.Request);

        // Strict, self-contained CSP + no-store on every admin response —
        // static UI shell, session endpoints and gated APIs alike. The shared
        // SecurityHeadersMiddleware sets nosniff / frame-options /
        // referrer-policy but no CSP; the portal is a same-origin app with zero
        // inline script/style, so a strict policy adds real XSS
        // defense-in-depth without breaking it.
        if (isAdminPath || requiresAuth)
            ApplyAdminSecurityHeaders(context);

        if (!requiresAuth)
        {
            await _next(context);
            return;
        }

        var clientIp = AdminCredentialVerifier.ClientIp(context);

        // Refuse early if this IP is in a lockout window.
        if (verifier.IsLockedOut(clientIp))
        {
            context.Response.StatusCode = 429;
            context.Response.Headers["Retry-After"] = ((int)AdminCredentialVerifier.LockoutDuration.TotalSeconds).ToString();
            context.Response.ContentType = "application/json";
            await context.Response.WriteAsync(
                System.Text.Json.JsonSerializer.Serialize(new { error = "Too many failed attempts. Try again later.", code = "admin_locked_out" }));
            return;
        }

        // 1. Session cookie (console login form).
        var session = sessions.Validate(context.Request.Cookies[AdminSessionService.CookieName]);
        if (session is not null)
        {
            // Defense-in-depth CSRF check (see class comment): a cookie-authed
            // state-changing request that the browser itself labels as
            // cross-site can only be a forged navigation/fetch — reject it.
            var method = context.Request.Method;
            var stateChanging = !HttpMethods.IsGet(method) && !HttpMethods.IsHead(method) && !HttpMethods.IsOptions(method);
            if (stateChanging && string.Equals(
                    context.Request.Headers["Sec-Fetch-Site"].FirstOrDefault(), "cross-site",
                    StringComparison.OrdinalIgnoreCase))
            {
                context.Response.StatusCode = 403;
                context.Response.ContentType = "application/json";
                await context.Response.WriteAsync(
                    System.Text.Json.JsonSerializer.Serialize(new { error = "Cross-site request rejected.", code = "admin_cross_site" }));
                return;
            }

            if (session.IsSuperAdmin) context.Items["IsSuperAdmin"] = true;
            else context.Items["BrandScope"] = session.Brand;
            await _next(context);
            return;
        }

        // 2. HTTP Basic (curl / scripts) — behavior unchanged.
        var attemptedBasic = (context.Request.Headers["Authorization"].FirstOrDefault() ?? "")
            .StartsWith("Basic ", StringComparison.OrdinalIgnoreCase);

        if (!TryParseBasic(context.Request, out var user, out var pass))
        {
            // No usable credentials at all. Challenge only an actual (malformed)
            // Basic attempt — see class comment on the browser popup.
            await WriteUnauthorized(context, "Authentication required.", challenge: attemptedBasic);
            return;
        }

        var identity = await verifier.VerifyAsync(db, user, pass);
        if (identity is not null)
        {
            verifier.RegisterSuccess(clientIp);
            if (identity.IsSuperAdmin) context.Items["IsSuperAdmin"] = true;
            else context.Items["BrandScope"] = identity.BrandScope;
            await _next(context);
            return;
        }

        verifier.RegisterFailure(clientIp);
        await WriteUnauthorized(context, "Invalid credentials.", challenge: true);
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

    private static bool RequiresAuth(HttpRequest req)
    {
        var path = req.Path.Value ?? "";

        // Console session endpoints: POST (login) and DELETE (logout) handle
        // their own auth; GET (whoami) is answered by the cookie/Basic branches
        // above — never by a Basic challenge.
        if (path.Equals("/admin/session", StringComparison.OrdinalIgnoreCase))
            return HttpMethods.IsGet(req.Method);

        // /admin/* static assets are the UI shell only (no data) and must load
        // unauthenticated so the console can render its login form. Every API
        // the shell calls remains gated below.
        if (path.StartsWith("/admin", StringComparison.OrdinalIgnoreCase))
            return false;

        // Admin-only /api/help-requests operations: list (GET), detail (GET),
        // update (PUT), delete (DELETE). POST is the customer create flow.
        if (path.StartsWith("/api/help-requests", StringComparison.OrdinalIgnoreCase)
            && !HttpMethods.IsPost(req.Method))
            return true;

        // Brand list for the dashboard (super-admin: all; scoped: own).
        if (path.StartsWith("/api/brands", StringComparison.OrdinalIgnoreCase))
            return true;

        // Technician management is owner-only (the console CRUD + code issuing).
        // The tech-facing /api/tech/* endpoints are NOT here — they authenticate
        // with a signed tech bearer token, not Basic auth.
        if (path.StartsWith("/api/technicians", StringComparison.OrdinalIgnoreCase))
            return true;

        // Customer-equipment management (/api/assets) is owner-only. The
        // customer-facing /api/my/assets routes do NOT match this prefix and
        // stay public (device-scoped) — pinned by a regression test.
        if (path.StartsWith("/api/assets", StringComparison.OrdinalIgnoreCase))
            return true;

        // Price-book management is owner-only.
        if (path.StartsWith("/api/pricebook", StringComparison.OrdinalIgnoreCase))
            return true;

        // Inventory management is owner-only.
        if (path.StartsWith("/api/inventory", StringComparison.OrdinalIgnoreCase))
            return true;

        // Ops summary (job costing / KPIs) is owner-only.
        if (path.StartsWith("/api/ops", StringComparison.OrdinalIgnoreCase))
            return true;

        // Owner-facing AI tools (quote assistant, review responder) are owner-only.
        if (path.StartsWith("/api/ai", StringComparison.OrdinalIgnoreCase))
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

        // CRM OAuth: initiating a connection (/api/crm/*) is admin-gated. The
        // provider's redirect back to /callback carries no Basic auth — it's a
        // browser navigation — so it stays public, protected instead by the
        // signed, time-boxed `state` parameter it must echo back.
        if (path.StartsWith("/api/crm", StringComparison.OrdinalIgnoreCase)
            && !path.EndsWith("/callback", StringComparison.OrdinalIgnoreCase))
            return true;

        // Accounting OAuth (QuickBooks): same posture as CRM — initiating is
        // admin-gated, the provider's /callback redirect stays public (protected
        // by the signed state it must echo back).
        if (path.StartsWith("/api/accounting", StringComparison.OrdinalIgnoreCase)
            && !path.EndsWith("/callback", StringComparison.OrdinalIgnoreCase))
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

    private static async Task WriteUnauthorized(HttpContext ctx, string message, bool challenge)
    {
        ctx.Response.StatusCode = 401;
        // Challenge ONLY requests that attempted Basic auth; a challenge on a
        // cookie-less browser request would pop the native login dialog over
        // the console's own form.
        if (challenge)
            ctx.Response.Headers["WWW-Authenticate"] = "Basic realm=\"DIYHelper2 Admin\", charset=\"UTF-8\"";
        ctx.Response.ContentType = "application/json";
        await ctx.Response.WriteAsync(
            System.Text.Json.JsonSerializer.Serialize(new { error = message, code = "admin_unauthorized" }));
    }
}
