using DIYHelper2.Api.Data;
using DIYHelper2.Api.Models;
using Microsoft.EntityFrameworkCore;

namespace DIYHelper2.Api.Services;

/// <summary>
/// The single write path for job status changes, shared by the owner PUT
/// (<c>/api/help-requests/{id}</c>) and the tech PUT (<c>/api/tech/jobs/{id}</c>)
/// so both surfaces stamp timestamps and fire transition side effects
/// identically. Callers apply their own field updates around
/// <see cref="ApplyStatus"/>, save, then call <see cref="HandleTransitionAsync"/>.
/// </summary>
public class HelpRequestWriteService
{
    private readonly AppDbContext _db;
    private readonly MessagingService _messaging;
    private readonly JobCompletionService _completion;
    private readonly AvailabilityService _availability;

    public HelpRequestWriteService(
        AppDbContext db, MessagingService messaging, JobCompletionService completion,
        AvailabilityService availability)
    {
        _db = db;
        _messaging = messaging;
        _completion = completion;
        _availability = availability;
    }

    /// <summary>
    /// Apply a (possibly null = unchanged) status to the job and stamp the
    /// timestamps that hang off it: <c>StartedAt</c> on the first time the job
    /// is in progress, <c>CompletedAt</c> on the first time it is completed.
    /// Both stamps key off the RESULTING status and only fill a null value, so
    /// re-sending the same status never rewrites history.
    /// </summary>
    public void ApplyStatus(HelpRequest r, string? newStatus)
    {
        if (newStatus is not null) r.Status = newStatus;
        if (r.Status == "in_progress" && r.StartedAt is null) r.StartedAt = DateTime.UtcNow;
        if (r.Status == "completed" && r.CompletedAt is null) r.CompletedAt = DateTime.UtcNow;
    }

    /// <summary>
    /// Post-save side effects of a REAL status transition (no-op when
    /// <paramref name="prevStatus"/> equals the job's current status):
    /// completion → the full <see cref="JobCompletionService"/> pipeline
    /// (invoice + report email + maintenance reminder + review SMS);
    /// scheduled / on_the_way → the customer confirmation texts (best-effort,
    /// only when SMS is configured). Call AFTER SaveChanges so side effects
    /// never run for a write that failed to persist.
    /// </summary>
    public async Task HandleTransitionAsync(HelpRequest r, string? prevStatus, CancellationToken ct = default)
    {
        if (r.Status == prevStatus) return;

        // Cancellation frees any self-scheduling seats the booking held so the
        // slot immediately reopens on /api/availability.
        if (r.Status == "cancelled")
        {
            await _availability.ReleaseAsync(r.Id, ct);
            return;
        }

        // On completion: invoice + report email + maintenance reminder + review SMS.
        if (r.Status == "completed")
        {
            await _completion.HandleAsync(r, ct);
            return;
        }

        // Other transitions fire the confirm / on-the-way texts (best-effort).
        if (!_messaging.IsConfigured) return;
        if (r.Status is not ("scheduled" or "on_the_way")) return;

        var company = (await _db.Brands.FirstOrDefaultAsync(b => b.Slug == r.Brand, ct))?.CompanyName ?? "";
        if (r.Status == "scheduled") await _messaging.NotifyScheduledAsync(r, company, ct);
        else if (r.Status == "on_the_way") await _messaging.NotifyOnTheWayAsync(r, company, ct);
    }
}
