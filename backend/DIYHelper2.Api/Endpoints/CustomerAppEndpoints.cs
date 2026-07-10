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
/// Customer-facing app surfaces (public; X-App-Key + X-Brand/X-Device-Id
/// scoped): the booking submit, per-brand config, the "My Jobs" tracker,
/// quote responses, and membership checkout.
/// </summary>
public static class CustomerAppEndpoints
{
    public static IEndpointRouteBuilder MapCustomerApp(this IEndpointRouteBuilder app)
    {
        app.MapPost("/api/help-requests", [EnableRateLimiting("submit")] async (
            [FromBody] CreateHelpRequestDto dto,
            HttpContext context,
            AppDbContext db,
            Sburson.Shared.Email.IEmailService mailer,
            DIYHelper2.Api.Integrations.Crm.CrmLeadDispatcher crmDispatcher,
            DIYHelper2.Api.Services.JobMediaService jobMedia,
            DIYHelper2.Api.Integrations.GeocodingClient geocoder,
            DIYHelper2.Api.Services.AvailabilityService availability,
            DIYHelper2.Api.Services.HelpRequestWriteService writer,
            ILogger<Program> logger) =>
        {
            // Reject oversize / malformed image payloads before persisting. Mobile app
            // compresses to well under 10 MB — anything larger is an abuse signal.
            if (MediaValidation.ValidateBase64Image(dto.ImageBase64, context, "imageBase64") is { } imageErr)
                return imageErr;
            if (!string.IsNullOrEmpty(dto.UserDescription) && dto.UserDescription.Length > MediaValidation.MaxDescriptionLength)
                return ApiError.BadRequest(context, $"Description exceeds maximum length of {MediaValidation.MaxDescriptionLength} characters.");
            if (dto.Address is { Length: > 200 })
                return ApiError.BadRequest(context, "address exceeds the maximum length of 200 characters.");

            // White-label attribution: which company's app produced this lead. Sourced
            // from the X-Brand header (NOT the body) so a client can't spoof another
            // tenant's attribution. Defaults to the flagship brand for un-branded builds.
            var brandSlug = (context.Request.Headers["X-Brand"].FirstOrDefault() ?? "").Trim().ToLowerInvariant();
            if (string.IsNullOrEmpty(brandSlug)) brandSlug = "diyhelper";

            // Device id (per-install) lets the customer see this job later in "My Jobs"
            // without a login. Sourced from the header, never the body.
            var deviceId = context.Request.Headers["X-Device-Id"].FirstOrDefault()?.Trim();

            // Assets + multi-property (A8): a booking may reference the
            // customer's equipment and/or a saved service address. Both are
            // ownership-validated HERE, before anything persists — a foreign
            // (or unknown) id is a 400 with nothing saved, same posture as the
            // media validation above.
            Asset? bookedAsset = null;
            CustomerProperty? bookedProperty = null;
            if (dto.AssetId.HasValue || dto.PropertyId.HasValue)
            {
                if (string.IsNullOrEmpty(deviceId))
                    return ApiError.BadRequest(context, "An X-Device-Id header is required to book against an asset or property.");
                var customer = await ResolveCustomerAsync(db, brandSlug, deviceId);
                if (dto.AssetId.HasValue)
                {
                    var email = customer?.Email;
                    bookedAsset = await db.Assets.FirstOrDefaultAsync(a =>
                        a.Id == dto.AssetId.Value && a.Brand == brandSlug &&
                        (a.DeviceId == deviceId || (email != null && a.CustomerEmail == email)));
                    if (bookedAsset is null)
                        return ApiError.BadRequest(context, "assetId doesn't match any of your equipment.");
                }
                if (dto.PropertyId.HasValue)
                {
                    if (customer is not null)
                        bookedProperty = await db.CustomerProperties.FirstOrDefaultAsync(p =>
                            p.Id == dto.PropertyId.Value && p.Brand == brandSlug && p.CustomerId == customer.Id);
                    if (bookedProperty is null)
                        return ApiError.BadRequest(context, "propertyId doesn't match any of your properties.");
                }
            }

            var helpRequest = new HelpRequest
            {
                Brand = brandSlug,
                CustomerName = dto.CustomerName,
                CustomerEmail = dto.CustomerEmail,
                CustomerPhone = dto.CustomerPhone,
                ProjectTitle = dto.ProjectTitle,
                UserDescription = dto.UserDescription,
                ProjectData = dto.ProjectData,
                ImageBase64 = dto.ImageBase64,
                DeviceId = string.IsNullOrEmpty(deviceId) ? null : deviceId,
                ServiceType = dto.ServiceType,
                PreferredDate = dto.PreferredDate,
                PreferredWindow = dto.PreferredWindow,
                // The app sends a single address line; City/State/Zip stay null
                // until the console refines them.
                Address = string.IsNullOrWhiteSpace(dto.Address) ? null : dto.Address.Trim(),
                AssetId = bookedAsset?.Id,
                PropertyId = bookedProperty?.Id,
                Status = "new",
                CreatedAt = DateTime.UtcNow,
                UpdatedAt = DateTime.UtcNow
            };

            // Booking against a saved property: its address columns (and
            // coords, when known) ARE the job's service address. Copied
            // coords make the geocode hook below a no-op (Lat is non-null),
            // so a property geocoded once never burns another lookup.
            if (bookedProperty is not null)
            {
                helpRequest.Address = bookedProperty.Address;
                helpRequest.City = bookedProperty.City;
                helpRequest.State = bookedProperty.State;
                helpRequest.Zip = bookedProperty.Zip;
                helpRequest.Lat = bookedProperty.Lat;
                helpRequest.Lng = bookedProperty.Lng;
            }

            if (dto.SlotStart.HasValue)
            {
                // Self-scheduling: create the job and claim a slot seat in ONE
                // transaction — either both persist or neither does. All seats
                // taken (a concurrent booking won the race, or the brand has no
                // capacity) → 409 slot_taken with nothing saved; the app
                // re-fetches availability and offers another slot.
                var slotUtc = DIYHelper2.Api.Services.AvailabilityService.AsUtc(dto.SlotStart.Value);
                var brandRow = await db.Brands.FirstOrDefaultAsync(b => b.Slug == brandSlug);
                helpRequest.ScheduledFor = slotUtc;
                writer.ApplyStatus(helpRequest, "scheduled");

                // EnableRetryOnFailure requires user transactions to run inside
                // the provider's execution strategy.
                var strategy = db.Database.CreateExecutionStrategy();
                var claimed = await strategy.ExecuteAsync(async () =>
                {
                    await using var tx = await db.Database.BeginTransactionAsync();
                    db.HelpRequests.Add(helpRequest);
                    await UpsertCustomerAsync(db, brandSlug, deviceId, dto.CustomerName, dto.CustomerEmail, dto.CustomerPhone);
                    await db.SaveChangesAsync();
                    if (brandRow is null || !await availability.TryClaimAsync(brandRow, slotUtc, helpRequest.Id))
                    {
                        await tx.RollbackAsync();
                        return false;
                    }
                    await tx.CommitAsync();
                    return true;
                });
                if (!claimed)
                {
                    db.ChangeTracker.Clear(); // rollback left Added/Unchanged ghosts behind
                    return Results.Json(
                        new { error = "That time slot was just taken — please pick another.", code = "slot_taken" },
                        statusCode: 409);
                }
            }
            else
            {
                db.HelpRequests.Add(helpRequest);

                // Upsert the lightweight, password-less customer record so return visits are
                // recognized (by device, or by email on a new install) and later features
                // (memberships, reminders) have a stable anchor. Best-effort: a failure here
                // must not fail the booking, so it shares the same SaveChanges and any
                // exception bubbles only to the catch-all handler (the lead is still saved
                // first-class above). Match newest-first on device, then email.
                await UpsertCustomerAsync(db, brandSlug, deviceId, dto.CustomerName, dto.CustomerEmail, dto.CustomerPhone);

                await db.SaveChangesAsync();
            }

            // Offload the booking photo to S3 once the row has an id (the key
            // embeds it). Fail-soft: an unconfigured bucket or a failed Put
            // simply leaves the base64 in its column, exactly as before.
            if (jobMedia.IsConfigured && !string.IsNullOrEmpty(helpRequest.ImageBase64))
            {
                var key = await jobMedia.StoreAsync(brandSlug, helpRequest.Id, "image", helpRequest.ImageBase64);
                if (key is not null)
                {
                    helpRequest.ImageKey = key;
                    helpRequest.ImageBase64 = null;
                    await db.SaveChangesAsync();
                }
            }

            // Geocode the service address best-effort AFTER the save — a miss
            // (unconfigured key, timeout, junk address) leaves coords null and
            // never fails the customer's submit.
            if (helpRequest.Address is not null && helpRequest.Lat is null)
            {
                if (await geocoder.GeocodeAsync(helpRequest.Address) is { } geo)
                {
                    helpRequest.Lat = geo.Lat;
                    helpRequest.Lng = geo.Lng;
                    await db.SaveChangesAsync();
                }
            }

            // Route the lead to the branding company by email. Falls back to the
            // flagship inbox so a lead is never silently dropped. Best-effort: an email
            // failure must not fail the customer's submit (they already got their guide).
            await NotifyBrandOfLeadAsync(db, mailer, logger, brandSlug, helpRequest);

            // Second delivery channel: push into the brand's CRM if it's connected to one
            // (webhook today). Best-effort like the email above — never fails the submit.
            await crmDispatcher.PushLeadAsync(brandSlug, helpRequest);

            return Results.Created($"/api/help-requests/{helpRequest.Id}", new { id = helpRequest.Id });
        });

        // ── Customer-facing app config + "My Jobs" ────────────────────────────────
        // These are PUBLIC (not admin-gated): they don't match any RequiresAuth pattern,
        // so they're protected only by the shared X-App-Key like the other mobile POSTs.
        // Brand comes from X-Brand; per-customer scoping is by the X-Device-Id header.

        // Per-brand configuration the branded app reads once at launch: company info,
        // which customer features are on, service categories, review link, and whether
        // the paid membership flow is actually available (brand opt-in AND a live
        // payment provider). Lets one binary behave differently per tenant, no rebuild.
        app.MapGet("/api/config", async (
            HttpContext http,
            AppDbContext db,
            DIYHelper2.Api.Integrations.Billing.IPaymentProvider payments) =>
        {
            var brandSlug = BrandFromHeader(http);
            var brand = await db.Brands.FirstOrDefaultAsync(b => b.Slug == brandSlug);

            var membershipEffective = (brand?.MembershipEnabled ?? false) && payments.IsConfigured;
            return Results.Ok(new
            {
                brand = brandSlug,
                companyName = brand?.CompanyName ?? "",
                phone = brand?.Phone,
                reviewUrl = brand?.ReviewUrl,
                serviceTypes = ParseServiceTypes(brand?.ServiceTypesJson),
                membershipEnabled = membershipEffective,
                features = BuildBrandFeatures(brand?.FeaturesJson, membershipEffective),
            });
        });

        // Open self-scheduling slots for one brand-local day. PUBLIC like
        // /api/config (X-Brand only; no admin-gate pattern matches
        // /api/availability — pinned by a test). A brand that hasn't configured
        // business hours returns an empty slot list and the app falls back to
        // the legacy preferred-day/window chips. Times are ISO UTC.
        app.MapGet("/api/availability", async (
            [FromQuery] string? date, HttpContext http, AppDbContext db,
            DIYHelper2.Api.Services.AvailabilityService availability) =>
        {
            if (!DateOnly.TryParseExact(date, "yyyy-MM-dd", out var day))
                return ApiError.BadRequest(http, "date must be YYYY-MM-DD.");

            var brandSlug = BrandFromHeader(http);
            var brand = await db.Brands.FirstOrDefaultAsync(b => b.Slug == brandSlug);
            if (brand is null)
                return Results.Ok(new { date = day.ToString("yyyy-MM-dd"), slotMinutes = 120, slots = Array.Empty<object>() });

            var slots = await availability.GetOpenSlotsAsync(brand, day);
            return Results.Ok(new
            {
                date = day.ToString("yyyy-MM-dd"),
                slotMinutes = brand.SlotMinutes,
                slots = slots.Select(s => new { start = s.StartUtc, end = s.EndUtc, remaining = s.Remaining }),
            });
        });

        // The customer's own jobs, scoped to their device. No auth/account — the app's
        // per-install X-Device-Id is the key. Projection is deliberately customer-safe
        // (no ImageBase64, no operator Notes, no other customers' rows).
        app.MapGet("/api/my/requests", async (HttpContext http, AppDbContext db) =>
        {
            var brandSlug = BrandFromHeader(http);
            var deviceId = http.Request.Headers["X-Device-Id"].FirstOrDefault()?.Trim();
            if (string.IsNullOrEmpty(deviceId)) return Results.Ok(Array.Empty<object>());

            // Materialize the customer-safe columns, then compute the media
            // proxy URLs in memory (has* booleans keep multi-MB legacy base64
            // payloads out of the list query).
            var rows = await db.HelpRequests
                .Where(r => r.Brand == brandSlug && r.DeviceId == deviceId)
                .OrderByDescending(r => r.CreatedAt)
                .Select(r => new
                {
                    r.Id,
                    r.ProjectTitle,
                    r.ServiceType,
                    r.Status,
                    r.PreferredDate,
                    r.PreferredWindow,
                    r.ScheduledFor,
                    r.TechEtaMinutes,
                    r.QuoteStatus,
                    r.QuoteTotal,
                    r.QuoteOptionsJson,
                    r.QuoteSelectedOption,
                    r.Address,
                    r.AssetId,
                    r.CreatedAt,
                    r.UpdatedAt,
                    HasImage = r.ImageKey != null || r.ImageBase64 != null,
                    HasBefore = r.BeforePhotoKey != null || r.BeforePhotoBase64 != null,
                    HasAfter = r.AfterPhotoKey != null || r.AfterPhotoBase64 != null,
                    HasSignature = r.SignatureKey != null || r.SignatureBase64 != null,
                })
                .ToListAsync();

            var results = rows.Select(r => new
            {
                r.Id,
                r.ProjectTitle,
                r.ServiceType,
                r.Status,
                r.PreferredDate,
                r.PreferredWindow,
                r.ScheduledFor,
                r.TechEtaMinutes,
                r.QuoteStatus,
                r.QuoteTotal,
                QuoteOptions = ParseQuoteOptions(r.QuoteOptionsJson),
                r.QuoteSelectedOption,
                r.Address,
                r.AssetId,
                r.CreatedAt,
                r.UpdatedAt,
                ImageUrl = r.HasImage ? $"/api/my/requests/{r.Id}/media/image" : null,
                BeforePhotoUrl = r.HasBefore ? $"/api/my/requests/{r.Id}/media/before" : null,
                AfterPhotoUrl = r.HasAfter ? $"/api/my/requests/{r.Id}/media/after" : null,
                SignatureUrl = r.HasSignature ? $"/api/my/requests/{r.Id}/media/signature" : null,
            });
            return Results.Ok(results);
        });

        app.MapGet("/api/my/requests/{id:int}", async (int id, HttpContext http, AppDbContext db) =>
        {
            var brandSlug = BrandFromHeader(http);
            var deviceId = http.Request.Headers["X-Device-Id"].FirstOrDefault()?.Trim();
            var r = await db.HelpRequests.FindAsync(id);
            // 404 (not 403) when the row isn't this device's, so a customer can't probe
            // another customer's id space — same posture as the admin cross-tenant guard.
            if (r is null || r.Brand != brandSlug || string.IsNullOrEmpty(deviceId) || r.DeviceId != deviceId)
                return Results.NotFound();

            return Results.Ok(new
            {
                r.Id,
                r.ProjectTitle,
                r.ServiceType,
                r.UserDescription,
                r.ProjectData,
                r.Status,
                r.PreferredDate,
                r.PreferredWindow,
                r.ScheduledFor,
                r.TechEtaMinutes,
                r.QuoteLinesJson,
                r.QuoteTotal,
                r.QuoteStatus,
                r.QuoteSentAt,
                QuoteOptions = ParseQuoteOptions(r.QuoteOptionsJson),
                r.QuoteSelectedOption,
                r.Address,
                r.AssetId,
                r.CreatedAt,
                r.UpdatedAt,
                ImageUrl = DIYHelper2.Api.Services.JobMediaService.MediaUrl(r, "image", "/api/my/requests"),
                BeforePhotoUrl = DIYHelper2.Api.Services.JobMediaService.MediaUrl(r, "before", "/api/my/requests"),
                AfterPhotoUrl = DIYHelper2.Api.Services.JobMediaService.MediaUrl(r, "after", "/api/my/requests"),
                SignatureUrl = DIYHelper2.Api.Services.JobMediaService.MediaUrl(r, "signature", "/api/my/requests"),
            });
        });

        // Media proxy for the customer's own job (photo / before / after /
        // signature). Same device-scope posture as the other /api/my routes:
        // wrong brand/device (or an unknown kind) is a 404, never a 403.
        app.MapGet("/api/my/requests/{id:int}/media/{kind}", async (
            int id, string kind, HttpContext http, AppDbContext db,
            DIYHelper2.Api.Services.JobMediaService jobMedia) =>
        {
            var brandSlug = BrandFromHeader(http);
            var deviceId = http.Request.Headers["X-Device-Id"].FirstOrDefault()?.Trim();
            var r = await db.HelpRequests.FindAsync(id);
            if (r is null || r.Brand != brandSlug || string.IsNullOrEmpty(deviceId) || r.DeviceId != deviceId)
                return Results.NotFound();
            return await jobMedia.ServeAsync(r, kind);
        });

        // Customer responds to a quote from the app (approve/decline). Device-scoped
        // exactly like the other /api/my endpoints; only a "sent" quote can be answered.
        app.MapPut("/api/my/requests/{id:int}/quote", [EnableRateLimiting("submit")] async (
            int id, [FromBody] QuoteDecisionDto dto, HttpContext http, AppDbContext db) =>
        {
            var brandSlug = BrandFromHeader(http);
            var deviceId = http.Request.Headers["X-Device-Id"].FirstOrDefault()?.Trim();
            var r = await db.HelpRequests.FindAsync(id);
            if (r is null || r.Brand != brandSlug || string.IsNullOrEmpty(deviceId) || r.DeviceId != deviceId)
                return Results.NotFound();
            if (r.QuoteStatus != "sent")
                return ApiError.BadRequest(http, "There's no open quote to respond to.");

            var decision = (dto.Decision ?? "").Trim().ToLowerInvariant();
            if (decision != "approved" && decision != "declined")
                return ApiError.BadRequest(http, "decision must be 'approved' or 'declined'.");

            // Approving a tiered quote requires picking one of its options; the
            // choice is materialized into QuoteTotal/QuoteLinesJson so
            // invoicing, payment links and the completion pipeline work exactly
            // like a classic single quote. Declines keep the options around
            // (the owner can revise and re-send).
            if (decision == "approved" && !string.IsNullOrWhiteSpace(r.QuoteOptionsJson))
            {
                var optionName = dto.OptionName?.Trim();
                if (string.IsNullOrEmpty(optionName))
                    return ApiError.BadRequest(http, "optionName is required to approve this quote.");

                try
                {
                    using var doc = System.Text.Json.JsonDocument.Parse(r.QuoteOptionsJson);
                    System.Text.Json.JsonElement? match = null;
                    foreach (var opt in doc.RootElement.EnumerateArray())
                    {
                        if (opt.TryGetProperty("name", out var n) && n.GetString()?.Trim() == optionName)
                        {
                            match = opt;
                            break;
                        }
                    }
                    if (match is not { } chosen)
                        return ApiError.BadRequest(http, "optionName doesn't match any option on this quote.");

                    r.QuoteTotal = chosen.GetProperty("total").GetDecimal();
                    r.QuoteLinesJson = chosen.GetProperty("lines").GetRawText();
                    r.QuoteSelectedOption = chosen.GetProperty("name").GetString();
                }
                catch (Exception e) when (e is System.Text.Json.JsonException or KeyNotFoundException or InvalidOperationException or FormatException)
                {
                    // A malformed stored quote should read as "no open quote to
                    // approve", not a 500.
                    return ApiError.BadRequest(http, "This quote can't be approved — ask the company to re-send it.");
                }
            }

            r.QuoteStatus = decision;
            r.QuoteRespondedAt = DateTime.UtcNow;
            r.UpdatedAt = DateTime.UtcNow;
            await db.SaveChangesAsync();
            return Results.Ok(new { r.Id, quoteStatus = r.QuoteStatus, quoteSelectedOption = r.QuoteSelectedOption });
        });

        // ── Customer equipment (assets) ────────────────────────────────────
        // Device-scoped like the other /api/my routes (X-Brand + X-Device-Id,
        // no login). Ownership is by device id OR by email match: an asset the
        // owner entered against the customer's email shows up on whatever
        // device that customer books from. Wrong owner → 404, never 403.

        app.MapGet("/api/my/assets", async (HttpContext http, AppDbContext db) =>
        {
            var brandSlug = BrandFromHeader(http);
            var deviceId = DeviceIdOf(http);
            if (string.IsNullOrEmpty(deviceId)) return Results.Ok(Array.Empty<object>());

            var customer = await ResolveCustomerAsync(db, brandSlug, deviceId);
            var email = customer?.Email;
            var assets = await db.Assets
                .Where(a => a.Brand == brandSlug &&
                    (a.DeviceId == deviceId || (email != null && a.CustomerEmail == email)))
                .OrderBy(a => a.Id)
                .ToListAsync();
            return Results.Ok(assets.Select(MyAssetView));
        });

        app.MapPost("/api/my/assets", [EnableRateLimiting("submit")] async (
            [FromBody] MyAssetDto dto, HttpContext http, AppDbContext db) =>
        {
            var brandSlug = BrandFromHeader(http);
            var deviceId = DeviceIdOf(http);
            if (string.IsNullOrEmpty(deviceId))
                return ApiError.BadRequest(http, "An X-Device-Id header is required.");
            if (string.IsNullOrWhiteSpace(dto.Label))
                return ApiError.BadRequest(http, "label is required.");

            var customer = await ResolveCustomerAsync(db, brandSlug, deviceId);
            if (dto.PropertyId.HasValue &&
                await OwnedPropertyAsync(db, brandSlug, customer, dto.PropertyId.Value) is null)
                return ApiError.BadRequest(http, "propertyId doesn't match any of your properties.");

            var asset = new Asset
            {
                Brand = brandSlug,
                DeviceId = deviceId,
                // Attach the known customer email (if any) so the asset follows
                // the customer onto a reinstall / new device.
                CustomerEmail = string.IsNullOrWhiteSpace(customer?.Email) ? null : customer!.Email,
                PropertyId = dto.PropertyId,
                Label = dto.Label.Trim(),
                Make = dto.Make,
                Model = dto.Model,
                Serial = dto.Serial,
                InstalledAt = dto.InstalledAt,
                WarrantyExpiresAt = dto.WarrantyExpiresAt,
                Notes = dto.Notes,
            };
            db.Assets.Add(asset);
            await db.SaveChangesAsync();
            return Results.Created($"/api/my/assets/{asset.Id}", MyAssetView(asset));
        });

        app.MapPut("/api/my/assets/{id:int}", async (
            int id, [FromBody] MyAssetDto dto, HttpContext http, AppDbContext db) =>
        {
            var brandSlug = BrandFromHeader(http);
            var deviceId = DeviceIdOf(http);
            var customer = await ResolveCustomerAsync(db, brandSlug, deviceId);
            var asset = await db.Assets.FindAsync(id);
            if (asset is null || asset.Brand != brandSlug || !OwnsAsset(asset, deviceId, customer))
                return Results.NotFound();
            if (string.IsNullOrWhiteSpace(dto.Label))
                return ApiError.BadRequest(http, "label is required.");
            if (dto.PropertyId.HasValue &&
                await OwnedPropertyAsync(db, brandSlug, customer, dto.PropertyId.Value) is null)
                return ApiError.BadRequest(http, "propertyId doesn't match any of your properties.");

            // Full replace: the app sends the whole form each save, so omitted
            // optional fields clear their stored values.
            asset.PropertyId = dto.PropertyId;
            asset.Label = dto.Label.Trim();
            asset.Make = dto.Make;
            asset.Model = dto.Model;
            asset.Serial = dto.Serial;
            asset.InstalledAt = dto.InstalledAt;
            asset.WarrantyExpiresAt = dto.WarrantyExpiresAt;
            asset.Notes = dto.Notes;
            asset.UpdatedAt = DateTime.UtcNow;
            await db.SaveChangesAsync();
            return Results.Ok(MyAssetView(asset));
        });

        app.MapDelete("/api/my/assets/{id:int}", async (int id, HttpContext http, AppDbContext db) =>
        {
            var brandSlug = BrandFromHeader(http);
            var deviceId = DeviceIdOf(http);
            var customer = await ResolveCustomerAsync(db, brandSlug, deviceId);
            var asset = await db.Assets.FindAsync(id);
            if (asset is null || asset.Brand != brandSlug || !OwnsAsset(asset, deviceId, customer))
                return Results.NotFound();
            db.Assets.Remove(asset);
            await db.SaveChangesAsync();
            return Results.NoContent();
        });

        // Per-asset service history: every job (any device) booked against
        // this asset for this brand, newest first. The asset itself must be
        // owned by the caller — otherwise 404, same probing posture as above.
        app.MapGet("/api/my/assets/{id:int}/history", async (int id, HttpContext http, AppDbContext db) =>
        {
            var brandSlug = BrandFromHeader(http);
            var deviceId = DeviceIdOf(http);
            var customer = await ResolveCustomerAsync(db, brandSlug, deviceId);
            var asset = await db.Assets.FindAsync(id);
            if (asset is null || asset.Brand != brandSlug || !OwnsAsset(asset, deviceId, customer))
                return Results.NotFound();

            var jobs = await db.HelpRequests
                .Where(r => r.Brand == brandSlug && r.AssetId == id)
                .OrderByDescending(r => r.CreatedAt).ThenByDescending(r => r.Id)
                .Select(r => new
                {
                    r.Id,
                    r.ProjectTitle,
                    r.ServiceType,
                    r.Status,
                    r.CompletedAt,
                    r.QuoteTotal,
                })
                .ToListAsync();
            return Results.Ok(jobs);
        });

        // ── Saved service addresses (multi-property customers) ─────────────
        // Scoped by the Customer row the device resolves to (Brand + CustomerId);
        // a device that never booked has no customer row → empty list, and
        // POST creates a minimal customer anchor first.

        app.MapGet("/api/my/properties", async (HttpContext http, AppDbContext db) =>
        {
            var brandSlug = BrandFromHeader(http);
            var customer = await ResolveCustomerAsync(db, brandSlug, DeviceIdOf(http));
            if (customer is null) return Results.Ok(Array.Empty<object>());

            var props = await db.CustomerProperties
                .Where(p => p.Brand == brandSlug && p.CustomerId == customer.Id)
                .OrderBy(p => p.Id)
                .ToListAsync();
            return Results.Ok(props.Select(MyPropertyView));
        });

        app.MapPost("/api/my/properties", [EnableRateLimiting("submit")] async (
            [FromBody] MyPropertyDto dto, HttpContext http, AppDbContext db) =>
        {
            var brandSlug = BrandFromHeader(http);
            var deviceId = DeviceIdOf(http);
            if (string.IsNullOrEmpty(deviceId))
                return ApiError.BadRequest(http, "An X-Device-Id header is required.");
            if (string.IsNullOrWhiteSpace(dto.Label))
                return ApiError.BadRequest(http, "label is required.");
            if (dto.Address is { Length: > 200 })
                return ApiError.BadRequest(http, "address exceeds the maximum length of 200 characters.");

            // Resolve-or-create the customer anchor for this device (a customer
            // may save properties before their first booking).
            var customer = await ResolveCustomerAsync(db, brandSlug, deviceId);
            if (customer is null)
            {
                await UpsertCustomerAsync(db, brandSlug, deviceId, "", "", "");
                await db.SaveChangesAsync();
                customer = await ResolveCustomerAsync(db, brandSlug, deviceId);
                if (customer is null) return ApiError.BadRequest(http, "Couldn't create a customer record for this device.");
            }

            var prop = new CustomerProperty
            {
                Brand = brandSlug,
                CustomerId = customer.Id,
                Label = dto.Label.Trim(),
                Address = dto.Address,
                City = dto.City,
                State = dto.State,
                Zip = dto.Zip,
            };
            db.CustomerProperties.Add(prop);
            await db.SaveChangesAsync();
            return Results.Created($"/api/my/properties/{prop.Id}", MyPropertyView(prop));
        });

        app.MapPut("/api/my/properties/{id:int}", async (
            int id, [FromBody] MyPropertyDto dto, HttpContext http, AppDbContext db) =>
        {
            var brandSlug = BrandFromHeader(http);
            var customer = await ResolveCustomerAsync(db, brandSlug, DeviceIdOf(http));
            var prop = await OwnedPropertyAsync(db, brandSlug, customer, id);
            if (prop is null) return Results.NotFound();
            if (string.IsNullOrWhiteSpace(dto.Label))
                return ApiError.BadRequest(http, "label is required.");
            if (dto.Address is { Length: > 200 })
                return ApiError.BadRequest(http, "address exceeds the maximum length of 200 characters.");

            // Full replace, like the asset PUT. An address edit invalidates any
            // stale coords; the next booking against this property re-geocodes.
            if (prop.Address != dto.Address || prop.City != dto.City || prop.State != dto.State || prop.Zip != dto.Zip)
            {
                prop.Lat = null;
                prop.Lng = null;
            }
            prop.Label = dto.Label.Trim();
            prop.Address = dto.Address;
            prop.City = dto.City;
            prop.State = dto.State;
            prop.Zip = dto.Zip;
            prop.UpdatedAt = DateTime.UtcNow;
            await db.SaveChangesAsync();
            return Results.Ok(MyPropertyView(prop));
        });

        app.MapDelete("/api/my/properties/{id:int}", async (int id, HttpContext http, AppDbContext db) =>
        {
            var brandSlug = BrandFromHeader(http);
            var customer = await ResolveCustomerAsync(db, brandSlug, DeviceIdOf(http));
            var prop = await OwnedPropertyAsync(db, brandSlug, customer, id);
            if (prop is null) return Results.NotFound();
            db.CustomerProperties.Remove(prop);
            await db.SaveChangesAsync();
            return Results.NoContent();
        });

        // Start a membership / maintenance-plan checkout. Fail-soft and honest: returns
        // available=false with a reason whenever the brand hasn't opted in or the
        // payment provider isn't wired, so the app hides or greys the CTA rather than
        // erroring. When live, returns a hosted Stripe Checkout URL for the app to open.
        app.MapPost("/api/memberships/checkout", [EnableRateLimiting("submit")] async (
            [FromBody] MembershipCheckoutDto dto,
            HttpContext http,
            AppDbContext db,
            DIYHelper2.Api.Integrations.Billing.IPaymentProvider payments) =>
        {
            var brandSlug = BrandFromHeader(http);
            var brand = await db.Brands.FirstOrDefaultAsync(b => b.Slug == brandSlug);
            if (brand is null || !brand.MembershipEnabled)
                return Results.Ok(new { available = false, reason = "Memberships aren't offered by this company." });
            if (!payments.IsConfigured)
                return Results.Ok(new { available = false, reason = "Membership signup isn't available yet." });
            if (string.IsNullOrWhiteSpace(dto.CustomerEmail))
                return ApiError.BadRequest(http, "customerEmail is required.");

            var success = string.IsNullOrWhiteSpace(dto.SuccessUrl)
                ? "https://api.diyhelper.org/membership-success.html" : dto.SuccessUrl!;
            var cancel = string.IsNullOrWhiteSpace(dto.CancelUrl)
                ? "https://api.diyhelper.org/membership-cancel.html" : dto.CancelUrl!;

            var result = await payments.CreateMembershipCheckoutAsync(
                new DIYHelper2.Api.Integrations.Billing.MembershipCheckoutRequest(
                    brandSlug, dto.PlanId ?? "default", dto.CustomerEmail!, dto.CustomerName, success, cancel));

            return result.Ok
                ? Results.Ok(new { available = true, checkoutUrl = result.CheckoutUrl })
                : Results.Ok(new { available = false, reason = result.Error });
        });

        return app;
    }

