using DIYHelper2.Api.Models;

namespace DIYHelper2.Api.Integrations.Crm;

/// <summary>
/// Which external CRM / field-service platform a brand's "call a pro" leads are
/// pushed into. <see cref="None"/> means the brand has no CRM connection and the
/// lead is delivered by email only.
/// </summary>
public enum CrmProvider
{
    None = 0,

    /// <summary>Generic outbound JSON webhook — typically a Zapier/Make catch
    /// hook the company wires into whatever CRM they use. The destination is the
    /// brand's <see cref="Brand.LeadWebhookUrl"/>. Covers the long tail of tiny
    /// shops we don't integrate with natively.</summary>
    Webhook = 1,

    // Native OAuth integrations land here in a later wave, each as an additional
    // ICrmLeadSink registration:
    //   Jobber = 2,
    //   HousecallPro = 3,
}

/// <summary>
/// Provider-agnostic projection of a lead, handed to a sink to create the
/// matching record in the external system. Deliberately omits the image payload:
/// webhook targets (Zapier et al.) cap request-body size and the lead already
/// carries enough for a pro to act on and follow up.
/// </summary>
public record CrmLead(
    string CustomerName,
    string? CustomerEmail,
    string? CustomerPhone,
    string ProjectTitle,
    string Description,
    string Brand,
    int LeadId,
    DateTime CreatedAt);

/// <summary>
/// Outcome of a single push. When the provider returns an id for the created
/// record, <see cref="RemoteId"/> carries it so the dispatcher can persist it on
/// the <see cref="HelpRequest"/> for idempotency + dashboard deep-linking.
/// </summary>
public record CrmPushResult(bool Ok, string? RemoteId = null, string? Error = null)
{
    public static CrmPushResult Success(string? remoteId = null) => new(true, remoteId, null);
    public static CrmPushResult Failure(string error) => new(false, null, error);
}

/// <summary>
/// Delivers a lead into one external CRM. Implementations MUST be fail-soft:
/// never throw for a remote/network error, return <see cref="CrmPushResult.Failure"/>
/// instead so the dispatcher can log and move on without failing the customer's
/// submit (they already received their guide).
/// </summary>
public interface ICrmLeadSink
{
    /// <summary>The provider this sink handles. The dispatcher selects a sink by
    /// matching this against the brand's resolved provider.</summary>
    CrmProvider Provider { get; }

    /// <summary>Push one lead for the given brand. Receives the whole
    /// <see cref="Brand"/> so a sink can read its own configuration (webhook URL
    /// today; a stored OAuth connection for native providers later).</summary>
    Task<CrmPushResult> PushAsync(Brand brand, CrmLead lead, CancellationToken ct = default);
}
