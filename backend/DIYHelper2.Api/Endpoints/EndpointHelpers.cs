using DIYHelper2.Api.Data;
using DIYHelper2.Api.Models;
using Microsoft.EntityFrameworkCore;

namespace DIYHelper2.Api.Endpoints;

/// <summary>
/// Shared request-scoped helpers used across the endpoint groups. These were
/// static local functions in Program.cs before the endpoint split; Program.cs
/// (and each Endpoints/*.cs file) pulls them in with
/// <c>using static DIYHelper2.Api.Endpoints.EndpointHelpers;</c> so call sites
/// read the same as before the move.
/// </summary>
public static class EndpointHelpers
{
    // Tenant scoping is applied by AdminAuthMiddleware, which sets Items["BrandScope"]
    // for a per-brand login (and Items["IsSuperAdmin"] for the operator). A scoped
    // caller only ever sees/edits their own brand's leads; cross-tenant ids 404
    // (not 403) so a scoped user can't probe another brand's id space.
    public static string? BrandScopeOf(HttpContext http)
        => http.Items.TryGetValue("BrandScope", out var s) ? s as string : null;

    // The standard tenant filter for admin list endpoints over any brand-owned
    // table: a scoped (per-brand) login always wins and sees only its own rows;
    // a super-admin sees everything, optionally narrowed by a ?brand= query
    // param. Replaces the identical inline if/else that used to live in every
    // list handler.
    public static IQueryable<T> WhereBrandVisible<T>(this IQueryable<T> q, string? scope, string? brandParam)
        where T : class, IBrandOwned
    {
        if (scope is not null) return q.Where(e => e.Brand == scope);            // brand login → own rows only
        if (!string.IsNullOrWhiteSpace(brandParam)) return q.Where(e => e.Brand == brandParam); // super-admin optional filter
        return q;
    }

    // The standard cross-tenant guard for admin detail/write endpoints: a scoped
    // login touching another brand's row gets a 404 (not 403) so it can't probe
    // another tenant's id space. Super-admin (no scope) is never cross-tenant.
    public static bool CrossTenant(HttpContext http, string entityBrand)
    {
        var scope = BrandScopeOf(http);
        return scope is not null && entityBrand != scope;
    }

    // Guard for the public Twilio webhooks: if TWILIO_WEBHOOK_TOKEN is set, require a
    // matching ?token= (which the operator bakes into the Twilio webhook URL). Unset
    // → allow, so local dev works without configuration.
    public static bool WebhookTokenOk(HttpContext http)
    {
        var expected = Environment.GetEnvironmentVariable("TWILIO_WEBHOOK_TOKEN");
        if (string.IsNullOrEmpty(expected)) return true;
        var provided = http.Request.Query["token"].FirstOrDefault();
        return !string.IsNullOrEmpty(provided) && provided == expected;
    }

    // Validate a Stripe webhook signature ("Stripe-Signature: t=...,v1=...") by
    // recomputing HMAC-SHA256 over "{t}.{payload}" with the signing secret.
    public static bool StripeSignatureValid(string payload, string? sigHeader, string secret)
    {
        if (string.IsNullOrEmpty(sigHeader)) return false;
        string? t = null;
        var v1s = new List<string>();
        foreach (var part in sigHeader.Split(','))
        {
            var kv = part.Split('=', 2);
            if (kv.Length != 2) continue;
            if (kv[0] == "t") t = kv[1];
            else if (kv[0] == "v1") v1s.Add(kv[1]);
        }
        if (t is null || v1s.Count == 0) return false;

        using var h = new System.Security.Cryptography.HMACSHA256(System.Text.Encoding.UTF8.GetBytes(secret));
        var computed = Convert.ToHexString(h.ComputeHash(System.Text.Encoding.UTF8.GetBytes($"{t}.{payload}")))
            .ToLowerInvariant();
        return v1s.Any(v => System.Security.Cryptography.CryptographicOperations.FixedTimeEquals(
            System.Text.Encoding.UTF8.GetBytes(v), System.Text.Encoding.UTF8.GetBytes(computed)));
    }

    // White-label attribution for public customer endpoints: always from the
    // X-Brand header (never the body), lowercased, defaulting to the flagship brand
    // for un-branded builds.
    public static string BrandFromHeader(HttpContext http)
    {
        var slug = (http.Request.Headers["X-Brand"].FirstOrDefault() ?? "").Trim().ToLowerInvariant();
        return string.IsNullOrEmpty(slug) ? "diyhelper" : slug;
    }

