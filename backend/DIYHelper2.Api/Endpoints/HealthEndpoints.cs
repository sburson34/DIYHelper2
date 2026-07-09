using DIYHelper2.Api.Data;

namespace DIYHelper2.Api.Endpoints;

/// <summary>
/// Liveness/readiness probes, the root banner, and the RFC 9116 disclosure
/// contact. Registration position relative to the middleware pipeline doesn't
/// matter (endpoint routing matches independently), so these live together.
/// </summary>
public static class HealthEndpoints
{
    public static IEndpointRouteBuilder MapHealth(this IEndpointRouteBuilder app, IHostEnvironment env)
    {
        app.MapGet("/", () => "DIYHelper2 API is running on " + DateTime.Now);
        app.MapGet("/api/health", () => Results.Ok(new { status = "healthy", timestamp = DateTime.UtcNow }));

        // Simple liveness probe for Docker / Caddy upstream healthcheck. Distinct
        // from /readyz so a transient DB blip never causes the orchestrator to kill an
        // otherwise-healthy container (that would turn a brief DB hiccup into a
        // full restart). Stays shallow on purpose.
        app.MapGet("/healthz", () => Results.Ok());

        // Readiness probe — verifies the process can actually reach its database before
        // it should be sent traffic. Returns 503 (not 200) when the DB is unreachable
        // so a load balancer / readiness check can drain this instance instead of
        // routing requests that will only fail. This is what catches the "started but
        // pointed at the wrong/dead DB" case that the static /healthz cannot.
        app.MapGet("/readyz", async (AppDbContext db, CancellationToken ct) =>
        {
            try
            {
                var canConnect = await db.Database.CanConnectAsync(ct);
                return canConnect
                    ? Results.Ok(new { status = "ready", db = "up" })
                    : Results.Json(new { status = "not_ready", db = "down" }, statusCode: 503);
            }
            catch (Exception)
            {
                return Results.Json(new { status = "not_ready", db = "down" }, statusCode: 503);
            }
        });

        // StaticFileMiddleware ignores dot-prefixed directories by default, so
        // /.well-known/security.txt would otherwise 404 even though the file exists in
        // wwwroot/.well-known/. Map it explicitly so security researchers can find
        // our disclosure contact per RFC 9116. AppKeyMiddleware already bypasses
        // /.well-known/ paths.
        app.MapGet("/.well-known/security.txt", (IWebHostEnvironment hostEnv) =>
        {
            var path = Path.Combine(hostEnv.WebRootPath ?? "wwwroot", ".well-known", "security.txt");
            if (!File.Exists(path)) return Results.NotFound();
            return Results.File(path, "text/plain; charset=utf-8");
        });

        if (env.IsDevelopment())
        {
            app.MapGet("/api/sentry-test", () =>
            {
                throw new InvalidOperationException("Sentry wiring smoke test (intentional throw)");
            });
        }

        return app;
    }
}
