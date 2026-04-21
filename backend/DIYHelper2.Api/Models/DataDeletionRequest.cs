namespace DIYHelper2.Api.Models;

// Privacy-policy commitment: server-side user data is deleted within 30 days of a
// verified request. This row is the record-of-receipt for one such request. The
// actual wipe (help_requests rows, stored media, backups) is handled
// out-of-band after the contact on file has confirmed the request; see
// docs/backend-deletion-endpoint.md for the contract and expected behavior.
public class DataDeletionRequest
{
    public int Id { get; set; }

    // Opaque public identifier returned to the client so the user can reference
    // the request in follow-up support emails. Separate from the DB primary key.
    public string RequestId { get; set; } = Guid.NewGuid().ToString();

    public string? Name { get; set; }
    public string? Email { get; set; }
    public string? Phone { get; set; }

    // Lifecycle: pending_verification → verified → completed
    // (or → rejected if the contact on file repudiates the request).
    public string Status { get; set; } = "pending_verification";

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? VerifiedAt { get; set; }
    public DateTime? CompletedAt { get; set; }
    public string? Notes { get; set; }

    // For abuse analysis and the audit trail referenced in the policy.
    public string? ClientIp { get; set; }
    public string? CorrelationId { get; set; }
    public string? AppVersion { get; set; }
}
