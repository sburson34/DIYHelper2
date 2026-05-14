using System.Security.Cryptography;
using System.Text;

namespace DIYHelper2.Api.Middleware;

/// <summary>
/// Configuration for <see cref="AdminAuthMiddleware"/>. If either credential
/// is null/empty the middleware is a no-op so local <c>dotnet run</c> keeps
/// working without extra setup.
/// </summary>
public sealed class AdminAuthOptions
{
    public string? Username { get; init; }
    public string? Password { get; init; }
}

/// <summary>
/// HTTP Basic Auth gate for admin surfaces:
///   - /admin/*        (dashboard HTML/JS/CSS)
///   - /api/help-requests  GET (list, detail), PUT, DELETE
///   - /api/feedback        GET (list)
///
/// The mobile app still reaches /api/help-requests POST (creating a request)
/// and /api/feedback POST (submitting beta feedback) without Basic Auth,
/// because those are user-initiated submit flows gated by X-App-Key instead.
///
/// Credentials come from AWS Secrets Manager (fields ADMIN_USERNAME,
/// ADMIN_PASSWORD) or the equivalent env vars for local dev. If neither is
/// configured the middleware is a no-op and nothing is protected — set
/// credentials before enabling public DNS or the admin surface is open.
/// </summary>
public class AdminAuthMiddleware
{
    private readonly RequestDelegate _next;
    private readonly string? _username;
    private readonly string? _password;

    public AdminAuthMiddleware(RequestDelegate next, AdminAuthOptions options)
    {
        _next = next;
        _username = options.Username;
        _password = options.Password;
    }

    public async Task InvokeAsync(HttpContext context)
    {
        if (!RequiresAuth(context.Request))
        {
            await _next(context);
            return;
        }

        if (string.IsNullOrEmpty(_username) || string.IsNullOrEmpty(_password))
        {
            // No credentials configured → refuse access rather than leak data.
            // This is deliberately fail-closed: a missing admin password must
            // NOT silently disable the gate.
            await WriteChallenge(context, "Admin credentials not configured.");
            return;
        }

        if (!TryParseBasic(context.Request, out var user, out var pass))
        {
            await WriteChallenge(context, "Authentication required.");
            return;
        }

        if (!FixedTimeEquals(user, _username) || !FixedTimeEquals(pass, _password))
        {
            await WriteChallenge(context, "Invalid credentials.");
            return;
        }

        await _next(context);
    }

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
