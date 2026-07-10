namespace DIYHelper2.Api.Models;

/// <summary>
/// A piece of customer equipment (water heater, furnace, AC unit…) that jobs
/// can be booked against, powering per-asset service history and warranty
/// nudges. Owned by whichever customer created it (by device id) and/or by an
/// email the owner attached — the same password-less identity model as
/// <see cref="Customer"/>: a device sees an asset when <see cref="DeviceId"/>
/// matches, or when <see cref="CustomerEmail"/> matches the email on the
/// device's customer record (so owner-entered equipment shows up for the
/// customer who booked with that email). Denormalized brand slug, no FKs,
/// matching the rest of the schema.
/// </summary>
public class Asset : IBrandOwned
{
    public int Id { get; set; }

    /// <summary>White-label tenant this asset belongs to. From <c>X-Brand</c>
    /// (customer create) or scope/body (owner create).</summary>
    public string Brand { get; set; } = "diyhelper";

    /// <summary>Per-install id of the device that created the asset (customer
    /// flow). Null for owner-entered assets until a customer claims them by
    /// email match.</summary>
    public string? DeviceId { get; set; }

    /// <summary>Customer email this asset is attached to. Set from the known
    /// customer record on customer create, or typed by the owner. Lets the
    /// asset follow the customer across reinstalls (new device id).</summary>
    public string? CustomerEmail { get; set; }

    /// <summary>The <see cref="CustomerProperty"/> this asset lives at (multi-
    /// property customers). Denormalized id, no FK; null = unassigned.</summary>
    public int? PropertyId { get; set; }

    /// <summary>Display name, e.g. "Basement water heater". Required.</summary>
    public string Label { get; set; } = string.Empty;

    public string? Make { get; set; }
    public string? Model { get; set; }
    public string? Serial { get; set; }

    /// <summary>When the unit was installed (age drives replace-vs-repair talk).</summary>
    public DateTime? InstalledAt { get; set; }

    /// <summary>When the manufacturer warranty runs out — drives the warranty-
    /// check reminder sweep in <c>MaintenanceReminderService</c>.</summary>
    public DateTime? WarrantyExpiresAt { get; set; }

    public string? Notes { get; set; }

    /// <summary>Idempotency stamp for the warranty sweep: set when the
    /// "warranty check" reminder for this asset was created, so a sweep that
    /// runs every tick never creates a second one.</summary>
    public DateTime? WarrantyReminderCreatedAt { get; set; }

    /// <summary>Owner soft-retire flag (unit replaced/removed). Inactive assets
    /// are skipped by the warranty sweep.</summary>
    public bool IsActive { get; set; } = true;

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}