    // Upsert the lightweight, password-less customer for a booking. Matches an
    // existing record newest-first by device, then by email (a returning customer on
    // a new install). Only ever fills/refreshes fields — never nulls a known value.
    public static async Task UpsertCustomerAsync(
        AppDbContext db, string brand, string? deviceId, string name, string email, string phone)
    {
        Customer? existing = null;
        if (!string.IsNullOrEmpty(deviceId))
            existing = await db.Customers
                .Where(c => c.Brand == brand && c.DeviceId == deviceId)
                .OrderByDescending(c => c.UpdatedAt)
                .FirstOrDefaultAsync();
        if (existing is null && !string.IsNullOrWhiteSpace(email))
            existing = await db.Customers
                .Where(c => c.Brand == brand && c.Email == email)
                .OrderByDescending(c => c.UpdatedAt)
                .FirstOrDefaultAsync();

        var now = DateTime.UtcNow;
        if (existing is null)
        {
            db.Customers.Add(new Customer
            {
                Brand = brand,
                DeviceId = string.IsNullOrEmpty(deviceId) ? null : deviceId,
                Name = name ?? string.Empty,
                Email = string.IsNullOrWhiteSpace(email) ? null : email,
                Phone = string.IsNullOrWhiteSpace(phone) ? null : phone,
                CreatedAt = now,
                UpdatedAt = now,
                LastSeenAt = now,
            });
        }
        else
        {
            if (!string.IsNullOrWhiteSpace(name)) existing.Name = name;
            if (!string.IsNullOrWhiteSpace(email)) existing.Email = email;
            if (!string.IsNullOrWhiteSpace(phone)) existing.Phone = phone;
            if (!string.IsNullOrEmpty(deviceId)) existing.DeviceId = deviceId;
            existing.UpdatedAt = now;
            existing.LastSeenAt = now;
        }
    }

    // A short, human-readable technician login code. Uppercase, excludes ambiguous
    // characters (0/O, 1/I/L) so it's easy to read aloud and type on a phone.
    public static string GenerateTechCode()
    {
        const string alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
        var bytes = System.Security.Cryptography.RandomNumberGenerator.GetBytes(8);
        var chars = new char[8];
        for (var i = 0; i < 8; i++) chars[i] = alphabet[bytes[i] % alphabet.Length];
        return new string(chars);
    }

    // Resolve the technician from a request's bearer token (Authorization: Bearer
    // <token>, or X-Tech-Token). Null when absent/invalid/expired → the endpoint 401s.
    public static DIYHelper2.Api.Services.TechPrincipal? TechPrincipalOf(
        HttpContext http, DIYHelper2.Api.Services.TechTokenService tokens)
    {
        string? token = null;
        var auth = http.Request.Headers["Authorization"].FirstOrDefault();
        if (!string.IsNullOrEmpty(auth) && auth.StartsWith("Bearer ", StringComparison.OrdinalIgnoreCase))
            token = auth.Substring("Bearer ".Length).Trim();
        if (string.IsNullOrEmpty(token))
            token = http.Request.Headers["X-Tech-Token"].FirstOrDefault();
        return tokens.Validate(token);
    }

    // The job's address as one display/geocode line: "street, city, state zip"
    // with whatever parts exist. Null when the job has no address at all.
    public static string? AddressLineOf(HelpRequest r)
    {
        var parts = new[] { r.Address, r.City, r.State, r.Zip }
            .Where(p => !string.IsNullOrWhiteSpace(p))
            .Select(p => p!.Trim())
            .ToArray();
        return parts.Length == 0 ? null : string.Join(", ", parts);
    }

    // Google Maps directions deep link for the tech app's Navigate button:
    // coordinates when the job is geocoded (exact), else the URL-encoded
    // address string, else null (no address to navigate to).
    public static string? MapsUrlOf(HelpRequest r)
    {
        if (r.Lat is { } lat && r.Lng is { } lng)
            return "https://www.google.com/maps/dir/?api=1&destination=" +
                $"{lat.ToString(System.Globalization.CultureInfo.InvariantCulture)}," +
                $"{lng.ToString(System.Globalization.CultureInfo.InvariantCulture)}";
        var line = AddressLineOf(r);
        return line is null ? null
            : $"https://www.google.com/maps/dir/?api=1&destination={Uri.EscapeDataString(line)}";
    }

