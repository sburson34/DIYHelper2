using DIYHelper2.Api;
using DIYHelper2.Api.Data;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using static DIYHelper2.Api.Endpoints.EndpointHelpers;

namespace DIYHelper2.Api.Endpoints;

/// <summary>
/// Brand surfaces (admin-gated under /api/brands): the caller-scoped brand
/// list plus the Brand Studio website extractor and its image proxy.
/// </summary>
public static class BrandEndpoints
{
    public static IEndpointRouteBuilder MapBrands(this IEndpointRouteBuilder app)
    {
        // Brands available to the caller — powers the dashboard's brand filter.
        // Super-admin sees all; a scoped login sees only its own. Never exposes
        // credentials (projection is slug + company name only).
        app.MapGet("/api/brands", async (HttpContext http, AppDbContext db) =>
        {
            var isSuper = http.Items.ContainsKey("IsSuperAdmin");
            var scope = BrandScopeOf(http);
            var q = db.Brands.AsQueryable();
            if (!isSuper && scope is not null)
                q = q.Where(b => b.Slug == scope);
            var brands = await q
                .OrderBy(b => b.CompanyName)
                .Select(b => new { slug = b.Slug, companyName = b.CompanyName })
                .ToListAsync();
            return Results.Ok(new { isSuperAdmin = isSuper, brands });
        });

        // ── Self-scheduling configuration (admin-gated under /api/brands) ──
        // A scoped login may only read/write its own brand's scheduling; a
        // mismatched slug 404s (never 403) like every other scoped surface.

        static object SchedulingView(DIYHelper2.Api.Models.Brand b)
        {
            System.Text.Json.Nodes.JsonNode? hours = null;
            if (!string.IsNullOrWhiteSpace(b.BusinessHoursJson))
            {
                try { hours = System.Text.Json.Nodes.JsonNode.Parse(b.BusinessHoursJson); }
                catch (System.Text.Json.JsonException) { /* malformed row → null */ }
            }
            return new
            {
                businessHours = hours,
                slotMinutes = b.SlotMinutes,
                slotCapacity = b.SlotCapacity,
                timeZoneId = b.TimeZoneId,
            };
        }

        app.MapGet("/api/brands/{slug}/scheduling", async (string slug, HttpContext http, AppDbContext db) =>
        {
            var scope = BrandScopeOf(http);
            if (scope is not null && scope != slug) return Results.NotFound();
            var brand = await db.Brands.FirstOrDefaultAsync(b => b.Slug == slug);
            if (brand is null) return Results.NotFound();
            return Results.Ok(SchedulingView(brand));
        });

        app.MapPut("/api/brands/{slug}/scheduling", async (
            string slug, [FromBody] UpdateSchedulingDto dto, HttpContext http, AppDbContext db) =>
        {
            var scope = BrandScopeOf(http);
            if (scope is not null && scope != slug) return Results.NotFound();
            var brand = await db.Brands.FirstOrDefaultAsync(b => b.Slug == slug);
            if (brand is null) return Results.NotFound();

            if (dto.SlotMinutes is { } mins)
            {
                if (mins is < 15 or > 480)
                    return ApiError.BadRequest(http, "slotMinutes must be between 15 and 480.");
                brand.SlotMinutes = mins;
            }

            if (dto.SlotCapacity is { } cap && cap < 1)
                return ApiError.BadRequest(http, "slotCapacity must be at least 1 (or null for the active-tech count).");
            brand.SlotCapacity = dto.SlotCapacity; // null ⇒ auto (active-tech count)

            if (!string.IsNullOrWhiteSpace(dto.TimeZoneId))
            {
                try { TimeZoneInfo.FindSystemTimeZoneById(dto.TimeZoneId.Trim()); }
                catch (Exception e) when (e is TimeZoneNotFoundException or InvalidTimeZoneException)
                {
                    return ApiError.BadRequest(http, "timeZoneId must be a valid IANA time zone (e.g. America/Chicago).");
                }
                brand.TimeZoneId = dto.TimeZoneId.Trim();
            }

            if (dto.BusinessHours is { } hoursEl && hoursEl.ValueKind != System.Text.Json.JsonValueKind.Undefined)
            {
                if (hoursEl.ValueKind == System.Text.Json.JsonValueKind.Null)
                {
                    brand.BusinessHoursJson = null; // self-scheduling off
                }
                else
                {
                    if (ValidateBusinessHours(http, hoursEl) is { } hoursErr) return hoursErr;
                    brand.BusinessHoursJson = hoursEl.GetRawText();
                }
            }

            brand.UpdatedAt = DateTime.UtcNow;
            await db.SaveChangesAsync();
            return Results.Ok(SchedulingView(brand));
        });

        // Brand Studio: scrape a customer's website to seed a white-label brand
        // (colors, logo, company name, fonts, legal links). Admin-gated (path starts
        // with /api/brands) and SSRF-guarded via the typed client. Returns a draft the
        // operator reviews/adjusts — never a finished config.
        app.MapGet("/api/brands/extract", async (
            [FromQuery] string? url, HttpContext http,
            DIYHelper2.Api.Integrations.BrandExtractionClient extractor) =>
        {
            if (string.IsNullOrWhiteSpace(url)
                || !Uri.TryCreate(url.Trim(), UriKind.Absolute, out var uri)
                || (uri.Scheme != Uri.UriSchemeHttp && uri.Scheme != Uri.UriSchemeHttps))
                return ApiError.BadRequest(http, "Enter a valid http(s) website URL.");

            var result = await extractor.ExtractAsync(uri);
            return Results.Ok(result);
        });

        // Same-origin image proxy so the Brand Studio can draw a remote logo onto a
        // canvas (to build an app icon) without cross-origin taint blocking export.
        // Admin-gated (path starts with /api/brands) and SSRF-guarded via the client.
        app.MapGet("/api/brands/proxy-image", async (
            [FromQuery] string? url, HttpContext http,
            DIYHelper2.Api.Integrations.BrandExtractionClient client) =>
        {
            if (string.IsNullOrWhiteSpace(url)
                || !Uri.TryCreate(url.Trim(), UriKind.Absolute, out var uri)
                || (uri.Scheme != Uri.UriSchemeHttp && uri.Scheme != Uri.UriSchemeHttps))
                return ApiError.BadRequest(http, "A valid http(s) image URL is required.");

            var image = await client.FetchImageAsync(uri);
            if (image is null) return Results.NotFound();
            return Results.File(image.Value.Bytes, image.Value.ContentType);
        });

        return app;
    }

