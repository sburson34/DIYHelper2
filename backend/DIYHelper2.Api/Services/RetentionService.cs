using DIYHelper2.Api.Data;
using Microsoft.EntityFrameworkCore;

namespace DIYHelper2.Api.Services;

/// <summary>
/// Daily job that purges old server-side records to bound retention.
///
/// Policy:
///  - HelpRequests: delete 90 days after CreatedAt. HelpRequests contain
///    customer name/email/phone and project data, so they should not linger
///    forever. Shops that need longer retention can raise <c>HelpRequestRetentionDays</c>.
///  - DataDeletionRequests: delete 2 years after CompletedAt (keep the audit
///    trail of deletion for compliance, but not forever).
///  - BetaFeedback: untouched — these are deliberately long-lived product signal.
///
/// The service runs once a day. First run is delayed 5 minutes after startup
/// so a crash-loop doesn't hammer the DB.
/// </summary>
public class RetentionService : BackgroundService
{
    private readonly IServiceProvider _services;
    private readonly ILogger<RetentionService> _logger;
    private readonly int _helpRequestRetentionDays;
    private readonly int _deletionReceiptRetentionDays;

    public RetentionService(IServiceProvider services, ILogger<RetentionService> logger, IConfiguration config)
    {
        _services = services;
        _logger = logger;
        _helpRequestRetentionDays = config.GetValue<int?>("Retention:HelpRequestDays") ?? 90;
        _deletionReceiptRetentionDays = config.GetValue<int?>("Retention:DeletionReceiptDays") ?? 730;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        try
        {
            await Task.Delay(TimeSpan.FromMinutes(5), stoppingToken);
        }
        catch (TaskCanceledException) { return; }

        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                await PurgeAsync(stoppingToken);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Retention purge failed.");
            }

            try
            {
                await Task.Delay(TimeSpan.FromDays(1), stoppingToken);
            }
            catch (TaskCanceledException) { return; }
        }
    }

    private async Task PurgeAsync(CancellationToken ct)
    {
        using var scope = _services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();

        var helpCutoff = DateTime.UtcNow.AddDays(-_helpRequestRetentionDays);
        var deletedHelp = await db.HelpRequests
            .Where(r => r.CreatedAt < helpCutoff)
            .ExecuteDeleteAsync(ct);

        var deletionCutoff = DateTime.UtcNow.AddDays(-_deletionReceiptRetentionDays);
        var deletedReceipts = await db.DataDeletionRequests
            .Where(r => r.CompletedAt != null && r.CompletedAt < deletionCutoff)
            .ExecuteDeleteAsync(ct);

        if (deletedHelp > 0 || deletedReceipts > 0)
            _logger.LogInformation(
                "Retention purge: removed {HelpRequests} help requests older than {HelpDays}d and {Receipts} deletion receipts older than {ReceiptDays}d.",
                deletedHelp, _helpRequestRetentionDays, deletedReceipts, _deletionReceiptRetentionDays);
    }
}