    // Parse a brand's JSON service-type array; malformed/empty → no configured types
    // (the app falls back to a single generic option).
    public static List<string> ParseServiceTypes(string? json)
    {
        if (string.IsNullOrWhiteSpace(json)) return new List<string>();
        try
        {
            return System.Text.Json.JsonSerializer.Deserialize<List<string>>(json) ?? new List<string>();
        }
        catch { return new List<string>(); }
    }

    // Merge a brand's per-feature toggles over the customer-app defaults. Unknown/
    // malformed config falls back to defaults so a bad brand row can't dark-ship a
    // core feature. Memberships are forced to the computed "effective" value
    // (brand opt-in AND a live payment provider), overriding any stale JSON.
    public static Dictionary<string, bool> BuildBrandFeatures(string? featuresJson, bool membershipEffective)
    {
        var features = new Dictionary<string, bool>(StringComparer.OrdinalIgnoreCase)
        {
            ["booking"] = true,
            ["triage"] = true,
            ["appointmentTracking"] = true,
            ["reviews"] = true,
            ["referrals"] = true,
            ["maintenanceReminders"] = true,
            ["memberships"] = false,
        };
        if (!string.IsNullOrWhiteSpace(featuresJson))
        {
            try
            {
                var parsed = System.Text.Json.JsonSerializer.Deserialize<Dictionary<string, bool>>(featuresJson);
                if (parsed is not null)
                    foreach (var kv in parsed) features[kv.Key] = kv.Value;
            }
            catch { /* malformed brand config → keep defaults */ }
        }
        features["memberships"] = membershipEffective;
        return features;
    }

    // Shared shape for a campaign returned to the dashboard (list + detail).
    public static object PushCampaignView(DIYHelper2.Api.Models.PushCampaign c) => new
    {
        id = c.Id,
        brand = c.Brand,
        title = c.Title,
        body = c.Body,
        subtitle = c.Subtitle,
        imageUrl = c.ImageUrl,
        data = c.DataJson,
        platform = c.PlatformFilter,
        status = c.Status,
        scheduledFor = c.ScheduledFor,
        sentAt = c.SentAt,
        recipientCount = c.RecipientCount,
        deliveredCount = c.DeliveredCount,
        failedCount = c.FailedCount,
        createdBy = c.CreatedBy,
        createdAt = c.CreatedAt,
        updatedAt = c.UpdatedAt,
    };

    // Emails a newly-created lead to its brand's configured recipient. Best-effort:
    // swallows all failures (logged) so a mail outage never fails the customer's
    // submit. Falls back to the flagship brand's inbox so a lead is never dropped.
    public static async Task NotifyBrandOfLeadAsync(
        AppDbContext db,
        Sburson.Shared.Email.IEmailService mailer,
        ILogger logger,
        string brandSlug,
        HelpRequest lead)
    {
        try
        {
            var brand = await db.Brands.FirstOrDefaultAsync(b => b.Slug == brandSlug);
            var leadEmail = brand?.LeadEmail;
            if (string.IsNullOrWhiteSpace(leadEmail))
            {
                var fallback = await db.Brands.FirstOrDefaultAsync(b => b.Slug == "diyhelper");
                leadEmail = fallback?.LeadEmail;
            }
            if (string.IsNullOrWhiteSpace(leadEmail))
            {
                logger.LogWarning(
                    "No lead email configured for brand {Brand}; lead {LeadId} saved but not emailed.",
                    brandSlug, lead.Id);
                return;
            }

            var contact = new List<string>();
            if (!string.IsNullOrWhiteSpace(lead.CustomerName)) contact.Add($"Name:  {lead.CustomerName}");
            if (!string.IsNullOrWhiteSpace(lead.CustomerPhone)) contact.Add($"Phone: {lead.CustomerPhone}");
            if (!string.IsNullOrWhiteSpace(lead.CustomerEmail)) contact.Add($"Email: {lead.CustomerEmail}");

            var subject = $"New job lead: {lead.ProjectTitle}";
            var body =
                "A customer requested a professional through your app.\n\n" +
                $"Project: {lead.ProjectTitle}\n\n" +
                string.Join("\n", contact) + "\n\n" +
                $"What they described:\n{lead.UserDescription}\n\n" +
                $"Lead #{lead.Id} · received {lead.CreatedAt:u}\n";

            await mailer.SendAsync(leadEmail, subject, body);
            logger.LogInformation("Lead {LeadId} for brand {Brand} emailed to its recipient.", lead.Id, brandSlug);
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Failed to email lead {LeadId} for brand {Brand}.", lead.Id, brandSlug);
        }
    }
}