    // ── A8 helpers (device-scoped identity for assets/properties) ─────────

    private static string? DeviceIdOf(HttpContext http)
        => http.Request.Headers["X-Device-Id"].FirstOrDefault()?.Trim();

    /// <summary>The customer record this device resolves to (newest first, same
    /// match the booking upsert uses). Null when the device is unknown.</summary>
    private static async Task<Customer?> ResolveCustomerAsync(AppDbContext db, string brand, string? deviceId)
        => string.IsNullOrEmpty(deviceId)
            ? null
            : await db.Customers
                .Where(c => c.Brand == brand && c.DeviceId == deviceId)
                .OrderByDescending(c => c.UpdatedAt)
                .FirstOrDefaultAsync();

    /// <summary>Asset ownership: the caller's device created it, or its
    /// attached email matches the caller's customer email (owner-entered
    /// equipment / reinstalls). Brand is checked by the caller.</summary>
    private static bool OwnsAsset(Asset a, string? deviceId, Customer? customer)
        => (!string.IsNullOrEmpty(deviceId) && a.DeviceId == deviceId)
           || (a.CustomerEmail != null && customer?.Email != null && a.CustomerEmail == customer.Email);

    /// <summary>The property, iff it belongs to this brand + customer; null
    /// otherwise (callers turn that into 404 or 400 as appropriate).</summary>
    private static async Task<CustomerProperty?> OwnedPropertyAsync(
        AppDbContext db, string brand, Customer? customer, int propertyId)
        => customer is null
            ? null
            : await db.CustomerProperties.FirstOrDefaultAsync(p =>
                p.Id == propertyId && p.Brand == brand && p.CustomerId == customer.Id);

    // Customer-safe asset projection (no Brand/DeviceId/CustomerEmail — the
    // caller's identity is implicit, and other identities are nobody's business).
    private static object MyAssetView(Asset a) => new
    {
        id = a.Id,
        propertyId = a.PropertyId,
        label = a.Label,
        make = a.Make,
        model = a.Model,
        serial = a.Serial,
        installedAt = a.InstalledAt,
        warrantyExpiresAt = a.WarrantyExpiresAt,
        notes = a.Notes,
    };

    private static object MyPropertyView(CustomerProperty p) => new
    {
        id = p.Id,
        label = p.Label,
        address = p.Address,
        city = p.City,
        state = p.State,
        zip = p.Zip,
    };
}
