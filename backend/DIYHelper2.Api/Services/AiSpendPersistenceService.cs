using DIYHelper2.Api.Data;
using DIYHelper2.Api.Models;
using Microsoft.EntityFrameworkCore;

namespace DIYHelper2.Api.Services;

/// <summary>
/// Keeps <see cref="AiSpendGuard"/>'s daily tally on disk: seeds it from the
/// database at startup, then flushes it back on a short interval and once more on
/// shutdown.
///
/// <para>The guard itself stays in-memory so the AI hot path costs a lock and an
/// increment rather than a database round trip. This worker supplies the only
/// thing that could not be done in memory — continuity across a restart — which
/// is what stopped the cap from being reset to a full budget by every
/// redeploy.</para>
///
/// <para>Entirely fail-soft: if the database is unreachable the guard simply
/// behaves as it did before (per-process counting). A spend backstop that took
/// the API down when it could not reach Postgres would be worse than the
/// over-counting it prevents.</para>
/// </summary>
public class AiSpendPersistenceService : BackgroundService
{
    private static readonly TimeSpan FlushInterval = TimeSpan.FromSeconds(30);

    private readonly IServiceProvider _services;
    private readonly AiSpendGuard _guard;
    private readonly ILogger<AiSpendPersistenceService> _logger;

    public AiSpendPersistenceService(
        IServiceProvider services, AiSpendGuard guard, ILogger<AiSpendPersistenceService> logger)
    {
        _services = services;
        _guard = guard;
        _logger = logger;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        await SeedAsync(stoppingToken);

        while (!stoppingToken.IsCancellationRequested)
        {
            try { await Task.Delay(FlushInterval, stoppingToken); } catch (OperationCanceledException) { break; }
            await FlushAsync(CancellationToken.None);
        }

        // Final write so calls served since the last tick aren't lost on a clean
        // shutdown — the redeploy case this whole worker exists for.
        await FlushAsync(CancellationToken.None);
    }

    private async Task SeedAsync(CancellationToken ct)
    {
        try
        {
            using var scope = _services.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();

            var (day, _) = _guard.Snapshot();
            var key = AiSpendGuard.DayKey(day);
            var row = await db.AiSpendCounters.FirstOrDefaultAsync(c => c.Day == key, ct);
            if (row is null) return;

            _guard.Seed(day, row.Count);
            _logger.LogInformation(
                "AI spend guard resumed at {Count}/{Cap} call(s) for {Day}.",
                row.Count, _guard.DailyCap, key);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex,
                "Could not load the persisted AI spend counter; starting this process from zero.");
        }
    }

    private async Task FlushAsync(CancellationToken ct)
    {
        try
        {
            var (day, count) = _guard.Snapshot();
            if (count == 0) return;

            using var scope = _services.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();

            var key = AiSpendGuard.DayKey(day);
            var row = await db.AiSpendCounters.FirstOrDefaultAsync(c => c.Day == key, ct);
            if (row is null)
            {
                db.AiSpendCounters.Add(new AiSpendCounter { Day = key, Count = count, UpdatedAt = DateTime.UtcNow });
            }
            else
            {
                // Never move the stored tally backwards. Our in-memory count starts
                // from whatever we seeded, but a second process (a rolling deploy's
                // overlap window) may have written a higher number in the meantime.
                if (row.Count >= count) return;
                row.Count = count;
                row.UpdatedAt = DateTime.UtcNow;
            }
            await db.SaveChangesAsync(ct);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Could not persist the AI spend counter; will retry on the next tick.");
        }
    }
}
