using DIYHelper2.Api;
using DIYHelper2.Api.Data;
using DIYHelper2.Api.Models;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using static DIYHelper2.Api.Endpoints.EndpointHelpers;

namespace DIYHelper2.Api.Endpoints;

/// <summary>
/// Owner-managed catalogs (admin-gated): the flat-rate price book and the
/// inventory / truck-stock list.
/// </summary>
public static class CatalogEndpoints
{
    public static IEndpointRouteBuilder MapCatalog(this IEndpointRouteBuilder app)
    {
        // ── Price book (owner-managed flat-rate items; admin-gated) ───────────────
        app.MapGet("/api/pricebook", async ([FromQuery] string? brand, HttpContext http, AppDbContext db) =>
        {
            var q = db.PriceBookItems.WhereBrandVisible(BrandScopeOf(http), brand);
            var items = await q.OrderBy(p => p.Name)
                .Select(p => new { p.Id, p.Brand, p.Name, p.DefaultPrice, p.IsActive })
                .ToListAsync();
            return Results.Ok(items);
        });

        app.MapPost("/api/pricebook", async ([FromBody] PriceBookItemDto dto, HttpContext http, AppDbContext db) =>
        {
            var scope = BrandScopeOf(http);
            var brand = scope ?? dto.Brand?.Trim().ToLowerInvariant();
            if (string.IsNullOrEmpty(brand)) return ApiError.BadRequest(http, "A brand is required.");
            if (string.IsNullOrWhiteSpace(dto.Name)) return ApiError.BadRequest(http, "An item name is required.");

            var item = new PriceBookItem
            {
                Brand = brand,
                Name = dto.Name.Trim(),
                DefaultPrice = dto.DefaultPrice ?? 0m,
                IsActive = true,
            };
            db.PriceBookItems.Add(item);
            await db.SaveChangesAsync();
            return Results.Created($"/api/pricebook/{item.Id}",
                new { item.Id, item.Name, item.DefaultPrice, item.IsActive });
        });

        app.MapPut("/api/pricebook/{id:int}", async (int id, [FromBody] PriceBookItemDto dto, HttpContext http, AppDbContext db) =>
        {
            var item = await db.PriceBookItems.FindAsync(id);
            if (item is null) return Results.NotFound();
            if (CrossTenant(http, item.Brand)) return Results.NotFound();
            if (dto.Name is not null) item.Name = dto.Name.Trim();
            if (dto.DefaultPrice.HasValue) item.DefaultPrice = dto.DefaultPrice.Value;
            if (dto.IsActive.HasValue) item.IsActive = dto.IsActive.Value;
            item.UpdatedAt = DateTime.UtcNow;
            await db.SaveChangesAsync();
            return Results.Ok(new { item.Id, item.Name, item.DefaultPrice, item.IsActive });
        });

        app.MapDelete("/api/pricebook/{id:int}", async (int id, HttpContext http, AppDbContext db) =>
        {
            var item = await db.PriceBookItems.FindAsync(id);
            if (item is null) return Results.NotFound();
            if (CrossTenant(http, item.Brand)) return Results.NotFound();
            db.PriceBookItems.Remove(item);
            await db.SaveChangesAsync();
            return Results.NoContent();
        });

        // ── Inventory / truck stock (owner-managed; admin-gated) ──────────────────
        app.MapGet("/api/inventory", async ([FromQuery] string? brand, HttpContext http, AppDbContext db) =>
        {
            var q = db.InventoryItems.WhereBrandVisible(BrandScopeOf(http), brand);
            var items = await q.OrderBy(i => i.Name)
                .Select(i => new { i.Id, i.Brand, i.Name, i.Sku, i.Quantity, i.ReorderAt, low = i.ReorderAt > 0 && i.Quantity <= i.ReorderAt })
                .ToListAsync();
            return Results.Ok(items);
        });

        app.MapPost("/api/inventory", async ([FromBody] InventoryItemDto dto, HttpContext http, AppDbContext db) =>
        {
            var scope = BrandScopeOf(http);
            var brand = scope ?? dto.Brand?.Trim().ToLowerInvariant();
            if (string.IsNullOrEmpty(brand)) return ApiError.BadRequest(http, "A brand is required.");
            if (string.IsNullOrWhiteSpace(dto.Name)) return ApiError.BadRequest(http, "An item name is required.");
            var item = new InventoryItem
            {
                Brand = brand,
                Name = dto.Name.Trim(),
                Sku = dto.Sku,
                Quantity = dto.Quantity ?? 0,
                ReorderAt = dto.ReorderAt ?? 0,
            };
            db.InventoryItems.Add(item);
            await db.SaveChangesAsync();
            return Results.Created($"/api/inventory/{item.Id}", new { item.Id, item.Name, item.Sku, item.Quantity, item.ReorderAt });
        });

        app.MapPut("/api/inventory/{id:int}", async (int id, [FromBody] InventoryItemDto dto, HttpContext http, AppDbContext db) =>
        {
            var item = await db.InventoryItems.FindAsync(id);
            if (item is null) return Results.NotFound();
            if (CrossTenant(http, item.Brand)) return Results.NotFound();
            if (dto.Name is not null) item.Name = dto.Name.Trim();
            if (dto.Sku is not null) item.Sku = dto.Sku;
            if (dto.Quantity.HasValue) item.Quantity = dto.Quantity.Value;
            if (dto.ReorderAt.HasValue) item.ReorderAt = dto.ReorderAt.Value;
            item.UpdatedAt = DateTime.UtcNow;
            await db.SaveChangesAsync();
            return Results.Ok(new { item.Id, item.Name, item.Sku, item.Quantity, item.ReorderAt });
        });

        app.MapDelete("/api/inventory/{id:int}", async (int id, HttpContext http, AppDbContext db) =>
        {
            var item = await db.InventoryItems.FindAsync(id);
            if (item is null) return Results.NotFound();
            if (CrossTenant(http, item.Brand)) return Results.NotFound();
            db.InventoryItems.Remove(item);
            await db.SaveChangesAsync();
            return Results.NoContent();
        });

        return app;
    }
}
