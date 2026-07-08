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
/// Caveats (by design — this is a free, code-only backstop):
///  - In-memory and per-process: the counter resets on restart/redeploy and is
///    NOT shared across instances. Fine for the current single-instance
///    deployment; move to Redis/DynamoDB before scaling horizontally.
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
            var today = DateOnly.FromDateTime(DateTime.UtcNow);
            if (today != _day)
            {
                _day = today;
                _count = 0;
            }

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
}
