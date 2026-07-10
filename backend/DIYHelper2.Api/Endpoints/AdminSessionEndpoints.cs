using DIYHelper2.Api.Data;
using DIYHelper2.Api.Services;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;

namespace DIYHelper2.Api.Endpoints;

/// <summary>
/// Owner-console session endpoints. POST (login) and DELETE (logout) are
/// exempt from <c>AdminAuthMiddleware</c> — they ARE the auth surface; GET
/// (whoami) stays behind the middleware, which stamps
/// <c>Items["IsSuperAdmin"]</c> / <c>Items["BrandScope"]</c> from either the
/// session cookie or Basic auth.
///
/// Contract consumed by the console UI:
///   POST   /admin/session  {username,password} → 200 {isSuperAdmin,brand}
///          + Set-Cookie dh_admin_session (HttpOnly; SameSite=Strict; Path=/;
///          Max-Age=lifetime; Secure outside Development)
///          | 401 {error,code:"admin_unauthorized"} | 429 {code:"admin_locked_out"}
///   DELETE /admin/session  → 204 + expired cookie (works with or without a session)
///   GET    /admin/session  → 200 {isSuperAdmin,brand} | 401 (no Basic challenge)
/// </summary>
public static class AdminSessionEndpoints
{
    public static IEndpointRouteBuilder MapAdminSession(this IEndpointRouteBuilder app)
    {
        // Console login. Shares AdminCredentialVerifier (creds + brute-force
        // throttle) with the middleware's Basic path, so failed form logins and
        // failed Basic attempts count against the same per-IP lockout.
        app.MapPost("/admin/session", [EnableRateLimiting("submit")] async (
            [FromBody] AdminLoginDto dto, HttpContext http, AppDbContext db,
            AdminCredentialVerifier verifier, AdminSessionService sessions,
            IHostEnvironment env) =>
        {
            var ip = AdminCredentialVerifier.ClientIp(http);
            if (verifier.IsLockedOut(ip))
            {
                http.Response.Headers["Retry-After"] = ((int)AdminCredentialVerifier.LockoutDuration.TotalSeconds).ToString();
                return Results.Json(
                    new { error = "Too many failed attempts. Try again later.", code = "admin_locked_out" },
                    statusCode: 429);
            }

            var identity = await verifier.VerifyAsync(db, dto.Username ?? "", dto.Password ?? "");
            if (identity is null)
            {
                verifier.RegisterFailure(ip);
                return Results.Json(
                    new { error = "Invalid credentials.", code = "admin_unauthorized" },
                    statusCode: 401);
            }

            verifier.RegisterSuccess(ip);
            var token = sessions.Issue(identity.IsSuperAdmin, identity.BrandScope);
            http.Response.Cookies.Append(AdminSessionService.CookieName, token, new CookieOptions
            {
                HttpOnly = true,
                SameSite = SameSiteMode.Strict,
                Path = "/",
                MaxAge = sessions.Lifetime,
                Secure = !env.IsDevelopment(),
            });
            return Results.Ok(new { isSuperAdmin = identity.IsSuperAdmin, brand = identity.BrandScope });
        });

        // Logout: expire the cookie. Deliberately works with or without a valid
        // session (an expired/garbage cookie should still be clearable).
        app.MapDelete("/admin/session", (HttpContext http, IHostEnvironment env) =>
        {
            http.Response.Cookies.Append(AdminSessionService.CookieName, "", new CookieOptions
            {
                HttpOnly = true,
                SameSite = SameSiteMode.Strict,
                Path = "/",
                MaxAge = TimeSpan.Zero,
                Secure = !env.IsDevelopment(),
            });
            return Results.NoContent();
        });

        // Whoami. AdminAuthMiddleware gates this path (session cookie OR Basic)
        // and stamps the Items — an unauthenticated probe gets its 401 there,
        // without a WWW-Authenticate challenge.
        app.MapGet("/admin/session", (HttpContext http) =>
        {
            var isSuper = http.Items.TryGetValue("IsSuperAdmin", out var s) && s is true;
            var brand = http.Items.TryGetValue("BrandScope", out var b) ? b as string : null;
            return Results.Ok(new { isSuperAdmin = isSuper, brand });
        });

        return app;
    }
}
