using DIYHelper2.Api.Data;
using DIYHelper2.Api.Models;
using Microsoft.EntityFrameworkCore;
using Sburson.Shared.Email;

namespace DIYHelper2.Api.Services;

/// <summary>
/// Daily worker that fires due maintenance reminders — the recurring-revenue
/// engine. Scans <see cref="MaintenanceReminder"/> for rows past their DueAt and
/// not yet sent, emails (and texts, if SMS is configured) the customer a "time
/// for your next service" nudge, and marks them sent. The scan logic lives in the
/// static <see cref="ProcessDueAsync"/> so it's directly unit-testable.
/// </summary>
public class MaintenanceReminderService : BackgroundService
{
    private static readonly TimeSpan StartupDelay = TimeSpan.FromMinutes(5);
    private static readonly TimeSpan Interval = TimeSpan.FromHours(24);

    private readonly IServiceProvider _services;
    private readonly ILogger<MaintenanceReminderService> _logger;

    public MaintenanceReminderService(IServiceProvider services, ILogger<MaintenanceReminderService> logger)
    {
        _services = services;
        _logger = logger;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        try { await Task.Delay(StartupDelay, stoppingToken); } catch (OperationCanceledException) { return; }
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                using var scope = _services.CreateScope();
                var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
                var mailer = scope.ServiceProvider.GetRequiredService<IEmailService>();
                var messaging = scope.ServiceProvider.GetRequiredService<MessagingService>();
                // Warranty sweep first, so a reminder that's already due (a
                // warranty expiring within the 30-day lead) fires on the very
                // same tick that created it.
                var created = await CreateWarrantyRemindersAsync(db, _logger, stoppingToken);
                if (created > 0) _logger.LogInformation("Created {Count} warranty-check reminders.", created);
                var sent = await ProcessDueAsync(db, mailer, messaging, _logger, stoppingToken);
                if (sent > 0) _logger.LogInformation("Sent {Count} maintenance reminders.", sent);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Maintenance reminder sweep failed.");
            }
            try { await Task.Delay(Interval, stoppingToken); } catch (OperationCanceledException) { break; }
        }
    }

    /// <summary>
    /// Warranty sweep (A8): for every active asset whose warranty expires
    /// within 60 days and that hasn't been swept yet, create a "warranty
    /// check" reminder due 30 days before expiry (or now, if we're already
    /// inside that window) and stamp <c>WarrantyReminderCreatedAt</c> so the
    /// sweep is idempotent across ticks. Assets with no customer email are
    /// skipped (left unstamped, so attaching an email later still gets the
    /// nudge). Returns how many reminders were created.
    /// </summary>
    public static async Task<int> CreateWarrantyRemindersAsync(
        AppDbContext db, ILogger logger, CancellationToken ct = default)
    {
        var now = DateTime.UtcNow;
        var horizon = now.AddDays(60);
        var expiring = await db.Assets
            .Where(a => a.IsActive
                && a.WarrantyExpiresAt != null
                && a.WarrantyReminderCreatedAt == null
                && a.WarrantyExpiresAt <= horizon
                && a.CustomerEmail != null)
            .OrderBy(a => a.WarrantyExpiresAt)
            .Take(200)
            .ToListAsync(ct);
        if (expiring.Count == 0) return 0;

        foreach (var a in expiring)
        {
            var dueAt = a.WarrantyExpiresAt!.Value.AddDays(-30);
            if (dueAt < now) dueAt = now;
            db.MaintenanceReminders.Add(new MaintenanceReminder
            {
                Brand = a.Brand,
                CustomerEmail = a.CustomerEmail,
                ServiceType = $"warranty check — {a.Label}",
                DueAt = dueAt,
            });
            a.WarrantyReminderCreatedAt = now;
        }
        await db.SaveChangesAsync(ct);
        logger.LogInformation("Warranty sweep created {Count} reminders.", expiring.Count);
        return expiring.Count;
    }

    /// <summary>Send every reminder that's due and unsent; returns how many fired.
    /// Fail-soft per row so one bad address doesn't stall the batch.</summary>
    public static async Task<int> ProcessDueAsync(
        AppDbContext db, IEmailService mailer, MessagingService messaging, ILogger logger, CancellationToken ct = default)
    {
        var now = DateTime.UtcNow;
        var due = await db.MaintenanceReminders
            .Where(m => m.SentAt == null && m.DueAt <= now)
            .OrderBy(m => m.DueAt)
            .Take(200)
            .ToListAsync(ct);
        if (due.Count == 0) return 0;

        // Resolve company names once per brand.
        var brandSlugs = due.Select(d => d.Brand).Distinct().ToList();
        var companies = await db.Brands
            .Where(b => brandSlugs.Contains(b.Slug))
            .ToDictionaryAsync(b => b.Slug, b => b.CompanyName, ct);

        var sent = 0;
        foreach (var m in due)
        {
            try
            {
                var company = companies.TryGetValue(m.Brand, out var c) && !string.IsNullOrWhiteSpace(c) ? c : "your service provider";
                var service = string.IsNullOrWhiteSpace(m.ServiceType) ? "service" : m.ServiceType!;
                var name = string.IsNullOrWhiteSpace(m.CustomerName) ? "there" : m.CustomerName;

                if (!string.IsNullOrWhiteSpace(m.CustomerEmail))
                {
                    var body = $"Hi {name},\n\nIt's been a while — it may be time for your next {service} with {company}. " +
                               "Reply to this email or book in the app and we'll get you scheduled.\n\nThanks!";
                    await mailer.SendAsync(m.CustomerEmail!, $"Time for your next {service}?", body, null, ct);
                }
                if (messaging.IsConfigured && !string.IsNullOrWhiteSpace(m.CustomerPhone))
                {
                    var lead = new HelpRequest { Brand = m.Brand, CustomerPhone = m.CustomerPhone };
                    await messaging.SendToLeadAsync(lead,
                        $"{company}: it may be time for your next {service}. Reply or book in the app and we'll schedule you.", ct);
                }

                m.SentAt = now;
                sent++;
            }
            catch (Exception ex)
            {
                logger.LogWarning(ex, "Maintenance reminder {Id} failed to send.", m.Id);
            }
        }
        await db.SaveChangesAsync(ct);
        return sent;
    }
}
