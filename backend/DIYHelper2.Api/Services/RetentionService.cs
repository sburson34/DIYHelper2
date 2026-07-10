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
    private readonly JobMediaService _jobMedia;

    public RetentionService(IServiceProvider services, ILogger<RetentionService> logger, IConfiguration config,
        JobMediaService jobMedia)
        : base(services, logger, config)
    {
        _helpRequestRetentionDays = config.GetValue<int?>("Retention:HelpRequestDays") ?? 90;
        _jobMedia = jobMedia;
    }

    protected override async Task PurgeAppSpecificAsync(AppDbContext db, CancellationToken ct)
    {
        var helpCutoff = DateTime.UtcNow.AddDays(-_helpRequestRetentionDays);

        // Delete the S3 media of aged-out rows first (per-key fail-soft — a
        // failed delete leaves an orphan for the bucket lifecycle rule to
        // reap; the row purge below proceeds regardless).
        var mediaKeys = await db.HelpRequests
            .Where(r => r.CreatedAt < helpCutoff
                && (r.ImageKey != null || r.BeforePhotoKey != null
                    || r.AfterPhotoKey != null || r.SignatureKey != null))
            .Select(r => new { r.ImageKey, r.BeforePhotoKey, r.AfterPhotoKey, r.SignatureKey })
            .ToListAsync(ct);
        foreach (var m in mediaKeys)
        {
            await _jobMedia.DeleteKeyAsync(m.ImageKey, ct);
            await _jobMedia.DeleteKeyAsync(m.BeforePhotoKey, ct);
            await _jobMedia.DeleteKeyAsync(m.AfterPhotoKey, ct);
            await _jobMedia.DeleteKeyAsync(m.SignatureKey, ct);
        }

        var deletedHelp = await db.HelpRequests
            .Where(r => r.CreatedAt < helpCutoff)
            .ExecuteDeleteAsync(ct);
        if (deletedHelp > 0)
            Logger.LogInformation(
                "Retention purge: removed {HelpRequests} help requests older than {Days}d.",
                deletedHelp, _helpRequestRetentionDays);
    }
}
