using DIYHelper2.Api.Integrations;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;

namespace DIYHelper2.Api.Endpoints;

/// <summary>
/// Content and reference-data endpoints: community projects (in-memory), the
/// emergency directory, public feature flags, and the external-API lookups
/// (weather, Reddit, PubChem safety data, property-value impact).
/// </summary>
public static class ContentEndpoints
{
    // In-memory community projects store (#18). Replace with DB once schema is settled.
    // ConcurrentQueue lets POST and GET run without serialising on a lock.
    private static readonly System.Collections.Concurrent.ConcurrentQueue<CommunityProjectDto> communityProjects = new();
    private const int CommunityProjectsMax = 500;

    public static IEndpointRouteBuilder MapContent(this IEndpointRouteBuilder app)
    {
        // ── #18 community projects (in-memory; replace with DB if persistent) ──
        app.MapPost("/api/community-projects", [EnableRateLimiting("submit")] ([FromBody] CommunityProjectDto dto) =>
        {
            var entry = dto with { Id = Guid.NewGuid().ToString(), CreatedAt = DateTime.UtcNow };
            communityProjects.Enqueue(entry);
            while (communityProjects.Count > CommunityProjectsMax && communityProjects.TryDequeue(out _)) { }
            return Results.Created($"/api/community-projects/{entry.Id}", entry);
        });

        app.MapGet("/api/community-projects", ([FromQuery] string? q) =>
        {
            // Snapshot newest-first.
            IEnumerable<CommunityProjectDto> results = communityProjects.Reverse();
            if (!string.IsNullOrWhiteSpace(q))
            {
                var ql = q.ToLowerInvariant();
                results = results.Where(p =>
                    (p.Title ?? "").ToLowerInvariant().Contains(ql) ||
                    (p.Description ?? "").ToLowerInvariant().Contains(ql));
            }
            return Results.Ok(results.Take(50));
        });

        // ── #16 emergency directory (static for now) ───────────────────────
        app.MapGet("/api/emergency", () =>
        {
            return Results.Ok(new
            {
                categories = new[]
                {
                    new { id = "water", label = "Active leak / burst pipe", instructions = new[] { "Shut off your home's main water valve.", "Open a faucet to release pressure.", "Move valuables away from the leak." }, callType = "plumber" },
                    new { id = "electric", label = "Sparking outlet / shock", instructions = new[] { "Do NOT touch the affected outlet.", "Trip the breaker for that circuit at your panel.", "Unplug nearby devices once safe." }, callType = "electrician" },
                    new { id = "gas", label = "Gas smell", instructions = new[] { "Leave the building immediately.", "Do not flip light switches or use phones inside.", "Call your gas utility and 911 from outside." }, callType = "gas-utility" },
                    new { id = "fire", label = "Active fire", instructions = new[] { "Get out, stay out, call 911." }, callType = "911" },
                }
            });
        });

        // ══════════════════════════════════════════════════════════════════════════
        // External-API integration endpoints
        // ══════════════════════════════════════════════════════════════════════════

        // ── Feature flags (frontend polls this on boot) ────────────────────
        app.MapGet("/api/features", (FeatureFlags flags) => Results.Ok(flags.ToPublicJson()));

        // ── Weather forecast for an outdoor project ────────────────────────
        app.MapGet("/api/weather", async ([FromQuery] string zip, [FromQuery] int? days, WeatherClient weather) =>
        {
            if (string.IsNullOrWhiteSpace(zip))
                return Results.Json(new { error = "zip query parameter is required." }, statusCode: 400);
            if (!weather.IsConfigured)
                return Results.Json(new { error = "Weather service not configured.", configured = false }, statusCode: 503);
            var forecast = await weather.GetForecastAsync(zip, days ?? 5);
            if (forecast is null)
                return Results.Json(new { error = "Weather lookup failed." }, statusCode: 502);
            return Results.Ok(forecast);
        });

        // ── Reddit community discussions ───────────────────────────────────
        app.MapGet("/api/reddit-discussions", async ([FromQuery] string query, RedditClient reddit) =>
        {
            if (string.IsNullOrWhiteSpace(query))
                return Results.Json(new { error = "query parameter is required." }, statusCode: 400);
            var threads = await reddit.SearchAsync(query);
            return Results.Ok(new { threads });
        });

        // ── PubChem safety data for a single chemical ──────────────────────
        app.MapGet("/api/safety-data", async ([FromQuery] string chemical, PubChemClient pubChem) =>
        {
            if (string.IsNullOrWhiteSpace(chemical))
                return Results.Json(new { error = "chemical parameter is required." }, statusCode: 400);
            var data = await pubChem.LookupAsync(chemical);
            if (data is null)
                return Results.Json(new { error = "Chemical not found or PubChem unavailable." }, statusCode: 404);
            return Results.Ok(new
            {
                chemical = data.Chemical,
                cid = data.Cid,
                hazards = data.Hazards,
                pictograms = data.GhsPictograms,
                firstAid = data.FirstAid,
                storage = data.Storage,
            });
        });

        // ── Property-value impact (ATTOM or static fallback) ───────────────
        app.MapGet("/api/property-value-impact", async (
            [FromQuery] string? zip,
            [FromQuery] string repairType,
            [FromQuery] double estimatedCost,
            AttomClient attom,
            FeatureFlags features) =>
        {
            if (string.IsNullOrWhiteSpace(repairType))
                return Results.Json(new { error = "repairType parameter is required." }, statusCode: 400);
            var impact = await attom.EstimateAsync(zip ?? "", repairType, estimatedCost);
            if (impact is null)
                return Results.Json(new { error = "Property value lookup failed." }, statusCode: 502);
            return Results.Ok(new
            {
                estimatedValueAdd = impact.EstimatedValueAdd,
                confidence = impact.Confidence,
                source = impact.Source,
                attomEnabled = features.Attom,
            });
        });

        return app;
    }
}
