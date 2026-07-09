using System.Text;
using DIYHelper2.Api.Data;
using DIYHelper2.Api.Integrations.Billing;
using DIYHelper2.Api.Models;
using Microsoft.EntityFrameworkCore;
using Sburson.Shared.Email;

namespace DIYHelper2.Api.Services;

/// <summary>
/// All the side effects of a job reaching "completed", in one place so the owner
/// PUT and the tech PUT trigger identical behavior: sync an invoice to accounting,
/// email the customer a job report, schedule the next maintenance reminder, and
/// send a review-request text. Every step is idempotent and fail-soft — one
/// failing side effect never blocks the others or the request itself.
/// </summary>
public class JobCompletionService
{
    private readonly AppDbContext _db;
    private readonly IInvoiceProvider _invoices;
    private readonly IEmailService _mailer;
    private readonly MessagingService _messaging;
    private readonly ILogger<JobCompletionService> _logger;

    public JobCompletionService(
        AppDbContext db, IInvoiceProvider invoices, IEmailService mailer,
        MessagingService messaging, ILogger<JobCompletionService> logger)
    {
        _db = db;
        _invoices = invoices;
        _mailer = mailer;
        _messaging = messaging;
        _logger = logger;
    }

    public async Task HandleAsync(HelpRequest r, CancellationToken ct = default)
    {
        var brand = await _db.Brands.FirstOrDefaultAsync(b => b.Slug == r.Brand, ct);
        var company = brand?.CompanyName ?? "";

        await TrySyncInvoiceAsync(r, ct);
        await TrySendReportAsync(r, company, ct);
        await TryScheduleMaintenanceAsync(r, ct);
        try { await _messaging.RequestReviewAsync(r, company, brand?.ReviewUrl, ct); }
        catch (Exception ex) { _logger.LogWarning(ex, "Review SMS failed for job {Id}.", r.Id); }
    }

    // Invoice an approved quote once (idempotent via InvoiceRemoteId).
    private async Task TrySyncInvoiceAsync(HelpRequest r, CancellationToken ct)
    {
        try
        {
            if (r.InvoiceRemoteId is not null || r.QuoteStatus != "approved" || !_invoices.IsConfigured) return;
            var lines = ParseQuoteLines(r);
            if (lines.Count == 0) return;
            var result = await _invoices.CreateInvoiceAsync(
                new InvoiceRequest(r.Brand, r.CustomerEmail, r.CustomerName, lines, $"Job #{r.Id}: {r.ProjectTitle}"), ct);
            if (result.Ok && result.RemoteInvoiceId is not null)
            {
                r.InvoiceRemoteId = result.RemoteInvoiceId;
                r.UpdatedAt = DateTime.UtcNow;
                await _db.SaveChangesAsync(ct);
            }
        }
        catch (Exception ex) { _logger.LogWarning(ex, "Invoice sync failed for job {Id}.", r.Id); }
    }

    private List<InvoiceLine> ParseQuoteLines(HelpRequest r)
    {
        var lines = new List<InvoiceLine>();
        if (!string.IsNullOrWhiteSpace(r.QuoteLinesJson))
        {
            try
            {
                using var doc = System.Text.Json.JsonDocument.Parse(r.QuoteLinesJson);
                foreach (var el in doc.RootElement.EnumerateArray())
                {
                    var desc = el.TryGetProperty("description", out var d) ? d.GetString() ?? "" : "";
                    var amount = el.TryGetProperty("amount", out var a) ? a.GetDecimal() : 0m;
                    var qty = el.TryGetProperty("quantity", out var q) ? q.GetInt32() : 1;
                    lines.Add(new InvoiceLine(desc, amount, qty));
                }
            }
            catch { /* fall through */ }
        }
        if (lines.Count == 0 && r.QuoteTotal is { } total)
            lines.Add(new InvoiceLine(r.ProjectTitle ?? "Service", total, 1));
        return lines;
    }

    // Email the customer a branded job report (once, guarded by ReportSentAt).
    private async Task TrySendReportAsync(HelpRequest r, string company, CancellationToken ct)
    {
        try
        {
            if (r.ReportSentAt is not null || string.IsNullOrWhiteSpace(r.CustomerEmail)) return;
            var (text, html) = BuildReport(r, company);
            await _mailer.SendAsync(r.CustomerEmail, $"Your service report from {company}".Trim(), text, html, ct);
            r.ReportSentAt = DateTime.UtcNow;
            r.UpdatedAt = DateTime.UtcNow;
            await _db.SaveChangesAsync(ct);
        }
        catch (Exception ex) { _logger.LogWarning(ex, "Job report email failed for job {Id}.", r.Id); }
    }

