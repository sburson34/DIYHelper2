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
}
