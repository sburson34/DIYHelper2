using DIYHelper2.Api.Data;
using Microsoft.EntityFrameworkCore;
using static DIYHelper2.Api.Endpoints.EndpointHelpers;

namespace DIYHelper2.Api.Endpoints;

/// <summary>
/// Accounting OAuth (QuickBooks Online): admin-gated /connect, state-validated
/// public /callback, and the connection-status check for the console.
/// </summary>
public static class AccountingEndpoints
{
    public static IEndpointRouteBuilder MapAccounting(this IEndpointRouteBuilder app)
    {
        // ── Accounting OAuth (QuickBooks Online) ──────────────────────────────────
        // Connect is admin-gated; callback is public but validated by the signed state
        // (and QBO adds a realmId query param identifying the connected company).
        app.MapGet("/api/accounting/qbo/connect", (
            HttpContext http,
            DIYHelper2.Api.Integrations.Billing.QuickBooksOptions qbo,
            DIYHelper2.Api.Integrations.Crm.CrmTokenProtector protector) =>
        {
            if (!qbo.IsConfigured)
                return Results.Problem("QuickBooks integration is not configured on this server.", statusCode: 503);
            var slug = BrandScopeOf(http) ?? http.Request.Query["brand"].FirstOrDefault();
            if (string.IsNullOrWhiteSpace(slug))
                return Results.BadRequest(new { error = "brand is required" });

            var expiry = DateTimeOffset.UtcNow.AddMinutes(10).ToUnixTimeSeconds();
            var state = protector.Protect($"{slug}|{expiry}");
            var url = "https://appcenter.intuit.com/connect/oauth2"
                + "?response_type=code"
                + "&client_id=" + Uri.EscapeDataString(qbo.ClientId!)
                + "&redirect_uri=" + Uri.EscapeDataString(qbo.RedirectUri!)
                + "&scope=" + Uri.EscapeDataString("com.intuit.quickbooks.accounting")
                + "&state=" + Uri.EscapeDataString(state);
            return Results.Redirect(url);
        });

        app.MapGet("/api/accounting/qbo/callback", async (
            HttpContext http,
            DIYHelper2.Api.Integrations.Crm.CrmTokenProtector protector,
            DIYHelper2.Api.Integrations.Billing.QuickBooksTokenService tokens,
            AppDbContext db,
            ILogger<Program> logger) =>
        {
            var code = http.Request.Query["code"].FirstOrDefault();
            var state = http.Request.Query["state"].FirstOrDefault();
            var realmId = http.Request.Query["realmId"].FirstOrDefault();
            if (string.IsNullOrEmpty(code) || string.IsNullOrEmpty(state) || string.IsNullOrEmpty(realmId))
                return Results.BadRequest(new { error = "missing code, state, or realmId" });

            string slug;
            try
            {
                var parts = protector.Unprotect(state).Split('|');
                slug = parts[0];
                if (parts.Length < 2 || !long.TryParse(parts[1], out var exp)
                    || DateTimeOffset.FromUnixTimeSeconds(exp) < DateTimeOffset.UtcNow)
                    return Results.BadRequest(new { error = "state expired — please retry the connection" });
            }
            catch { return Results.BadRequest(new { error = "invalid state" }); }

            var tok = await tokens.ExchangeCodeAsync(code, http.RequestAborted);
            if (tok is null) return Results.Problem("Token exchange with QuickBooks failed.", statusCode: 502);

            var conn = await db.BrandAccountingConnections.FirstOrDefaultAsync(c => c.BrandSlug == slug);
            if (conn is null)
            {
                conn = new DIYHelper2.Api.Models.BrandAccountingConnection { BrandSlug = slug };
                db.BrandAccountingConnections.Add(conn);
            }
            conn.Provider = 1; // QuickBooks Online
            conn.RealmId = realmId;
            conn.IsActive = true;
            tokens.ApplyTokens(conn, tok);
            await db.SaveChangesAsync();
            logger.LogInformation("QuickBooks connected for brand {Brand}", slug);

            return Results.Content(
                "<!doctype html><html><body style=\"font-family:sans-serif;text-align:center;padding-top:3rem\">"
                + "<h2>QuickBooks connected ✔</h2><p>Completed jobs with an approved quote will now sync as invoices. You can close this window.</p>"
                + "</body></html>", "text/html");
        });

        // Whether the active brand has a live QuickBooks connection (drives the console
        // button state). Admin-gated via the /api/accounting prefix.
        app.MapGet("/api/accounting/status", async (HttpContext http, AppDbContext db) =>
        {
            var slug = BrandScopeOf(http) ?? http.Request.Query["brand"].FirstOrDefault();
            if (string.IsNullOrWhiteSpace(slug)) return Results.Ok(new { connected = false });
            var conn = await db.BrandAccountingConnections.FirstOrDefaultAsync(c => c.BrandSlug == slug && c.IsActive);
            return Results.Ok(new { connected = conn is not null, realmId = conn?.RealmId });
        });

        return app;
    }
}
