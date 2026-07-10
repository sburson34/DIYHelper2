using DIYHelper2.Api;
using DIYHelper2.Api.Data;
using DIYHelper2.Api.Models;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using static DIYHelper2.Api.Endpoints.EndpointHelpers;

namespace DIYHelper2.Api.Endpoints;

/// <summary>
/// Owner-managed customer equipment (admin-gated via AdminAuthMiddleware's
/// <c>/api/assets</c> rule; the customer-facing <c>/api/my/assets</c> routes
/// live in <see cref="CustomerAppEndpoints"/> and stay public). Brand scoping
/// mirrors technicians: scoped logins see/edit only their own rows,
/// super-admin filters with <c>?brand=</c> and supplies <c>brand</c> in the
/// POST body; cross-tenant ids 404.
/// </summary>
public static class AssetEndpoints
{
    public static IEndpointRouteBuilder MapAssets(this IEndpointRouteBuilder app)
    {
        app.MapGet("/api/assets", async (
            [FromQuery] string? brand, [FromQuery] string? customerEmail,
            HttpContext http, AppDbContext db) =>
        {
            var q = db.Assets.WhereBrandVisible(BrandScopeOf(http), brand);
            if (!string.IsNullOrWhiteSpace(customerEmail))
                q = q.Where(a => a.CustomerEmail == customerEmail);

            var assets = await q
                .OrderBy(a => a.Label).ThenBy(a => a.Id)
                .ToListAsync();
            return Results.Ok(assets.Select(OwnerAssetView));
        });

        app.MapPost("/api/assets", async ([FromBody] OwnerAssetDto dto, HttpContext http, AppDbContext db) =>
        {
            // Brand resolution follows the technicians POST: a scoped login's
            // brand always wins; super-admin must say which tenant in the body.
            var scope = BrandScopeOf(http);
            var brand = scope ?? dto.Brand?.Trim().ToLowerInvariant();
            if (string.IsNullOrEmpty(brand)) return ApiError.BadRequest(http, "A brand is required to create an asset.");
            if (string.IsNullOrWhiteSpace(dto.Label)) return ApiError.BadRequest(http, "label is required.");

            var asset = new Asset
            {
                Brand = brand,
                CustomerEmail = string.IsNullOrWhiteSpace(dto.CustomerEmail) ? null : dto.CustomerEmail.Trim(),
                PropertyId = dto.PropertyId,
                Label = dto.Label.Trim(),
                Make = dto.Make,
                Model = dto.Model,
                Serial = dto.Serial,
                InstalledAt = dto.InstalledAt,
                WarrantyExpiresAt = dto.WarrantyExpiresAt,
                Notes = dto.Notes,
                IsActive = dto.IsActive ?? true,
            };
            db.Assets.Add(asset);
            await db.SaveChangesAsync();
            return Results.Created($"/api/assets/{asset.Id}", OwnerAssetView(asset));
        });

        app.MapPut("/api/assets/{id:int}", async (int id, [FromBody] OwnerAssetDto dto, HttpContext http, AppDbContext db) =>
        {
            var asset = await db.Assets.FindAsync(id);
            if (asset is null) return Results.NotFound();
            if (CrossTenant(http, asset.Brand)) return Results.NotFound();

            // Partial update (technicians PUT pattern): null leaves a field alone.
            if (dto.CustomerEmail is not null)
                asset.CustomerEmail = string.IsNullOrWhiteSpace(dto.CustomerEmail) ? null : dto.CustomerEmail.Trim();
            if (dto.PropertyId.HasValue) asset.PropertyId = dto.PropertyId;
            if (dto.Label is not null)
            {
                if (string.IsNullOrWhiteSpace(dto.Label)) return ApiError.BadRequest(http, "label can't be blank.");
                asset.Label = dto.Label.Trim();
            }
            if (dto.Make is not null) asset.Make = dto.Make;
            if (dto.Model is not null) asset.Model = dto.Model;
            if (dto.Serial is not null) asset.Serial = dto.Serial;
            if (dto.InstalledAt.HasValue) asset.InstalledAt = dto.InstalledAt;
            if (dto.WarrantyExpiresAt.HasValue) asset.WarrantyExpiresAt = dto.WarrantyExpiresAt;
            if (dto.Notes is not null) asset.Notes = dto.Notes;
            if (dto.IsActive.HasValue) asset.IsActive = dto.IsActive.Value;
            asset.UpdatedAt = DateTime.UtcNow;
            await db.SaveChangesAsync();
            return Results.Ok(OwnerAssetView(asset));
        });

        app.MapDelete("/api/assets/{id:int}", async (int id, HttpContext http, AppDbContext db) =>
        {
            var asset = await db.Assets.FindAsync(id);
            if (asset is null) return Results.NotFound();
            if (CrossTenant(http, asset.Brand)) return Results.NotFound();
            db.Assets.Remove(asset);
            await db.SaveChangesAsync();
            return Results.NoContent();
        });

        return app;
    }

    // Owner-side projection (includes tenancy + lifecycle fields the customer
    // shape omits).
    private static object OwnerAssetView(Asset a) => new
    {
        id = a.Id,
        brand = a.Brand,
        customerEmail = a.CustomerEmail,
        propertyId = a.PropertyId,
        label = a.Label,
        make = a.Make,
        model = a.Model,
        serial = a.Serial,
        installedAt = a.InstalledAt,
        warrantyExpiresAt = a.WarrantyExpiresAt,
        notes = a.Notes,
        isActive = a.IsActive,
    };
}
