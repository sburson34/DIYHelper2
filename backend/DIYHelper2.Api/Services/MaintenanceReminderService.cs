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
