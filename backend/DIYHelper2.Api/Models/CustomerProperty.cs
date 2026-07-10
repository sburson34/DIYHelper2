namespace DIYHelper2.Api.Models;

/// <summary>
/// A service address a customer saves in the app ("Home", "Rental on 5th",
/// "Mom's house") so multi-property customers can book against the right
/// location without retyping it. Anchored to the <see cref="Customer"/> row by
/// id (the customer is resolved by Brand + X-Device-Id, same password-less
/// model as everything else). Address columns mirror the A5 design on
/// <see cref="HelpRequest"/> — booking with a propertyId copies them (and any
/// coords) onto the job, skipping the geocoder when coords already exist.
/// </summary>
public class CustomerProperty : IBrandOwned
{
    public int Id { get; set; }

    /// <summary>White-label tenant this property belongs to. From <c>X-Brand</c>.</summary>
    public string Brand { get; set; } = "diyhelper";

    /// <summary>The owning <see cref="Customer"/> row's id. Denormalized, no FK.</summary>
    public int CustomerId { get; set; }

    /// <summary>Display name, e.g. "Home" or "Rental on 5th". Required.</summary>
    public string Label { get; set; } = string.Empty;

    // ── Address (same column design as HelpRequest's A5 block) ────────────
    public string? Address { get; set; }
    public string? City { get; set; }
    public string? State { get; set; }
    public string? Zip { get; set; }

    /// <summary>Coordinates, when known. Copied onto jobs booked against this
    /// property so the booking geocode hook can be skipped.</summary>
    public double? Lat { get; set; }

    public double? Lng { get; set; }

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}
