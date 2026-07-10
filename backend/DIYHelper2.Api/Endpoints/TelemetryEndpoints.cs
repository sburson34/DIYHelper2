namespace DIYHelper2.Api.Endpoints;

/// <summary>
/// Anonymous product-usage telemetry: the mobile ingest endpoint plus the
/// operator-only usage-digest and per-brand MAU rollups.
/// </summary>
public static class TelemetryEndpoints
{
    public static IEndpointRouteBuilder MapTelemetry(this IEndpointRouteBuilder app)
    {
        // ── Anonymous product telemetry ───────────────────────────────────────────
        // Ingest is anonymous (events keyed on a per-install AnonId, never a user).
        // The digest is an operator tool gated by Sburson.Shared.Telemetry.UsageDigestGate
        // (open in Dev/Testing; in prod needs Telemetry:AllowDigestInProd + a matching
        // X-Admin-Token header).
        app.MapPost("/api/telemetry/events", async (
            HttpContext http,
            Sburson.Shared.Telemetry.TelemetryBatchDto? body,
            DIYHelper2.Api.Services.Telemetry.TelemetryIngestService ingest,
            CancellationToken ct) =>
        {
            // White-label attribution for per-brand MAU billing. Sourced from the
            // X-Brand header (never the body) so a client can't spoof another tenant's
            // usage. Left null when absent — unlike leads we do NOT default to the
            // flagship, so events from pre-brand clients surface as "(unattributed)" in
            // the billing rollup instead of silently padding DIYHelper's count.
            var brand = (http.Request.Headers["X-Brand"].FirstOrDefault() ?? "").Trim().ToLowerInvariant();
            if (string.IsNullOrEmpty(brand)) brand = null;

            var result = await ingest.IngestAsync(body, brand, ct);
            return Results.Accepted(value: new { ingested = result.Ingested, dropped = result.Dropped });
        });

        app.MapGet("/api/admin/usage-digest", async (
            HttpContext http,
            DIYHelper2.Api.Services.Telemetry.UsageDigestService digest,
            IWebHostEnvironment env,
            IConfiguration cfg,
            CancellationToken ct,
            int days = 30,
            int topN = 25) =>
        {
            var token = http.Request.Headers[Sburson.Shared.Telemetry.UsageDigestGate.AdminTokenHeader].ToString();
            if (!Sburson.Shared.Telemetry.UsageDigestGate.IsAllowed(env, cfg, token))
                return Results.NotFound();
            return Results.Ok(await digest.BuildAsync(days, topN, ct));
        });

        // Per-brand monthly-active-install rollup — the billing number for white-label
        // per-brand MAU pricing. COUNT(DISTINCT AnonId) per brand over the window, plus
        // event totals; untagged traffic shows as "(unattributed)". Same access gate as
        // the usage digest (open in Dev/Testing; in prod needs the admin token).
        app.MapGet("/api/admin/brand-mau", async (
            HttpContext http,
            DIYHelper2.Api.Services.Telemetry.UsageDigestService digest,
            IWebHostEnvironment env,
            IConfiguration cfg,
            CancellationToken ct,
            int days = 30) =>
        {
            var token = http.Request.Headers[Sburson.Shared.Telemetry.UsageDigestGate.AdminTokenHeader].ToString();
            if (!Sburson.Shared.Telemetry.UsageDigestGate.IsAllowed(env, cfg, token))
                return Results.NotFound();
            return Results.Ok(await digest.BuildBrandMauAsync(days, ct));
        });

        return app;
    }
}
