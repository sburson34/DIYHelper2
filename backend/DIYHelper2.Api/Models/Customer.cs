namespace DIYHelper2.Api.Models;

/// <summary>
/// A lightweight, password-less end-user record for a white-label brand. The app
/// has no login: a customer is recognized across visits by the device id the
/// mobile client already sends (<c>X-Device-Id</c>), and optionally by the
/// email/phone they enter when booking. This row is upserted on every booking
/// (see the <c>POST /api/help-requests</c> handler) so "My Jobs", maintenance
/// reminders and (later) memberships have a stable anchor without a signup wall.
///
/// <para>Tenant model matches the rest of the schema: a denormalized lowercase
/// <see cref="Brand"/> slug (no FK) sourced from the <c>X-Brand</c> header, never
/// the request body.</para>
/// </summary>
public class Customer
{
    public int Id { get; set; }

    /// <summary>White-label tenant this customer belongs to. From <c>X-Brand</c>.</summary>
    public string Brand { get; set; } = "diyhelper";

    /// <summary>Stable per-install id from the app (<c>X-Device-Id</c>). This is
    /// the primary way a returning customer is recognized. Null only for records
    /// created from a channel that has no device (none today).</summary>
    public string? DeviceId { get; set; }

    public string Name { get; set; } = string.Empty;
    public string? Email { get; set; }
    public string? Phone { get; set; }

    /// <summary>Set once the customer proves ownership of <see cref="Email"/> via
    /// a mailed code. Not required for booking or history; reserved as the gate
    /// for sensitive actions (e.g. starting a paid membership).</summary>
    public bool EmailVerified { get; set; }

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;

    /// <summary>Bumped on every request from this device so an operator can see
    /// how recently a customer used the app.</summary>
    public DateTime LastSeenAt { get; set; } = DateTime.UtcNow;
}
