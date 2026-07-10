using DIYHelper2.Api.Data;
using Microsoft.EntityFrameworkCore;
using static DIYHelper2.Api.Endpoints.EndpointHelpers;

namespace DIYHelper2.Api.Endpoints;

/// <summary>
/// CRM OAuth flows (Jobber, Housecall Pro): admin-gated /connect starts the
/// authorization-code flow; the public /callback is protected by the signed,
/// time-boxed state parameter.
/// </summary>
public static class CrmEndpoints
{
    public static IEndpointRouteBuilder MapCrm(this IEndpointRouteBuilder app)
    {
        // ── CRM OAuth (Jobber) ──────────────────────────────────────────────────
        // Two endpoints implement the OAuth 2.0 authorization-code flow that connects a
        // brand's Jobber account so leads push into it. /connect is admin-gated (the
        // operator starts it); /callback is public (Jobber redirects the browser to it)
        // but is protected by the signed, time-boxed `state` it must echo back.
        app.MapGet("/api/crm/jobber/connect", (
            HttpContext http,
            DIYHelper2.Api.Integrations.Crm.JobberOptions jobber,
            DIYHelper2.Api.Integrations.Crm.CrmTokenProtector protector) =>
        {
            if (!jobber.IsConfigured)
                return Results.Problem("Jobber integration is not configured on this server.", statusCode: 503);

            // A scoped dashboard login connects its own brand; the super-admin must name
            // one via ?brand=. Prevents a super-admin from connecting the wrong tenant.
            var slug = BrandScopeOf(http) ?? http.Request.Query["brand"].FirstOrDefault();
            if (string.IsNullOrWhiteSpace(slug))
                return Results.BadRequest(new { error = "brand is required" });

            // Signed + encrypted state carries the brand across the redirect and proves
            // the callback belongs to a flow we started. Valid for 10 minutes.
            var expiry = DateTimeOffset.UtcNow.AddMinutes(10).ToUnixTimeSeconds();
            var state = protector.Protect($"{slug}|{expiry}");

            var url = "https://api.getjobber.com/api/oauth/authorize"
                + "?response_type=code"
                + "&client_id=" + Uri.EscapeDataString(jobber.ClientId!)
                + "&redirect_uri=" + Uri.EscapeDataString(jobber.RedirectUri!)
                + "&state=" + Uri.EscapeDataString(state);
            return Results.Redirect(url);
        });

        app.MapGet("/api/crm/jobber/callback", async (
            HttpContext http,
            DIYHelper2.Api.Integrations.Crm.CrmTokenProtector protector,
            DIYHelper2.Api.Integrations.Crm.JobberTokenService tokens,
            AppDbContext db,
            ILogger<Program> logger) =>
        {
            var code = http.Request.Query["code"].FirstOrDefault();
            var state = http.Request.Query["state"].FirstOrDefault();
            if (string.IsNullOrEmpty(code) || string.IsNullOrEmpty(state))
                return Results.BadRequest(new { error = "missing code or state" });

            // Recover + validate the brand from the signed state.
            string slug;
            try
            {
                var parts = protector.Unprotect(state).Split('|');
                slug = parts[0];
                if (parts.Length < 2 || !long.TryParse(parts[1], out var exp)
                    || DateTimeOffset.FromUnixTimeSeconds(exp) < DateTimeOffset.UtcNow)
                    return Results.BadRequest(new { error = "state expired — please retry the connection" });
            }
            catch
            {
                return Results.BadRequest(new { error = "invalid state" });
            }

            var tok = await tokens.ExchangeCodeAsync(code, http.RequestAborted);
            if (tok is null)
                return Results.Problem("Token exchange with Jobber failed.", statusCode: 502);

            var conn = await db.BrandCrmConnections.FirstOrDefaultAsync(c => c.BrandSlug == slug);
            if (conn is null)
            {
                conn = new DIYHelper2.Api.Models.BrandCrmConnection { BrandSlug = slug };
                db.BrandCrmConnections.Add(conn);
            }
            conn.Provider = (int)DIYHelper2.Api.Integrations.Crm.CrmProvider.Jobber;
            conn.IsActive = true;
            tokens.ApplyTokens(conn, tok);
            await db.SaveChangesAsync();
            logger.LogInformation("Jobber CRM connected for brand {Brand}", slug);

            return Results.Content(
                "<!doctype html><html><body style=\"font-family:sans-serif;text-align:center;padding-top:3rem\">"
                + "<h2>Jobber connected ✔</h2><p>New leads for this brand will now flow into Jobber. You can close this window.</p>"
                + "</body></html>", "text/html");
        });

        // ── CRM OAuth (Housecall Pro) ───────────────────────────────────────────
        // Mirrors the Jobber flow. Housecall's authorize page lives on pro.housecallpro.com
        // (consent) while token exchange is on api.housecallpro.com. OAuth is partner-only
        // and the connected account must be on the MAX plan for leads to land.
        app.MapGet("/api/crm/housecall/connect", (
            HttpContext http,
            DIYHelper2.Api.Integrations.Crm.HousecallOptions housecall,
            DIYHelper2.Api.Integrations.Crm.CrmTokenProtector protector) =>
        {
            if (!housecall.IsConfigured)
                return Results.Problem("Housecall Pro integration is not configured on this server.", statusCode: 503);

            var slug = BrandScopeOf(http) ?? http.Request.Query["brand"].FirstOrDefault();
            if (string.IsNullOrWhiteSpace(slug))
                return Results.BadRequest(new { error = "brand is required" });

            var expiry = DateTimeOffset.UtcNow.AddMinutes(10).ToUnixTimeSeconds();
            var state = protector.Protect($"{slug}|{expiry}");

            var url = "https://pro.housecallpro.com/oauth/authorize"
                + "?response_type=code"
                + "&approval_prompt=auto"
                + "&client_id=" + Uri.EscapeDataString(housecall.ClientId!)
                + "&redirect_uri=" + Uri.EscapeDataString(housecall.RedirectUri!)
                + "&scope=" + Uri.EscapeDataString(housecall.Scope)
                + "&state=" + Uri.EscapeDataString(state);
            return Results.Redirect(url);
        });

        app.MapGet("/api/crm/housecall/callback", async (
            HttpContext http,
            DIYHelper2.Api.Integrations.Crm.CrmTokenProtector protector,
            DIYHelper2.Api.Integrations.Crm.HousecallTokenService tokens,
            AppDbContext db,
            ILogger<Program> logger) =>
        {
            var code = http.Request.Query["code"].FirstOrDefault();
            var state = http.Request.Query["state"].FirstOrDefault();
            if (string.IsNullOrEmpty(code) || string.IsNullOrEmpty(state))
                return Results.BadRequest(new { error = "missing code or state" });

            string slug;
            try
            {
                var parts = protector.Unprotect(state).Split('|');
                slug = parts[0];
                if (parts.Length < 2 || !long.TryParse(parts[1], out var exp)
                    || DateTimeOffset.FromUnixTimeSeconds(exp) < DateTimeOffset.UtcNow)
                    return Results.BadRequest(new { error = "state expired — please retry the connection" });
            }
            catch
            {
                return Results.BadRequest(new { error = "invalid state" });
            }

            var tok = await tokens.ExchangeCodeAsync(code, http.RequestAborted);
            if (tok is null)
                return Results.Problem("Token exchange with Housecall Pro failed.", statusCode: 502);

            var conn = await db.BrandCrmConnections.FirstOrDefaultAsync(c => c.BrandSlug == slug);
            if (conn is null)
            {
                conn = new DIYHelper2.Api.Models.BrandCrmConnection { BrandSlug = slug };
                db.BrandCrmConnections.Add(conn);
            }
            conn.Provider = (int)DIYHelper2.Api.Integrations.Crm.CrmProvider.HousecallPro;
            conn.IsActive = true;
            tokens.ApplyTokens(conn, tok);
            await db.SaveChangesAsync();
            logger.LogInformation("Housecall Pro CRM connected for brand {Brand}", slug);

            return Results.Content(
                "<!doctype html><html><body style=\"font-family:sans-serif;text-align:center;padding-top:3rem\">"
                + "<h2>Housecall Pro connected ✔</h2><p>New leads for this brand will now appear in your Job Inbox. You can close this window.</p>"
                + "</body></html>", "text/html");
        });

        return app;
    }
}
