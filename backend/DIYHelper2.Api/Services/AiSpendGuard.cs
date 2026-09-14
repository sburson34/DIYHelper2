namespace DIYHelper2.Api.Services;

/// <summary>
/// Process-wide daily backstop on the number of AI (vision/LLM) calls served,
/// as a last line of defence against runaway provider spend.
///
/// The per-device quota (<c>DeviceQuotaService</c>) and per-IP rate limiter are
/// the primary controls, but both are bypassable at scale — the device key is a
/// client-supplied header and a botnet spreads across many IPs. This guard caps
/// the <em>aggregate</em> daily call count regardless of who is calling, so the
/// worst-case bill for a bad day is bounded rather than open-ended.
///
/// The count is held in memory so the hot path stays a lock and an increment,
/// and is mirrored to the <c>AiSpendCounters</c> table by
/// <see cref="AiSpendPersistenceService"/> — seeded on startup, flushed
/// periodically. Without that mirror the counter reset on every redeploy, which
/// on a host that ships a few times a day quietly converted "N calls per day"
/// into "N calls per deploy" and handed anyone watching for releases a fresh
/// allowance each time.
///
/// Caveats (by design — this is a free, code-only backstop):
///  - Per-process: the count is NOT shared live across instances, so a
///    horizontally-scaled deployment would enforce roughly N×cap. Fine for the
///    current single-instance host; move to Redis/DynamoDB before scaling out.
///  - Counts calls, not tokens/dollars — a coarse but effective ceiling.
///
/// The cap is generous by default so it never throttles legitimate use; it only
/// trips on genuinely abnormal volume. Override via <c>AI_GLOBAL_DAILY_CAP</c>.
/// </summary>
public sealed class AiSpendGuard
{
    private readonly int _dailyCap;
    private readonly object _gate = new();
    private DateOnly _day = DateOnly.FromDateTime(DateTime.UtcNow);
    private int _count;

    public AiSpendGuard()
    {
        _dailyCap = int.TryParse(Environment.GetEnvironmentVariable("AI_GLOBAL_DAILY_CAP"), out var cap) && cap > 0
            ? cap
            : 2000;
    }

    public int DailyCap => _dailyCap;

    /// <summary>ISO key for a UTC day, matching <c>AiSpendCounter.Day</c>.</summary>
    public static string DayKey(DateOnly day) => day.ToString("yyyy-MM-dd");

    /// <summary>
    /// Adopt a previously-persisted tally for <paramref name="day"/>. Ignored if
    /// that day is no longer current (the process crossed UTC midnight before the
    /// seed landed) or if the in-memory count has already moved past it, so a late
    /// or duplicated seed can never hand back budget that was already spent.
    /// </summary>
    public void Seed(DateOnly day, int count)
    {
        lock (_gate)
        {
            RollOverIfNeeded();
            if (day != _day || count <= _count) return;
            _count = count;
        }
    }

    /// <summary>Current day + tally, for the persistence worker to write out.</summary>
    public (DateOnly Day, int Count) Snapshot()
    {
        lock (_gate)
        {
            RollOverIfNeeded();
            return (_day, _count);
        }
    }

    /// <summary>
    /// Records one AI call against today's budget. Returns <c>true</c> if the
    /// call is within the cap, <c>false</c> if today's ceiling is already
    /// reached (the caller should then reject with 503). Rolls the counter over
    /// at UTC midnight.
    /// </summary>
    public bool TryConsume(out int remaining)
    {
        lock (_gate)
        {
            RollOverIfNeeded();

            if (_count >= _dailyCap)
            {
                remaining = 0;
                return false;
            }

            _count++;
            remaining = _dailyCap - _count;
            return true;
        }
    }

    /// <summary>Resets the tally when the UTC date has advanced. Callers must
    /// already hold <see cref="_gate"/>.</summary>
    private void RollOverIfNeeded()
    {
        var today = DateOnly.FromDateTime(DateTime.UtcNow);
        if (today == _day) return;
        _day = today;
        _count = 0;
    }
}
