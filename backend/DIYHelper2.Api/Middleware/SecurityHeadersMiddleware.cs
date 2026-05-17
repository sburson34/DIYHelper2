namespace DIYHelper2.Api.Middleware;

/// <summary>
/// Adds defensive HTTP headers to every response. Keeps the set minimal since
/// the server is a JSON API, not an HTML surface. Defense-in-depth duplicates
/// what Caddyfile sets at the edge so direct hits to the container (e.g. when
/// debugging without the reverse proxy in front) still get the same headers.
/// - HSTS (production only): tell browsers to force HTTPS.
/// - X-Content-Type-Options: no MIME-sniffing of JSON responses.
/// - X-Frame-Options: block framing of any /admin HTML.
/// - Referrer-Policy: strip the Referer when linking out.
/// - Cross-Origin-Resource-Policy: deny cross-origin reads of API responses.
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
            headers["X-Frame-Options"] = "DENY";
            headers["Referrer-Policy"] = "no-referrer";
            headers["Cross-Origin-Resource-Policy"] = "same-origin";

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
