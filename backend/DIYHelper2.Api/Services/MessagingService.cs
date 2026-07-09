using DIYHelper2.Api.Data;
using DIYHelper2.Api.Integrations.Messaging;
using DIYHelper2.Api.Models;
using Microsoft.EntityFrameworkCore;

namespace DIYHelper2.Api.Services;

/// <summary>
/// Composes and sends customer SMS, and records every message (in + out) to the
/// <see cref="SmsMessage"/> log. All methods are fail-soft: an SMS failure is
/// logged and swallowed so it never breaks the flow that triggered it (booking,
/// scheduling, completing a job). Uses the brand's own sending number when set.
/// </summary>
public class MessagingService
{
    private readonly ISmsSender _sender;
    private readonly AppDbContext _db;
    private readonly ILogger<MessagingService> _logger;

    public MessagingService(ISmsSender sender, AppDbContext db, ILogger<MessagingService> logger)
    {
        _sender = sender;
        _db = db;
        _logger = logger;
    }

    public bool IsConfigured => _sender.IsConfigured;

    /// <summary>Send a text to the customer on a lead and log it. Returns the
    /// result so a manual-send endpoint can surface success/unavailable.</summary>
    public async Task<SmsResult> SendToLeadAsync(HelpRequest lead, string body, CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(lead.CustomerPhone))
            return SmsResult.Unavailable("This customer has no phone number on file.");

        var brand = await _db.Brands.FirstOrDefaultAsync(b => b.Slug == lead.Brand, ct);
        var from = brand?.SmsFromNumber;

        SmsResult result;
        try
        {
            result = await _sender.SendAsync(lead.CustomerPhone, body, from, ct);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "SMS send threw for lead {Id}.", lead.Id);
            result = SmsResult.Unavailable("SMS send failed.");
        }

        _db.Add(new SmsMessage
        {
            Brand = lead.Brand,
            HelpRequestId = lead.Id == 0 ? null : lead.Id,   // pseudo-lead (missed call) → no link
            Direction = "out",
            FromNumber = from,
            ToNumber = lead.CustomerPhone,
            Body = body,
            RemoteId = result.RemoteId,
            Sent = result.Ok,
        });
        await _db.SaveChangesAsync(ct);
        return result;
    }

    // ── Automated messages (best-effort; never throw into the caller) ──────
    public Task NotifyScheduledAsync(HelpRequest lead, string company, CancellationToken ct = default)
    {
        if (!IsConfigured || lead.ScheduledFor is null) return Task.CompletedTask;
        var when = lead.ScheduledFor.Value.ToLocalTime().ToString("ddd MMM d, h:mm tt");
        return FireAndLogAsync(lead, $"{company}: your appointment is confirmed for {when}. Reply if you need to reschedule.", ct);
    }

    public Task NotifyOnTheWayAsync(HelpRequest lead, string company, CancellationToken ct = default)
    {
        if (!IsConfigured) return Task.CompletedTask;
        var eta = lead.TechEtaMinutes is { } m and > 0 ? $" (~{m} min out)" : "";
        return FireAndLogAsync(lead, $"{company}: your technician is on the way{eta}. See you soon!", ct);
    }

    public Task RequestReviewAsync(HelpRequest lead, string company, string? reviewUrl, CancellationToken ct = default)
    {
        if (!IsConfigured) return Task.CompletedTask;
        var link = string.IsNullOrWhiteSpace(reviewUrl) ? "" : $" {reviewUrl}";
        return FireAndLogAsync(lead, $"Thanks for choosing {company}! We'd love a quick review.{link}", ct);
    }

    private async Task FireAndLogAsync(HelpRequest lead, string body, CancellationToken ct)
    {
        try { await SendToLeadAsync(lead, body, ct); }
        catch (Exception ex) { _logger.LogWarning(ex, "Automated SMS failed for lead {Id}.", lead.Id); }
    }

    /// <summary>Record an inbound reply from the Twilio webhook, linking it to the
    /// most recent lead for that phone + brand when possible.</summary>
    public async Task RecordInboundAsync(string brand, string from, string to, string body, CancellationToken ct = default)
    {
        var lead = await _db.HelpRequests
            .Where(r => r.Brand == brand && r.CustomerPhone == from)
            .OrderByDescending(r => r.CreatedAt)
            .FirstOrDefaultAsync(ct);
        _db.Add(new SmsMessage
        {
            Brand = brand,
            HelpRequestId = lead?.Id,
            Direction = "in",
            FromNumber = from,
            ToNumber = to,
            Body = body,
            Sent = true,
        });
        await _db.SaveChangesAsync(ct);
    }
}
