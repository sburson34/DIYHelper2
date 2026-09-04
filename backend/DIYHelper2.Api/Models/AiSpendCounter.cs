namespace DIYHelper2.Api.Models;

/// <summary>
/// One day's tally of AI calls served, persisted so the daily spend ceiling
/// survives a process restart.
///
/// <para><b>Why a table.</b> <see cref="Services.AiSpendGuard"/> kept its counter
/// purely in memory, which meant every redeploy handed the fleet a fresh full
/// budget. On a host that ships several times a day that turns a "2000 calls
/// per day" ceiling into "2000 calls per deploy", and an abuser who watches for
/// releases gets a new allowance each time. Persisting the count makes the cap
/// mean what it says.</para>
///
/// <para><see cref="Day"/> is an ISO <c>yyyy-MM-dd</c> string in UTC rather than a
/// date type, to sidestep provider differences between Npgsql and SQLite for what
/// is only ever used as an exact-match key.</para>
/// </summary>
public class AiSpendCounter
{
    public int Id { get; set; }

    /// <summary>UTC calendar day, <c>yyyy-MM-dd</c>. Unique.</summary>
    public string Day { get; set; } = string.Empty;

    /// <summary>AI calls consumed on that day.</summary>
    public int Count { get; set; }

    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}
