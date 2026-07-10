using System.Text.Json;
using System.Text.Json.Serialization;
using DIYHelper2.Api.Data;
using DIYHelper2.Api.Models;
using Microsoft.EntityFrameworkCore;

namespace DIYHelper2.Api.Services;

/// <summary>
/// Online self-scheduling: expands a brand's local business hours into UTC
/// slots, computes what's still open (capacity minus <see cref="SlotClaim"/>
/// rows), claims a seat transactionally at booking, and releases seats on
/// cancel/delete. Unconfigured brands (no <c>BusinessHoursJson</c>) simply have
/// no slots — the app falls back to the legacy preferred-day/window chips.
/// </summary>
public class AvailabilityService
{
    public record Slot(DateTime StartUtc, DateTime EndUtc, int Remaining);

    private sealed record HoursWindow(
        [property: JsonPropertyName("start")] string? Start,
        [property: JsonPropertyName("end")] string? End);

    private static readonly string[] DayKeys = { "sun", "mon", "tue", "wed", "thu", "fri", "sat" };

    private readonly AppDbContext _db;

    public AvailabilityService(AppDbContext db) => _db = db;

    /// <summary>Coerce an inbound slot timestamp to UTC (ISO strings with an
    /// offset parse as Local; bare ones as Unspecified — treat those as UTC).</summary>
    public static DateTime AsUtc(DateTime dt) => dt.Kind switch
    {
        DateTimeKind.Utc => dt,
        DateTimeKind.Local => dt.ToUniversalTime(),
        _ => DateTime.SpecifyKind(dt, DateTimeKind.Utc),
    };

    /// <summary>
    /// Pure expansion of one brand-local calendar day's business hours into
    /// UTC slot windows. Handles DST: local times that don't exist on a
    /// spring-forward day are skipped; ambiguous fall-back times resolve to
    /// standard time (TimeZoneInfo's default). Unconfigured/malformed hours,
    /// an unknown time zone, or a nonsensical slot length → empty.
    /// </summary>
    public static List<(DateTime StartUtc, DateTime EndUtc)> ExpandSlotsUtc(
        string? businessHoursJson, DateOnly date, string timeZoneId, int slotMinutes)
    {
        var slots = new List<(DateTime, DateTime)>();
        if (string.IsNullOrWhiteSpace(businessHoursJson) || slotMinutes <= 0) return slots;

        TimeZoneInfo tz;
        try { tz = TimeZoneInfo.FindSystemTimeZoneById(timeZoneId); }
        catch { return slots; }

        Dictionary<string, List<HoursWindow>>? hours;
        try { hours = JsonSerializer.Deserialize<Dictionary<string, List<HoursWindow>>>(businessHoursJson); }
        catch (JsonException) { return slots; }
        if (hours is null) return slots;

        var dayKey = DayKeys[(int)date.DayOfWeek];
        if (!hours.TryGetValue(dayKey, out var windows) || windows is null) return slots;

        foreach (var w in windows)
        {
            if (!TimeOnly.TryParseExact(w?.Start, "HH:mm", out var start)) continue;
            if (!TimeOnly.TryParseExact(w?.End, "HH:mm", out var end)) continue;
            var startMin = start.Hour * 60 + start.Minute;
            var endMin = end.Hour * 60 + end.Minute;
            if (endMin <= startMin) continue;

            for (var m = startMin; m + slotMinutes <= endMin; m += slotMinutes)
            {
                var localStart = date.ToDateTime(new TimeOnly(m / 60, m % 60), DateTimeKind.Unspecified);
                // Spring-forward: a start inside the skipped hour doesn't exist
                // locally — drop that slot rather than guess. The end is plain
                // UTC arithmetic (start + slot length), which stays correct
                // even when the local end label falls in the skipped hour.
                if (tz.IsInvalidTime(localStart)) continue;
                var startUtc = TimeZoneInfo.ConvertTimeToUtc(localStart, tz);
                slots.Add((startUtc, startUtc.AddMinutes(slotMinutes)));
            }
        }

        return slots;
    }

    /// <summary>Seats per slot: the owner's explicit capacity, else the brand's
    /// active technician count.</summary>
    public async Task<int> ResolveCapacityAsync(Brand brand, CancellationToken ct = default)
        => brand.SlotCapacity
           ?? await _db.Technicians.CountAsync(t => t.Brand == brand.Slug && t.IsActive, ct);

    /// <summary>The still-bookable slots of one brand-local day: expanded hours
    /// minus past starts minus fully-claimed slots. Empty when the brand hasn't
    /// configured hours (or has zero capacity).</summary>
    public async Task<List<Slot>> GetOpenSlotsAsync(
        Brand brand, DateOnly date, DateTime? nowUtc = null, CancellationToken ct = default)
    {
        var expanded = ExpandSlotsUtc(brand.BusinessHoursJson, date, brand.TimeZoneId, brand.SlotMinutes);
        if (expanded.Count == 0) return new List<Slot>();

        var capacity = await ResolveCapacityAsync(brand, ct);
        if (capacity <= 0) return new List<Slot>();

        var starts = expanded.Select(e => e.StartUtc).ToList();
        var claimCounts = await _db.SlotClaims
            .Where(c => c.Brand == brand.Slug && starts.Contains(c.SlotStartUtc))
            .GroupBy(c => c.SlotStartUtc)
            .Select(g => new { Start = g.Key, Count = g.Count() })
            .ToListAsync(ct);
        var claimed = claimCounts.ToDictionary(x => x.Start, x => x.Count);

        var now = nowUtc ?? DateTime.UtcNow;
        return expanded
            .Where(e => e.StartUtc > now) // exclude past
            .Select(e => new Slot(e.StartUtc, e.EndUtc,
                capacity - claimed.GetValueOrDefault(e.StartUtc)))
            .Where(s => s.Remaining > 0)
            .ToList();
    }

    /// <summary>
    /// Claim one seat in a slot for a booking. Tries seats 0..capacity-1; a
    /// unique-index collision (concurrent booking won the seat) moves on to
    /// the next. False ⇒ every seat is taken (caller 409s and rolls back).
    /// Call inside the booking's transaction — EF's automatic savepoints keep
    /// a lost seat race from poisoning the outer transaction.
    /// </summary>
    public async Task<bool> TryClaimAsync(
        Brand brand, DateTime slotStartUtc, int helpRequestId, CancellationToken ct = default)
    {
        var capacity = await ResolveCapacityAsync(brand, ct);
        if (capacity <= 0) return false;

        var takenSeqs = await _db.SlotClaims
            .Where(c => c.Brand == brand.Slug && c.SlotStartUtc == slotStartUtc)
            .Select(c => c.Seq)
            .ToListAsync(ct);

        for (var seq = 0; seq < capacity; seq++)
        {
            if (takenSeqs.Contains(seq)) continue;
            var claim = new SlotClaim
            {
                Brand = brand.Slug,
                SlotStartUtc = slotStartUtc,
                Seq = seq,
                HelpRequestId = helpRequestId,
            };
            _db.SlotClaims.Add(claim);
            try
            {
                await _db.SaveChangesAsync(ct);
                return true;
            }
            catch (DbUpdateException)
            {
                // Lost the race for this seat — detach the failed row and try
                // the next seat number.
                _db.Entry(claim).State = EntityState.Detached;
            }
        }
        return false;
    }

    /// <summary>Free every seat a booking holds (cancel / owner delete).</summary>
    public Task ReleaseAsync(int helpRequestId, CancellationToken ct = default)
        => _db.SlotClaims.Where(c => c.HelpRequestId == helpRequestId).ExecuteDeleteAsync(ct);
}
