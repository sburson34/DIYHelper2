using DIYHelper2.Api;
using DIYHelper2.Api.Data;
using DIYHelper2.Api.Models;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using static DIYHelper2.Api.Endpoints.EndpointHelpers;

namespace DIYHelper2.Api.Endpoints;

/// <summary>
/// Owner-managed technician roster (admin-gated): CRUD plus one-time login
/// code issuance/rotation.
/// </summary>
public static class TechnicianEndpoints
{
    public static IEndpointRouteBuilder MapTechnicians(this IEndpointRouteBuilder app)
    {
        // ── Technicians (owner-managed; admin-gated by AdminAuthMiddleware) ────────
        // The owner creates techs and issues each a login code (shown once). Scoped
        // like leads: a per-brand login only sees/edits its own techs; super-admin can
        // pass ?brand= / brand in the body.
        app.MapGet("/api/technicians", async ([FromQuery] string? brand, HttpContext http, AppDbContext db) =>
        {
            var q = db.Technicians.WhereBrandVisible(BrandScopeOf(http), brand);

            var techs = await q
                .OrderBy(t => t.Name)
                .Select(t => new { t.Id, t.Brand, t.Name, t.Phone, t.Email, t.IsActive, hasCode = t.LoginCodeHash != null, t.CreatedAt })
                .ToListAsync();
            return Results.Ok(techs);
        });

        app.MapPost("/api/technicians", async ([FromBody] CreateTechnicianDto dto, HttpContext http, AppDbContext db) =>
        {
            var scope = BrandScopeOf(http);
            var brand = scope ?? dto.Brand?.Trim().ToLowerInvariant();
            if (string.IsNullOrEmpty(brand)) return ApiError.BadRequest(http, "A brand is required to create a technician.");
            if (string.IsNullOrWhiteSpace(dto.Name)) return ApiError.BadRequest(http, "Technician name is required.");

            var code = GenerateTechCode();
            var tech = new Technician
            {
                Brand = brand,
                Name = dto.Name.Trim(),
                Phone = dto.Phone,
                Email = dto.Email,
                LoginCodeHash = Sburson.Shared.Auth.PasswordHasher.Hash(code),
                IsActive = true,
            };
            db.Technicians.Add(tech);
            await db.SaveChangesAsync();
            // loginCode is returned exactly once — the owner shares it with the tech.
            return Results.Created($"/api/technicians/{tech.Id}",
                new { tech.Id, tech.Name, tech.Phone, tech.Email, tech.IsActive, loginCode = code });
        });

        app.MapPut("/api/technicians/{id:int}", async (int id, [FromBody] UpdateTechnicianDto dto, HttpContext http, AppDbContext db) =>
        {
            var tech = await db.Technicians.FindAsync(id);
            if (tech is null) return Results.NotFound();
            if (CrossTenant(http, tech.Brand)) return Results.NotFound();

            if (dto.Name is not null) tech.Name = dto.Name.Trim();
            if (dto.Phone is not null) tech.Phone = dto.Phone;
            if (dto.Email is not null) tech.Email = dto.Email;
            if (dto.IsActive.HasValue) tech.IsActive = dto.IsActive.Value;
            tech.UpdatedAt = DateTime.UtcNow;
            await db.SaveChangesAsync();
            return Results.Ok(new { tech.Id, tech.Name, tech.Phone, tech.Email, tech.IsActive });
        });

        // Regenerate a tech's login code (lost code / rotate). Returns the new code once.
        app.MapPost("/api/technicians/{id:int}/code", async (int id, HttpContext http, AppDbContext db) =>
        {
            var tech = await db.Technicians.FindAsync(id);
            if (tech is null) return Results.NotFound();
            if (CrossTenant(http, tech.Brand)) return Results.NotFound();

            var code = GenerateTechCode();
            tech.LoginCodeHash = Sburson.Shared.Auth.PasswordHasher.Hash(code);
            tech.UpdatedAt = DateTime.UtcNow;
            await db.SaveChangesAsync();
            return Results.Ok(new { loginCode = code });
        });

        app.MapDelete("/api/technicians/{id:int}", async (int id, HttpContext http, AppDbContext db) =>
        {
            var tech = await db.Technicians.FindAsync(id);
            if (tech is null) return Results.NotFound();
            if (CrossTenant(http, tech.Brand)) return Results.NotFound();
            db.Technicians.Remove(tech);
            await db.SaveChangesAsync();
            return Results.NoContent();
        });

        return app;
    }
}
