namespace DIYHelper2.Api.Models;

public class HelpRequest
{
    public int Id { get; set; }

    /// <summary>White-label tenant this lead belongs to (see <see cref="Brand"/>).
    /// Set from the app's <c>X-Brand</c> header at create time; determines which
    /// company the lead is emailed to and which dashboard can see it. Denormalized
    /// string (no FK) so a lead survives brand rename/removal and unknown slugs.</summary>
    public string Brand { get; set; } = "diyhelper";

    public string CustomerName { get; set; } = string.Empty;
    public string CustomerEmail { get; set; } = string.Empty;
    public string CustomerPhone { get; set; } = string.Empty;
    public string ProjectTitle { get; set; } = string.Empty;
    public string UserDescription { get; set; } = string.Empty;
    public string ProjectData { get; set; } = string.Empty;
    public string? ImageBase64 { get; set; }
    public string Status { get; set; } = "new";

    /// <summary>Id of the record created in the brand's external CRM when this
    /// lead was pushed there (see <see cref="Integrations.Crm.CrmLeadDispatcher"/>).
    /// Null when the brand has no CRM connection, when the push failed, or when
    /// the provider returns no id (e.g. a generic webhook). Stored for
    /// idempotency + dashboard deep-linking.</summary>
    public string? CrmRemoteId { get; set; }

    public string? Notes { get; set; }
    public DateTime? FollowUpDate { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}
