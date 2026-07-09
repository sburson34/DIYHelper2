namespace DIYHelper2.Api.Models;

/// <summary>
/// A scheduled "time for your next service" nudge. Created when a job with a
/// maintenance interval completes, and fired by <c>MaintenanceReminderService</c>
/// when <see cref="DueAt"/> arrives. Deliberately a SEPARATE table from
/// <see cref="HelpRequest"/> (which is purged at 90 days for privacy) so a
/// reminder months out survives — it carries just the minimal contact info it
/// needs, not the full job record.
/// </summary>
public class MaintenanceReminder
{
    public int Id { get; set; }
    public string Brand { get; set; } = "diyhelper";

    /// <summary>The job that generated this reminder (may be purged later).</summary>
    public int? HelpRequestId { get; set; }

    public string CustomerName { get; set; } = string.Empty;
    public string? CustomerEmail { get; set; }
    public string? CustomerPhone { get; set; }
    public string? ServiceType { get; set; }

    /// <summary>When the reminder should be sent.</summary>
    public DateTime DueAt { get; set; }

    /// <summary>When it was sent (null = pending).</summary>
    public DateTime? SentAt { get; set; }

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}
