using DIYHelper2.Api.Data;
using Microsoft.EntityFrameworkCore;

namespace DIYHelper2.Api.Services;

/// <summary>
/// Executes verified data-deletion requests — the step that actually removes the
/// user's data.
///
/// <para><b>Why this exists.</b> <c>POST /api/confirm-deletion</c> only marked a
/// request <c>"verified"</c> and left the wipe to an "out-of-band" process that
/// was never built. The only thing removing customer rows was
/// <see cref="RetentionService"/>, which blanket-purges <c>HelpRequests</c> at 90
/// days regardless of any request — so a verified deletion did nothing for a
/// customer whose data was newer than that, and never touched <c>Customers</c>,
/// <c>SmsMessages</c>, <c>MaintenanceReminders</c> or <c>PushTokens</c> at all.
/// The privacy policy promises removal within 30 days of verification; this
/// closes that gap.</para>
///
/// <para><b>Scope is the verified email, deliberately.</b> The verification code
/// is delivered to the <em>email</em> on the request, so email ownership is the
/// only thing the flow actually proves. A request also carries an unverified
/// phone number, and wiping by that would let someone submit their own email
/// alongside a stranger's phone, verify themselves, and destroy the stranger's
/// records. So we match rows by email, then follow those rows to the phone
/// numbers and device ids they contain and clean up the related tables from
/// there. A phone-only request can never reach <c>verified</c> anyway — with no
/// address there is nothing to mail the code to.</para>
///
/// <para>Fail-soft and idempotent: a request that throws part-way stays
/// <c>verified</c> and is retried on the next sweep, where the already-deleted
/// rows simply don't match again. Deletes run as individual statements rather
/// than one transaction because the Npgsql retry-on-failure execution strategy
/// (see <c>DatabaseConfig</c>) rejects manually-managed transactions.</para>
/// </summary>
public class DataDeletionExecutionService : BackgroundService
{
    private static readonly TimeSpan StartupDelay = TimeSpan.FromMinutes(2);
    private static readonly TimeSpan Interval = TimeSpan.FromMinutes(15);

    private readonly IServiceProvider _services;
    private readonly ILogger<DataDeletionExecutionService> _logger;