    /// <summary>400 when the businessHours payload isn't
    /// <c>{"mon":[{"start":"HH:mm","end":"HH:mm"}], ...}</c> with keys
    /// mon..sun and start&lt;end in every window; null when valid.</summary>
    private static IResult? ValidateBusinessHours(HttpContext http, System.Text.Json.JsonElement hours)
    {
        var validDays = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
            { "mon", "tue", "wed", "thu", "fri", "sat", "sun" };

        if (hours.ValueKind != System.Text.Json.JsonValueKind.Object)
            return ApiError.BadRequest(http, "businessHours must be an object keyed mon..sun.");

        foreach (var day in hours.EnumerateObject())
        {
            if (!validDays.Contains(day.Name))
                return ApiError.BadRequest(http, $"businessHours has an unknown day key '{day.Name}' (use mon..sun).");
            if (day.Value.ValueKind != System.Text.Json.JsonValueKind.Array)
                return ApiError.BadRequest(http, $"businessHours.{day.Name} must be an array of {{start,end}} windows.");

            foreach (var window in day.Value.EnumerateArray())
            {
                if (window.ValueKind != System.Text.Json.JsonValueKind.Object
                    || !window.TryGetProperty("start", out var startEl)
                    || !window.TryGetProperty("end", out var endEl)
                    || startEl.ValueKind != System.Text.Json.JsonValueKind.String
                    || endEl.ValueKind != System.Text.Json.JsonValueKind.String
                    || !TimeOnly.TryParseExact(startEl.GetString(), "HH:mm", out var start)
                    || !TimeOnly.TryParseExact(endEl.GetString(), "HH:mm", out var end))
                    return ApiError.BadRequest(http, $"businessHours.{day.Name} windows need HH:mm start and end times.");
                if (end <= start)
                    return ApiError.BadRequest(http, $"businessHours.{day.Name} has a window whose end isn't after its start.");
            }
        }
        return null;
    }
}