    // Create the next maintenance reminder (once per job).
    private async Task TryScheduleMaintenanceAsync(HelpRequest r, CancellationToken ct)
    {
        try
        {
            if (r.MaintenanceIntervalMonths is not { } months || months <= 0) return;
            var exists = await _db.MaintenanceReminders.AnyAsync(m => m.HelpRequestId == r.Id, ct);
            if (exists) return;
            _db.MaintenanceReminders.Add(new MaintenanceReminder
            {
                Brand = r.Brand,
                HelpRequestId = r.Id,
                CustomerName = r.CustomerName,
                CustomerEmail = string.IsNullOrWhiteSpace(r.CustomerEmail) ? null : r.CustomerEmail,
                CustomerPhone = string.IsNullOrWhiteSpace(r.CustomerPhone) ? null : r.CustomerPhone,
                ServiceType = r.ServiceType,
                DueAt = DateTime.UtcNow.AddMonths(months),
            });
            await _db.SaveChangesAsync(ct);
        }
        catch (Exception ex) { _logger.LogWarning(ex, "Maintenance scheduling failed for job {Id}.", r.Id); }
    }

    // Compose the plain-text + HTML job report. Photos/signature are inline data URIs.
    private static (string text, string html) BuildReport(HelpRequest r, string company)
    {
        var text = new StringBuilder();
        text.AppendLine($"{company} — Service Report");
        text.AppendLine($"Job: {r.ProjectTitle}");
        if (!string.IsNullOrWhiteSpace(r.ServiceType)) text.AppendLine($"Service: {r.ServiceType}");
        text.AppendLine($"Customer: {r.CustomerName}");
        if (r.CompletedAt is { } c) text.AppendLine($"Completed: {c:u}");
        if (!string.IsNullOrWhiteSpace(r.CompletionNotes)) text.AppendLine($"\nWork performed:\n{r.CompletionNotes}");
        if (r.QuoteTotal is { } total) text.AppendLine($"\nTotal: ${total:0.00}");

        // base64 is [A-Za-z0-9+/=] only — strip anything else so a malformed
        // value can't break out of the data: URI attribute.
        static string SanB64(string s) => System.Text.RegularExpressions.Regex.Replace(s, "[^A-Za-z0-9+/=]", "");
        string Img(string? b64, string label) =>
            string.IsNullOrWhiteSpace(b64) ? "" :
            $"<div style=\"margin:8px 0\"><div style=\"font-size:12px;color:#666\">{label}</div>" +
            $"<img src=\"data:image/jpeg;base64,{SanB64(b64)}\" style=\"max-width:100%;border-radius:8px\"/></div>";

        var enc = (string? s) => System.Net.WebUtility.HtmlEncode(s ?? "");
        var html = new StringBuilder();
        html.Append("<div style=\"font-family:sans-serif;max-width:600px;margin:auto\">");
        html.Append($"<h2>{enc(company)} — Service Report</h2>");
        html.Append($"<p><b>{enc(r.ProjectTitle)}</b>");
        if (!string.IsNullOrWhiteSpace(r.ServiceType)) html.Append($"<br/>Service: {enc(r.ServiceType)}");
        html.Append($"<br/>Customer: {enc(r.CustomerName)}");
        if (r.CompletedAt is { } cc) html.Append($"<br/>Completed: {enc(cc.ToLocalTime().ToString("f"))}");
        html.Append("</p>");
        if (!string.IsNullOrWhiteSpace(r.CompletionNotes))
            html.Append($"<h3>Work performed</h3><p>{enc(r.CompletionNotes)}</p>");
        if (r.QuoteTotal is { } t2)
            html.Append($"<p style=\"font-size:18px\"><b>Total: ${enc(t2.ToString("0.00"))}</b></p>");
        if (!string.IsNullOrWhiteSpace(r.BeforePhotoBase64) || !string.IsNullOrWhiteSpace(r.AfterPhotoBase64))
            html.Append("<h3>Photos</h3>");
        html.Append(Img(r.BeforePhotoBase64, "Before"));
        html.Append(Img(r.AfterPhotoBase64, "After"));
        if (!string.IsNullOrWhiteSpace(r.SignatureBase64))
            html.Append($"<h3>Signature</h3><img src=\"data:image/svg+xml;base64,{SanB64(r.SignatureBase64)}\" style=\"max-width:100%;border:1px solid #eee\"/>");
        html.Append($"<p style=\"color:#999;font-size:12px\">Thank you for choosing {enc(company)}.</p></div>");

        return (text.ToString(), html.ToString());
    }
}