    public DataDeletionExecutionService(IServiceProvider services, ILogger<DataDeletionExecutionService> logger)
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
                var completed = await ProcessVerifiedAsync(db, _logger, stoppingToken);
                if (completed > 0)
                    _logger.LogInformation("Completed {Count} verified data-deletion request(s).", completed);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Data-deletion sweep failed.");
            }
            try { await Task.Delay(Interval, stoppingToken); } catch (OperationCanceledException) { break; }
        }
    }

    /// <summary>
    /// Wipes data for every request sitting in <c>verified</c>, marking each
    /// <c>completed</c>. Returns how many requests were fulfilled. Static so it is
    /// directly unit-testable without hosting the worker.
    /// </summary>
    public static async Task<int> ProcessVerifiedAsync(
        AppDbContext db, ILogger logger, CancellationToken ct = default)
    {
        var pending = await db.DataDeletionRequests
            .Where(r => r.Status == "verified" && r.CompletedAt == null)
            .OrderBy(r => r.VerifiedAt)
            .Take(100)
            .ToListAsync(ct);
        if (pending.Count == 0) return 0;

        var completed = 0;
        foreach (var request in pending)
        {
            try
            {
                var summary = await WipeAsync(db, request.Email, ct);

                request.Status = "completed";
                request.CompletedAt = DateTime.UtcNow;
                request.Notes = summary.ToString();
                await db.SaveChangesAsync(ct);
                completed++;

                // Log counts only — never the email itself.
                logger.LogInformation(
                    "Data deletion completed for requestId={RequestId}: {Summary}",
                    request.RequestId, summary);
            }
            catch (Exception ex)
            {
                // Left in "verified" so the next sweep retries it.
                logger.LogError(ex,
                    "Data deletion failed for requestId={RequestId}; will retry.", request.RequestId);
            }
        }
        return completed;
    }

    /// <summary>
    /// Removes every row reachable from <paramref name="email"/>. Returns per-table
    /// counts for the audit trail. No-op when the address is blank.
    /// </summary>
    public static async Task<DeletionSummary> WipeAsync(AppDbContext db, string? email, CancellationToken ct = default)
    {
        var summary = new DeletionSummary();
        if (string.IsNullOrWhiteSpace(email)) return summary;

        // Stored addresses keep whatever casing the customer typed, while the
        // request's copy was lowercased on submit — so compare case-insensitively.
        var target = email.Trim().ToLowerInvariant();

        // Everything we can reach from rows this address owns. Phone numbers and
        // device ids are collected from those rows rather than trusted from the
        // request, so an unverified value can never widen the blast radius.
        var leads = await db.HelpRequests
            .Where(r => r.CustomerEmail != null && r.CustomerEmail.ToLower() == target)
            .Select(r => new { r.Id, r.CustomerPhone, r.DeviceId })
            .ToListAsync(ct);

        var customers = await db.Customers
            .Where(c => c.Email != null && c.Email.ToLower() == target)
            .Select(c => new { c.Id, c.Phone, c.DeviceId })
            .ToListAsync(ct);

        var leadIds = leads.Select(l => l.Id).ToList();

        var phones = leads.Select(l => l.CustomerPhone)
            .Concat(customers.Select(c => c.Phone))
            .Where(p => !string.IsNullOrWhiteSpace(p))
            .Select(p => p!)
            .Distinct()
            .ToList();

        var deviceIds = leads.Select(l => l.DeviceId)
            .Concat(customers.Select(c => c.DeviceId))
            .Where(d => !string.IsNullOrWhiteSpace(d))
            .Select(d => d!)
            .Distinct()
            .ToList();

        // ── Dependent rows first, so nothing is orphaned if a later step throws ──

        // The SMS conversation log: messages tied to those jobs, plus any message
        // to/from a phone number those rows carry (inbound replies we never linked).
        if (leadIds.Count > 0)
            summary.SmsMessages += await db.SmsMessages
                .Where(m => m.HelpRequestId != null && leadIds.Contains(m.HelpRequestId.Value))
                .ExecuteDeleteAsync(ct);

        if (phones.Count > 0)
            summary.SmsMessages += await db.SmsMessages
                .Where(m => (m.FromNumber != null && phones.Contains(m.FromNumber))
                         || (m.ToNumber != null && phones.Contains(m.ToNumber)))
                .ExecuteDeleteAsync(ct);

        // Maintenance reminders deliberately outlive their job (see the model), so
        // they must be cleared explicitly or a deleted customer still gets texted.
        summary.MaintenanceReminders += await db.MaintenanceReminders
            .Where(m => m.CustomerEmail != null && m.CustomerEmail.ToLower() == target)
            .ExecuteDeleteAsync(ct);

        if (phones.Count > 0)
            summary.MaintenanceReminders += await db.MaintenanceReminders
                .Where(m => m.CustomerPhone != null && phones.Contains(m.CustomerPhone))
                .ExecuteDeleteAsync(ct);

        // Push tokens are keyed by device, not by contact details — reachable only
        // via the device ids on the rows above.
        if (deviceIds.Count > 0)
            summary.PushTokens += await db.PushTokens
                .Where(t => t.DeviceId != null && deviceIds.Contains(t.DeviceId))
                .ExecuteDeleteAsync(ct);

        // ── The records themselves ──
        if (leadIds.Count > 0)
            summary.HelpRequests += await db.HelpRequests
                .Where(r => leadIds.Contains(r.Id))
                .ExecuteDeleteAsync(ct);

        if (customers.Count > 0)
        {
            var customerIds = customers.Select(c => c.Id).ToList();
            summary.Customers += await db.Customers
                .Where(c => customerIds.Contains(c.Id))
                .ExecuteDeleteAsync(ct);
        }

        return summary;
    }

    /// <summary>Per-table row counts removed by one wipe — recorded on the request
    /// as the receipt of what was actually deleted.</summary>
    public record struct DeletionSummary
    {
        public int HelpRequests { get; set; }
        public int Customers { get; set; }
        public int SmsMessages { get; set; }
        public int MaintenanceReminders { get; set; }
        public int PushTokens { get; set; }

        public override string ToString() =>
            $"helpRequests={HelpRequests} customers={Customers} smsMessages={SmsMessages} "
            + $"maintenanceReminders={MaintenanceReminders} pushTokens={PushTokens}";
    }
}
