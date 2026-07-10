using DIYHelper2.Api;
using DIYHelper2.Api.Data;
using DIYHelper2.Api.Validation;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.EntityFrameworkCore;
using static DIYHelper2.Api.Endpoints.EndpointHelpers;

namespace DIYHelper2.Api.Endpoints;

/// <summary>
/// Mobile "tech mode": code login plus the token-gated job list/detail/update
/// and on-site payment-link surfaces.
/// </summary>
public static class TechPortalEndpoints
{
    public static IEndpointRouteBuilder MapTechPortal(this IEndpointRouteBuilder app)
    {
        // ── Tech mode (mobile; authenticated by a signed tech bearer token) ───────
        // Public paths (not admin-gated); each call carries the token minted at login.
        app.MapPost("/api/tech/login", [EnableRateLimiting("submit")] async (
            [FromBody] TechLoginDto dto,
            HttpContext http,
            AppDbContext db,
            DIYHelper2.Api.Services.TechTokenService tokens) =>
        {
            var brand = BrandFromHeader(http);
            var code = (dto.Code ?? "").Trim();
            if (string.IsNullOrEmpty(code)) return ApiError.BadRequest(http, "A login code is required.");

            // Verify the code against each active tech in the brand. N is a single
            // crew, so the per-row BCrypt cost is fine; we don't short-circuit early so
            // timing doesn't leak how many techs exist.
            var techs = await db.Technicians
                .Where(t => t.Brand == brand && t.IsActive && t.LoginCodeHash != null)
                .Select(t => new { t.Id, t.Name, t.LoginCodeHash })
                .ToListAsync();

            int matchedId = 0;
            string matchedName = "";
            foreach (var t in techs)
            {
                if (Sburson.Shared.Auth.PasswordHasher.Verify(code, t.LoginCodeHash!) && matchedId == 0)
                {
                    matchedId = t.Id;
                    matchedName = t.Name;
                }
            }
            if (matchedId == 0)
                return Results.Json(new { error = "That code isn't valid.", code = "tech_unauthorized" }, statusCode: 401);

            var token = tokens.Issue(matchedId, brand);
            return Results.Ok(new { token, technicianId = matchedId, name = matchedName });
        });

        app.MapGet("/api/tech/jobs", async (
            HttpContext http, AppDbContext db, DIYHelper2.Api.Services.TechTokenService tokens) =>
        {
            var who = TechPrincipalOf(http, tokens);
            if (who is null) return Results.Json(new { error = "Sign in required.", code = "tech_unauthorized" }, statusCode: 401);

            var jobs = await db.HelpRequests
                .Where(r => r.Brand == who.Brand && r.AssignedTechId == who.TechId)
                .OrderBy(r => r.Status == "completed" || r.Status == "cancelled")   // active first
                .ThenBy(r => r.ScheduledFor ?? r.CreatedAt)
                .Select(r => new
                {
                    r.Id,
                    r.ProjectTitle,
                    r.ServiceType,
                    r.Status,
                    r.CustomerName,
                    r.CustomerPhone,
                    r.ScheduledFor,
                    r.PreferredWindow,
                    r.TechEtaMinutes,
                    r.CreatedAt,
                })
                .ToListAsync();
            return Results.Ok(jobs);
        });

        app.MapGet("/api/tech/jobs/{id:int}", async (
            int id, HttpContext http, AppDbContext db, DIYHelper2.Api.Services.TechTokenService tokens) =>
        {
            var who = TechPrincipalOf(http, tokens);
            if (who is null) return Results.Json(new { error = "Sign in required.", code = "tech_unauthorized" }, statusCode: 401);
            var r = await db.HelpRequests.FindAsync(id);
            if (r is null || r.Brand != who.Brand || r.AssignedTechId != who.TechId) return Results.NotFound();

            return Results.Ok(new
            {
                r.Id,
                r.ProjectTitle,
                r.ServiceType,
                r.Status,
                r.CustomerName,
                r.CustomerPhone,
                r.CustomerEmail,
                r.UserDescription,
                r.ProjectData,
                // Legacy base64 columns: non-null only while the row still
                // carries pre-offload data (dual-read window). New uploads live
                // in S3 and are reachable via the *Url proxy paths below.
                r.ImageBase64,
                r.ScheduledFor,
                r.PreferredWindow,
                r.TechEtaMinutes,
                r.BeforePhotoBase64,
                r.AfterPhotoBase64,
                r.SignatureBase64,
                r.CompletionNotes,
                r.CompletedAt,
                r.CreatedAt,
                ImageUrl = DIYHelper2.Api.Services.JobMediaService.MediaUrl(r, "image", "/api/tech/jobs"),
                BeforePhotoUrl = DIYHelper2.Api.Services.JobMediaService.MediaUrl(r, "before", "/api/tech/jobs"),
                AfterPhotoUrl = DIYHelper2.Api.Services.JobMediaService.MediaUrl(r, "after", "/api/tech/jobs"),
                SignatureUrl = DIYHelper2.Api.Services.JobMediaService.MediaUrl(r, "signature", "/api/tech/jobs"),
            });
        });

        // Media proxy for a tech's assigned job — same token + assigned-job
        // scope as the detail route above.
        app.MapGet("/api/tech/jobs/{id:int}/media/{kind}", async (
            int id, string kind, HttpContext http, AppDbContext db,
            DIYHelper2.Api.Services.TechTokenService tokens,
            DIYHelper2.Api.Services.JobMediaService jobMedia) =>
        {
            var who = TechPrincipalOf(http, tokens);
            if (who is null) return Results.Json(new { error = "Sign in required.", code = "tech_unauthorized" }, statusCode: 401);
            var r = await db.HelpRequests.FindAsync(id);
            if (r is null || r.Brand != who.Brand || r.AssignedTechId != who.TechId) return Results.NotFound();
            return await jobMedia.ServeAsync(r, kind);
        });

        app.MapPut("/api/tech/jobs/{id:int}", [EnableRateLimiting("submit")] async (
            int id, [FromBody] TechJobUpdateDto dto, HttpContext http, AppDbContext db,
            DIYHelper2.Api.Services.TechTokenService tokens,
            DIYHelper2.Api.Services.HelpRequestWriteService writer,
            DIYHelper2.Api.Services.JobMediaService jobMedia) =>
        {
            var who = TechPrincipalOf(http, tokens);
            if (who is null) return Results.Json(new { error = "Sign in required.", code = "tech_unauthorized" }, statusCode: 401);
            var r = await db.HelpRequests.FindAsync(id);
            if (r is null || r.Brand != who.Brand || r.AssignedTechId != who.TechId) return Results.NotFound();
            var prevStatus = r.Status;

            // Guard oversize / malformed images the same way the customer submit does.
            if (MediaValidation.ValidateBase64Image(dto.BeforePhotoBase64, http, "beforePhotoBase64") is { } beforeErr) return beforeErr;
            if (MediaValidation.ValidateBase64Image(dto.AfterPhotoBase64, http, "afterPhotoBase64") is { } afterErr) return afterErr;
            if (MediaValidation.ValidateBase64Image(dto.SignatureBase64, http, "signatureBase64") is { } sigErr) return sigErr;

            // Store an uploaded photo/signature in S3 when configured (key set,
            // base64 column nulled); unconfigured or a failed Put keeps the
            // pre-offload behavior of persisting the base64 column. Replacing
            // an already-offloaded photo best-effort deletes the old object.
            async Task ApplyMediaAsync(string? uploadedB64, string kind,
                Func<string?> getKey, Action<string?> setKey, Action<string?> setBase64)
            {
                if (uploadedB64 is null) return; // field omitted → untouched
                var key = string.IsNullOrEmpty(uploadedB64)
                    ? null
                    : await jobMedia.StoreAsync(r.Brand, r.Id, kind, uploadedB64);
                if (key is not null)
                {
                    await jobMedia.DeleteKeyAsync(getKey());
                    setKey(key);
                    setBase64(null);
                }
                else
                {
                    setBase64(uploadedB64);
                }
            }

            writer.ApplyStatus(r, dto.Status);
            if (dto.TechEtaMinutes.HasValue)
                r.TechEtaMinutes = dto.TechEtaMinutes.Value < 0 ? null : dto.TechEtaMinutes.Value;
            if (dto.CompletionNotes is not null) r.CompletionNotes = dto.CompletionNotes;
            await ApplyMediaAsync(dto.BeforePhotoBase64, "before", () => r.BeforePhotoKey, k => r.BeforePhotoKey = k, b => r.BeforePhotoBase64 = b);
            await ApplyMediaAsync(dto.AfterPhotoBase64, "after", () => r.AfterPhotoKey, k => r.AfterPhotoKey = k, b => r.AfterPhotoBase64 = b);
            await ApplyMediaAsync(dto.SignatureBase64, "signature", () => r.SignatureKey, k => r.SignatureKey = k, b => r.SignatureBase64 = b);
            r.UpdatedAt = DateTime.UtcNow;
            await db.SaveChangesAsync();
            // Shared transition side effects: completion pipeline, or the
            // scheduled / on-the-way customer texts — identical to the owner PUT.
            await writer.HandleTransitionAsync(r, prevStatus);
            return Results.Ok(new { r.Id, r.Status, r.TechEtaMinutes, r.CompletedAt });
        });

        // Tech requests payment on-site — returns a hosted checkout URL to show/QR to the
        // customer. Token-gated + scoped to the tech's own job. Fail-soft.
        app.MapPost("/api/tech/jobs/{id:int}/payment-link", [EnableRateLimiting("submit")] async (
            int id, HttpContext http, AppDbContext db,
            DIYHelper2.Api.Services.TechTokenService tokens,
            DIYHelper2.Api.Integrations.Billing.IPaymentProvider payments) =>
        {
            var who = TechPrincipalOf(http, tokens);
            if (who is null) return Results.Json(new { error = "Sign in required.", code = "tech_unauthorized" }, statusCode: 401);
            var r = await db.HelpRequests.FindAsync(id);
            if (r is null || r.Brand != who.Brand || r.AssignedTechId != who.TechId) return Results.NotFound();
            if (!payments.IsConfigured)
                return Results.Ok(new { available = false, reason = "Payments aren't set up yet." });

            var amount = (r.QuoteStatus == "approved" ? r.QuoteTotal : null) ?? r.QuoteTotal;
            if (amount is null || amount <= 0)
                return Results.Ok(new { available = false, reason = "No approved amount to charge yet." });

            var result = await payments.CreateJobPaymentAsync(
                new DIYHelper2.Api.Integrations.Billing.JobPaymentRequest(
                    r.Brand, r.Id, amount.Value, r.ProjectTitle ?? "Service", r.CustomerEmail,
                    "https://api.diyhelper.org/payment-success.html",
                    "https://api.diyhelper.org/payment-cancel.html"));
            return result.Ok
                ? Results.Ok(new { available = true, url = result.CheckoutUrl, amount = amount.Value })
                : Results.Ok(new { available = false, reason = result.Error });
        });

        return app;
    }
}
