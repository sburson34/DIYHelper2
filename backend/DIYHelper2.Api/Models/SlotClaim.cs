namespace DIYHelper2.Api.Models;

/// <summary>
/// One booked seat in one self-scheduling slot. The UNIQUE index on
/// (<see cref="Brand"/>, <see cref="SlotStartUtc"/>, <see cref="Seq"/>) is the
/// database-level double-booking guarantee: capacity N means seats 0..N-1, and
/// two concurrent bookings racing for the same seat collide on the index — the
/// loser retries the next seat or gets <c>409 slot_taken</c>. Rows are removed
/// when the job is cancelled or deleted (<c>AvailabilityService.ReleaseAsync</c>).
/// </summary>
public class SlotClaim
{
    public int Id { get; set; }

    /// <summary>Tenant slug — slots are per-brand (denormalized, no FK).</summary>
    public string Brand { get; set; } = "diyhelper";

    /// <summary>Slot start in UTC (business hours are expanded from the
    /// brand-local schedule at query time).</summary>
    public DateTime SlotStartUtc { get; set; }

    /// <summary>Seat number within the slot: 0..capacity-1.</summary>
    public int Seq { get; set; }

    /// <summary>The booking that holds this seat.</summary>
    public int HelpRequestId { get; set; }

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}
