namespace DIYHelper2.Api.Middleware;

/// <summary>
/// Adds defensive HTTP headers to every response. Keeps the set minimal since
/// the server is a JSON API, not an HTML surface.
/// - HSTS (production only): tell browsers to force HTTPS.
/// - X-Content-Type-Options: no MIME-sniffing of JSON responses.
/// - Referrer-Policy: strip the Referer when linking out.
/// - Cache-Control: no-store on /api/* so intermediaries don't cache
///   user-specific AI responses, help-request data, etc.
/// </summary>
public class SecurityHeadersMiddleware
{
    private readonly RequestDelegate _next;
    private readonly bool _isProduction;

    public SecurityHeadersMiddleware(RequestDelegate next, IHostEnvironment env)
    {
        _next = next;
        _isProduction = env.IsProduction();
    }

    public async Task InvokeAsync(HttpContext context)
    {
        context.Response.OnStarting(() =>
        {
            var headers = context.Response.Headers;
            headers["X-Content-Type-Options"] = "nosniff";
            headers["Referrer-Policy"] = "no-referrer";

            if (_isProduction)
                headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains";

            var path = context.Request.Path.Value ?? "";
            if (path.StartsWith("/api/", StringComparison.OrdinalIgnoreCase))
                headers["Cache-Control"] = "no-store";

            return Task.CompletedTask;
        });

        await _next(context);
    }
}
