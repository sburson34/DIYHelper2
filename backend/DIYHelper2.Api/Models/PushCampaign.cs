namespace DIYHelper2.Api.Models;

/// <summary>
/// One push broadcast composed in the owner portal. Records what was sent (or
/// is scheduled to be sent) plus delivery stats, so a company has a history of
/// its promotional campaigns.
///
/// <para>
/// Scoped to a tenant by <see cref="Brand"/> exactly like <see cref="HelpRequest"/>:
/// a per-brand dashboard login only ever sees/creates its own campaigns. The
/// dispatch worker picks up rows with <see cref="Status"/> == "scheduled" whose
/// <see cref="ScheduledFor"/> has arrived; the receipt worker later fills in
/// <see cref="DeliveredCount"/>/<see cref="FailedCount"/> from Expo receipts.
/// </para>
/// </summary>
public class PushCampaign : IBrandOwned
{
    public int Id { get; set; }

    /// <summary>White-label tenant that owns this campaign (its <c>Slug</c>).</summary>
    public string Brand { get; set; } = "diyhelper";

    public string Title { get; set; } = string.Empty;
    public string Body { get; set; } = string.Empty;

    /// <summary>Optional iOS subtitle (shown under the title).</summary>
    public string? Subtitle { get; set; }

    /// <summary>Optional rich-notification image URL (https only).</summary>
    public string? ImageUrl { get; set; }

    /// <summary>Optional JSON payload delivered with the notification (e.g. a
    /// deep link the app routes on tap). Stored as raw JSON text.</summary>
    public string? DataJson { get; set; }

    /// <summary>Optional platform filter: "ios", "android", or null for all.</summary>
    public string? PlatformFilter { get; set; }

    /// <summary>Lifecycle: "scheduled" | "sending" | "sent" | "failed" | "canceled".</summary>
    public string Status { get; set; } = "scheduled";

    /// <summary>When to send. Null (or a past time) means "send now" — the
    /// endpoint dispatches immediately instead of leaving it for the worker.</summary>
    public DateTime? ScheduledFor { get; set; }

    /// <summary>When the send actually went out to Expo.</summary>
    public DateTime? SentAt { get; set; }

    /// <summary>How many active opted-in devices the send targeted.</summary>
    public int RecipientCount { get; set; }

    /// <summary>Confirmed delivered (from Expo receipts).</summary>
    public int DeliveredCount { get; set; }

    /// <summary>Failed delivery (from Expo receipts / send errors).</summary>
    public int FailedCount { get; set; }

    /// <summary>JSON array of Expo ticket ids still awaiting a receipt, used by
    /// the receipt worker. Cleared once all receipts are resolved.</summary>
    public string? TicketsJson { get; set; }

    /// <summary>Dashboard user that composed it ("__super__" or a brand slug).</summary>
    public string? CreatedBy { get; set; }

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}
