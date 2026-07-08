namespace DIYHelper2.Api.Models;

/// <summary>
/// A single device's Expo push token, registered by the mobile app so a
/// white-label company can send it promotional notifications.
///
/// <para>
/// Keyed to a tenant by <see cref="Brand"/> (denormalized string, no FK — same
/// pattern as <see cref="HelpRequest.Brand"/>) so a company only ever reaches
/// its own customers. <see cref="MarketingOptIn"/> is a separate, revocable
/// consent: a token can be active (the app runs, functional reminders work) yet
/// opted out of promotions, and broadcasts only target opted-in rows. Tokens
/// Expo reports as <c>DeviceNotRegistered</c> are flipped <see cref="IsActive"/>
/// = false by the receipt worker so dead devices stop being messaged.
/// </para>
/// </summary>
public class PushToken
{
    public int Id { get; set; }

    /// <summary>White-label tenant this device belongs to. Set from the app's
    /// <c>X-Brand</c> header at register time (never the body, so a client can't
    /// register into another company's audience).</summary>
    public string Brand { get; set; } = "diyhelper";

    /// <summary>Stable per-install id from the app's <c>X-Device-Id</c> header.
    /// Lets a re-registration from the same install be correlated even if the
    /// Expo token rotates.</summary>
    public string? DeviceId { get; set; }

    /// <summary>The Expo push token, e.g. <c>ExponentPushToken[xxxxxxxx]</c>.
    /// Unique across the table — a re-register upserts this row.</summary>
    public string Token { get; set; } = string.Empty;

    /// <summary>"ios" or "android" (best-effort, from the app).</summary>
    public string Platform { get; set; } = string.Empty;

    /// <summary>Whether this device consented to promotional/advertising pushes.
    /// Broadcasts only target rows where this is true. Revoked from Settings.</summary>
    public bool MarketingOptIn { get; set; }

    /// <summary>False once the device is uninstalled/unreachable (Expo
    /// <c>DeviceNotRegistered</c>) or the user unregisters. Inactive rows are
    /// skipped by every send.</summary>
    public bool IsActive { get; set; } = true;

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;

    /// <summary>Last time the app re-registered this token (liveness signal).</summary>
    public DateTime LastSeenAt { get; set; } = DateTime.UtcNow;
}
