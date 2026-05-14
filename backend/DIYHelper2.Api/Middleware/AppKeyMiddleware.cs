namespace DIYHelper2.Api.Middleware;

/// <summary>
/// Wrapper registered in DI so AppKeyMiddleware can be activated without
/// the pipeline trying to resolve a bare <c>string</c> parameter.
/// </summary>
public sealed class AppKeyOptions
{
    public string? ExpectedKey { get; init; }
}

/// <summary>
/// Requires inbound requests to present a shared secret in <c>X-App-Key</c>
/// matching the server-configured value. The key is loaded from AWS Secrets
/// Manager (JSON field <c>APP_KEY</c>) or the <c>APP_KEY</c> env var, same
/// pattern as the other secrets. If no key is configured, the middleware is a
/// no-op so local development keeps working unattended.
///
/// Public routes (<c>/</c>, <c>/api/health</c>, OpenAPI) bypass the check so
/// load balancers and smoke tests can hit them without the secret.
///
/// This is a lightweight abuse-deterrent, not real authentication: the secret
/// ships inside the mobile binary and can be extracted by a determined
/// attacker. For stronger guarantees, layer Play Integrity / App Attest on top.
/// </summary>
public class AppKeyMiddleware
{
    private const string HeaderName = "X-App-Key";
    private readonly RequestDelegate _next;
    private readonly string? _expectedKey;

    public AppKeyMiddleware(RequestDelegate next, AppKeyOptions options)
    {
        _next = next;
        _expectedKey = options.ExpectedKey;
    }

    public async Task InvokeAsync(HttpContext context)
    {
        // No secret configured → feature disabled. Keeps local `dotnet run` working.
        if (string.IsNullOrEmpty(_expectedKey))
        {
            await _next(context);
            return;
        }

        var path = context.Request.Path.Value ?? "";
        if (IsPublicPath(path))
        {
            await _next(context);
            return;
        }

        var provided = context.Request.Headers[HeaderName].FirstOrDefault();
        if (string.IsNullOrEmpty(provided) || !FixedTimeEquals(provided, _expectedKey))
        {
            context.Response.StatusCode = 401;
            context.Response.ContentType = "application/json";
            var correlationId = context.Items["CorrelationId"] as string;
            await context.Response.WriteAsync(
                System.Text.Json.JsonSerializer.Serialize(new
                {
                    error = "Missing or invalid app key.",
                    code = "unauthorized",
                    correlationId,
                }));
            return;
        }

        await _next(context);
    }

    private static bool IsPublicPath(string path)
    {
        if (path == "/" || path.StartsWith("/openapi", StringComparison.OrdinalIgnoreCase))
            return true;
        if (path.Equals("/api/health", StringComparison.OrdinalIgnoreCase))
            return true;
        if (path.Equals("/healthz", StringComparison.OrdinalIgnoreCase))
            return true;
        if (path.StartsWith("/.well-known/", StringComparison.OrdinalIgnoreCase))
            return true;
        return false;
    }

    // Constant-time compare so we don't leak the expected key length or prefix
    // through response timing.
    private static bool FixedTimeEquals(string a, string b)
    {
        if (a.Length != b.Length) return false;
        int diff = 0;
        for (int i = 0; i < a.Length; i++)
            diff |= a[i] ^ b[i];
        return diff == 0;
    }
}
