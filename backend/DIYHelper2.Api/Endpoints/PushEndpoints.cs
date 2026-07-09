using DIYHelper2.Api;
using DIYHelper2.Api.Data;
using DIYHelper2.Api.Models;
using DIYHelper2.Api.Validation;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.EntityFrameworkCore;
using static DIYHelper2.Api.Endpoints.EndpointHelpers;

namespace DIYHelper2.Api.Endpoints;

/// <summary>
/// Push notifications: the mobile register/unregister surface and the
/// owner-portal audience/compose/test/campaign surfaces.
/// </summary>
public static class PushEndpoints
{
    public static IEndpointRouteBuilder MapPush(this IEndpointRouteBuilder app)
    {
        // ── Push notifications ──────────────────────────────────────────────
        // Two surfaces:
        //   • Mobile (public, X-App-Key + rate-limited): register/unregister a device's
        //     Expo token. Brand attribution comes from the X-Brand header (never the
        //     body), exactly like a lead submit.
        //   • Owner portal (Basic Auth via AdminAuthMiddleware, brand-scoped): audience
        //     counts, compose/send (now or scheduled), test-send, and campaign history.
        //     A per-brand login only ever reaches its own devices/campaigns; a
        //     super-admin targets a brand via ?brand= / the send body's brand.

        // Register (or refresh) a device's push token. Upsert keyed by the Expo token.
        app.MapPost("/api/push/register", [EnableRateLimiting("submit")] async (
            [FromBody] RegisterPushDto dto, HttpContext context, AppDbContext db) =>
        {
            var validationError = PushValidation.ValidateRegister(dto.Token, context);
            if (validationError != null) return validationError;

            var brandSlug = (context.Request.Headers["X-Brand"].FirstOrDefault() ?? "").Trim().ToLowerInvariant();
            if (string.IsNullOrEmpty(brandSlug)) brandSlug = "diyhelper";
            var deviceId = context.Request.Headers["X-Device-Id"].FirstOrDefault();
            var platform = PushValidation.NormalizePlatform(dto.Platform);
            var now = DateTime.UtcNow;

            var existing = await db.PushTokens.FirstOrDefaultAsync(t => t.Token == dto.Token);
            if (existing is null)
            {
                db.PushTokens.Add(new PushToken
                {
                    Brand = brandSlug,
                    DeviceId = deviceId,
                    Token = dto.Token!,
                    Platform = platform,
                    MarketingOptIn = dto.MarketingOptIn,
                    IsActive = true,
                    CreatedAt = now,
                    UpdatedAt = now,
                    LastSeenAt = now,
                });
            }
            else
            {
                // Re-registration: the same device may have switched brands (unlikely) or
                // toggled its promo consent. Reactivate and refresh liveness.
                existing.Brand = brandSlug;
                if (!string.IsNullOrEmpty(deviceId)) existing.DeviceId = deviceId;
                if (!string.IsNullOrEmpty(platform)) existing.Platform = platform;
                existing.MarketingOptIn = dto.MarketingOptIn;
                existing.IsActive = true;
                existing.UpdatedAt = now;
                existing.LastSeenAt = now;
            }
            await db.SaveChangesAsync();
            return Results.Created("/api/push/register", new { ok = true });
        });

        // Opt a device out (Settings toggle off / uninstall). Idempotent; never reveals
        // whether the token was known.
        app.MapPost("/api/push/unregister", [EnableRateLimiting("submit")] async (
            [FromBody] UnregisterPushDto dto, AppDbContext db) =>
        {
            if (PushValidation.IsExpoToken(dto.Token))
            {
                var existing = await db.PushTokens.FirstOrDefaultAsync(t => t.Token == dto.Token);
                if (existing is not null)
                {
                    existing.IsActive = false;
                    existing.MarketingOptIn = false;
                    existing.UpdatedAt = DateTime.UtcNow;
                    await db.SaveChangesAsync();
                }
            }
            return Results.Ok(new { ok = true });
        });

        // Audience size for the composer. Scoped login → own brand; super-admin → ?brand=.
        app.MapGet("/api/push/audience", async (
            [FromQuery] string? brand, [FromQuery] string? platform,
            HttpContext http, DIYHelper2.Api.Services.PushSendService push) =>
        {
            var scope = BrandScopeOf(http);
            var target = scope ?? (brand ?? "").Trim().ToLowerInvariant();
            if (string.IsNullOrEmpty(target))
                return Results.Ok(new { brand = (string?)null, total = 0, ios = 0, android = 0 });
            var a = await push.PreviewAudienceAsync(target, platform);
            return Results.Ok(new { brand = target, total = a.Total, ios = a.Ios, android = a.Android });
        });

        // Compose + send (now or scheduled). Creates a PushCampaign and, for send-now,
        // dispatches inline; a future ScheduledFor is left for PushDispatchService.
        app.MapPost("/api/push/send", async (
            [FromBody] SendPushDto dto, HttpContext http, AppDbContext db,
            DIYHelper2.Api.Services.PushSendService push) =>
        {
            var scope = BrandScopeOf(http);
            var target = scope ?? (dto.Brand ?? "").Trim().ToLowerInvariant();
            if (string.IsNullOrEmpty(target))
                return ApiError.BadRequest(http, "Select a brand to send to.");

            var dataJson = dto.Data.HasValue ? dto.Data.Value.GetRawText() : null;
            if (dataJson == "null") dataJson = null;

            var validationError = PushValidation.ValidateSend(
                dto.Title, dto.Body, dto.Subtitle, dto.ImageUrl, dataJson, dto.Platform, http);
            if (validationError != null) return validationError;

            var platform = PushValidation.NormalizePlatform(dto.Platform);
            var now = DateTime.UtcNow;
            // "Send now" is anything unset or within 5s of now; otherwise it's scheduled.
            var sendNow = dto.ScheduledFor is null || dto.ScheduledFor.Value <= now.AddSeconds(5);

            var campaign = new PushCampaign
            {
                Brand = target,
                Title = dto.Title!.Trim(),
                Body = dto.Body!.Trim(),
                Subtitle = string.IsNullOrWhiteSpace(dto.Subtitle) ? null : dto.Subtitle!.Trim(),
                ImageUrl = string.IsNullOrWhiteSpace(dto.ImageUrl) ? null : dto.ImageUrl!.Trim(),
                DataJson = dataJson,
                PlatformFilter = string.IsNullOrEmpty(platform) ? null : platform,
                Status = "scheduled",
                ScheduledFor = sendNow ? null : dto.ScheduledFor,
                CreatedBy = scope ?? "__super__",
                CreatedAt = now,
                UpdatedAt = now,
            };
            db.PushCampaigns.Add(campaign);
            await db.SaveChangesAsync();

            if (sendNow) await push.DispatchAsync(campaign.Id);

            var saved = await db.PushCampaigns.FindAsync(campaign.Id);
            return Results.Ok(PushCampaignView(saved!));
        });

        // Fire a single notification at one token so a composer can preview on a real
        // device before broadcasting. Does not create a campaign.
        app.MapPost("/api/push/test", async (
            [FromBody] TestPushDto dto, HttpContext http,
            DIYHelper2.Api.Integrations.ExpoPushClient expo) =>
        {
            if (!PushValidation.IsExpoToken(dto.Token))
                return ApiError.BadRequest(http, "A valid Expo push token is required.");

            var dataJson = dto.Data.HasValue ? dto.Data.Value.GetRawText() : null;
            if (dataJson == "null") dataJson = null;

            var validationError = PushValidation.ValidateSend(
                dto.Title, dto.Body, dto.Subtitle, dto.ImageUrl, dataJson, null, http);
            if (validationError != null) return validationError;

            object? data = dto.Data.HasValue && dataJson != null ? dto.Data.Value : null;
            var message = new DIYHelper2.Api.Integrations.ExpoPushMessage(
                To: dto.Token!,
                Title: dto.Title!.Trim(),
                Body: dto.Body!.Trim(),
                Subtitle: string.IsNullOrWhiteSpace(dto.Subtitle) ? null : dto.Subtitle!.Trim(),
                ImageUrl: string.IsNullOrWhiteSpace(dto.ImageUrl) ? null : dto.ImageUrl!.Trim(),
                Data: data);

            var tickets = await expo.SendAsync(new[] { message });
            var ticket = tickets.FirstOrDefault();
            if (ticket is null || !ticket.Ok)
                return ApiError.Response(http, 502,
                    ticket?.Message ?? ticket?.ErrorCode ?? "Expo rejected the test notification.",
                    "push_test_failed");
            return Results.Ok(new { ok = true, ticketId = ticket.Id });
        });

        // Campaign history — brand-scoped list.
        app.MapGet("/api/push/campaigns", async ([FromQuery] string? brand, HttpContext http, AppDbContext db) =>
        {
            var scope = BrandScopeOf(http);
            var q = db.PushCampaigns.AsQueryable();
            if (scope is not null)
                q = q.Where(c => c.Brand == scope);
            else if (!string.IsNullOrEmpty(brand))
                q = q.Where(c => c.Brand == brand.Trim().ToLowerInvariant());

            var rows = await q.OrderByDescending(c => c.CreatedAt).Take(100).ToListAsync();
            return Results.Ok(rows.Select(PushCampaignView));
        });

        app.MapGet("/api/push/campaigns/{id:int}", async (int id, HttpContext http, AppDbContext db) =>
        {
            var c = await db.PushCampaigns.FindAsync(id);
            if (c is null) return Results.NotFound();
            var scope = BrandScopeOf(http);
            if (scope is not null && c.Brand != scope) return Results.NotFound();
            return Results.Ok(PushCampaignView(c));
        });

        // Cancel a not-yet-sent scheduled campaign.
        app.MapPost("/api/push/campaigns/{id:int}/cancel", async (int id, HttpContext http, AppDbContext db) =>
        {
            var c = await db.PushCampaigns.FindAsync(id);
            if (c is null) return Results.NotFound();
            var scope = BrandScopeOf(http);
            if (scope is not null && c.Brand != scope) return Results.NotFound();
            if (c.Status != "scheduled")
                return ApiError.BadRequest(http, "Only scheduled campaigns can be canceled.");
            c.Status = "canceled";
            c.UpdatedAt = DateTime.UtcNow;
            await db.SaveChangesAsync();
            return Results.Ok(PushCampaignView(c));
        });

        return app;
    }
}
