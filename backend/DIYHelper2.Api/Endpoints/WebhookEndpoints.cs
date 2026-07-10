using DIYHelper2.Api.Data;
using DIYHelper2.Api.Models;
using Microsoft.EntityFrameworkCore;
using static DIYHelper2.Api.Endpoints.EndpointHelpers;

namespace DIYHelper2.Api.Endpoints;

/// <summary>
/// Inbound webhooks from external providers (Twilio SMS/voice, Stripe
/// payments). All are AppKey-exempt public paths guarded by their own
/// shared-token / signature checks.
/// </summary>
public static class WebhookEndpoints
{
    public static IEndpointRouteBuilder MapWebhooks(this IEndpointRouteBuilder app)
    {
        // ── Twilio webhooks (PUBLIC — /api/sms/ is AppKey-exempt) ─────────────────
        // Guarded by an optional shared token (TWILIO_WEBHOOK_TOKEN) since Twilio can't
        // send X-App-Key. Twilio POSTs form-encoded; the brand is resolved from the
        // receiving number (each brand has its own SmsFromNumber).
        app.MapPost("/api/sms/incoming", async (HttpContext http, AppDbContext db,
            DIYHelper2.Api.Services.MessagingService messaging) =>
        {
            if (!WebhookTokenOk(http)) return Results.Unauthorized();
            var form = await http.Request.ReadFormAsync();
            var from = form["From"].FirstOrDefault() ?? "";
            var to = form["To"].FirstOrDefault() ?? "";
            var body = form["Body"].FirstOrDefault() ?? "";
            var brand = (await db.Brands.FirstOrDefaultAsync(b => b.SmsFromNumber == to))?.Slug ?? "diyhelper";
            await messaging.RecordInboundAsync(brand, from, to, body);
            // Empty TwiML = accept, no auto-reply.
            return Results.Content("<?xml version=\"1.0\" encoding=\"UTF-8\"?><Response></Response>", "application/xml");
        });

        app.MapPost("/api/sms/voice", async (HttpContext http, AppDbContext db,
            DIYHelper2.Api.Services.MessagingService messaging) =>
        {
            if (!WebhookTokenOk(http)) return Results.Unauthorized();
            var form = await http.Request.ReadFormAsync();
            var from = form["From"].FirstOrDefault() ?? "";
            var to = form["To"].FirstOrDefault() ?? "";
            var brand = await db.Brands.FirstOrDefaultAsync(b => b.SmsFromNumber == to);
            var company = brand?.CompanyName ?? "us";
            // Missed-call text-back: we don't staff a phone line — text the caller back.
            if (!string.IsNullOrWhiteSpace(from) && messaging.IsConfigured)
            {
                try
                {
                    var lead = await db.HelpRequests
                        .Where(r => r.CustomerPhone == from && (brand == null || r.Brand == brand.Slug))
                        .OrderByDescending(r => r.CreatedAt).FirstOrDefaultAsync();
                    var pseudo = lead ?? new HelpRequest { Brand = brand?.Slug ?? "diyhelper", CustomerPhone = from };
                    await messaging.SendToLeadAsync(pseudo,
                        $"Thanks for calling {company}! We'll text you right back. Reply here and we'll help you out.");
                }
                catch { /* best-effort */ }
            }
            return Results.Content(
                $"<?xml version=\"1.0\" encoding=\"UTF-8\"?><Response><Say>Thanks for calling {System.Security.SecurityElement.Escape(company)}. We'll text you right back.</Say><Hangup/></Response>",
                "application/xml");
        });

        // Stripe payment webhook (PUBLIC — /api/stripe/ is AppKey-exempt). Signature-
        // validated when STRIPE_WEBHOOK_SECRET is set; marks the job paid on success.
        app.MapPost("/api/stripe/webhook", async (HttpContext http, AppDbContext db, ILogger<Program> logger) =>
        {
            using var reader = new StreamReader(http.Request.Body);
            var payload = await reader.ReadToEndAsync();

            var secret = Environment.GetEnvironmentVariable("STRIPE_WEBHOOK_SECRET");
            if (!string.IsNullOrEmpty(secret))
            {
                var sig = http.Request.Headers["Stripe-Signature"].FirstOrDefault();
                if (!StripeSignatureValid(payload, sig, secret)) return Results.Unauthorized();
            }

            try
            {
                using var doc = System.Text.Json.JsonDocument.Parse(payload);
                var type = doc.RootElement.TryGetProperty("type", out var t) ? t.GetString() : null;
                if (type == "checkout.session.completed")
                {
                    var obj = doc.RootElement.GetProperty("data").GetProperty("object");
                    var jobId = 0;
                    if (obj.TryGetProperty("metadata", out var meta) && meta.ValueKind == System.Text.Json.JsonValueKind.Object
                        && meta.TryGetProperty("jobId", out var j))
                        int.TryParse(j.GetString(), out jobId);

                    if (jobId > 0)
                    {
                        var r = await db.HelpRequests.FindAsync(jobId);
                        if (r is not null && r.PaidAt is null)
                        {
                            r.PaidAt = DateTime.UtcNow;
                            if (obj.TryGetProperty("amount_total", out var at) && at.ValueKind == System.Text.Json.JsonValueKind.Number)
                                r.AmountPaid = at.GetInt64() / 100m;
                            r.UpdatedAt = DateTime.UtcNow;
                            await db.SaveChangesAsync();
                            logger.LogInformation("Job {Id} marked paid via Stripe webhook.", jobId);
                        }
                    }
                }
            }
            catch (Exception ex)
            {
                logger.LogWarning(ex, "Stripe webhook parse failed.");
            }
            return Results.Ok();   // always 200 so Stripe doesn't retry a parse error forever
        });

        return app;
    }
}
