using DIYHelper2.Api.Data;
using Microsoft.EntityFrameworkCore;
using Sburson.Shared.DataDeletion;

namespace DIYHelper2.Api.Services;

/// <summary>
/// Daily job that purges old server-side records to bound retention.
///
/// The shared <see cref="RetentionBackgroundServiceBase{TContext}"/> handles
/// the 5-minute startup delay, the once-a-day cadence, error logging, and
/// the DataDeletionRequest receipt purge (2 years after CompletedAt, see
/// <c>Retention:DeletionReceiptDays</c>). This subclass adds the
/// app-specific HelpRequests purge — they hold customer name/email/phone
/// and project data, so they're capped at 90 days
/// (<c>Retention:HelpRequestDays</c>). BetaFeedback rows are left alone
/// (long-lived product signal).
/// </summary>
public class RetentionService : RetentionBackgroundServiceBase<AppDbContext>
{
    private readonly int _helpRequestRetentionDays;

    public RetentionService(IServiceProvider services, ILogger<RetentionService> logger, IConfiguration config)
        : base(services, logger, config)
    {
        _helpRequestRetentionDays = config.GetValue<int?>("Retention:HelpRequestDays") ?? 90;
    }

    protected override async Task PurgeAppSpecificAsync(AppDbContext db, CancellationToken ct)
    {
        var helpCutoff = DateTime.UtcNow.AddDays(-_helpRequestRetentionDays);
        var deletedHelp = await db.HelpRequests
            .Where(r => r.CreatedAt < helpCutoff)
            .ExecuteDeleteAsync(ct);
        if (deletedHelp > 0)
            Logger.LogInformation(
                "Retention purge: removed {HelpRequests} help requests older than {Days}d.",
                deletedHelp, _helpRequestRetentionDays);
    }
}
