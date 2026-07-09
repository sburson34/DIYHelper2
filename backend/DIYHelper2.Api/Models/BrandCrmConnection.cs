namespace DIYHelper2.Api.Models;

/// <summary>
/// A white-label <see cref="Brand"/>'s connection to an external CRM that uses
/// OAuth (Jobber today; Housecall Pro next). One row per brand — the unique
/// <see cref="BrandSlug"/> is the key.
///
/// <para>
/// OAuth tokens are stored ENCRYPTED (AES-256-GCM via
/// <c>Integrations.Crm.CrmTokenProtector</c>), never in plaintext. The generic
/// webhook "provider" needs no row here — it's configured entirely by
/// <see cref="Brand.LeadWebhookUrl"/>. <see cref="Provider"/> holds the int value
/// of <c>Integrations.Crm.CrmProvider</c>; it's stored as an int rather than the
/// enum type so the Models layer carries no dependency on Integrations.
/// </para>
/// </summary>
public class BrandCrmConnection
{
    public int Id { get; set; }

    /// <summary>Brand this connection belongs to. Matches <see cref="Brand.Slug"/>
    /// and <see cref="HelpRequest.Brand"/>. Unique — one CRM connection per brand.</summary>
    public string BrandSlug { get; set; } = string.Empty;

    /// <summary>The connected CRM, as the int value of
    /// <c>Integrations.Crm.CrmProvider</c> (e.g. 2 = Jobber).</summary>
    public int Provider { get; set; }

    /// <summary>AES-GCM-encrypted OAuth access token. Null until first auth.</summary>
    public string? AccessTokenEnc { get; set; }

    /// <summary>AES-GCM-encrypted OAuth refresh token. Jobber rotates the refresh
    /// token on every refresh, so this is rewritten each time we refresh.</summary>
    public string? RefreshTokenEnc { get; set; }

    /// <summary>When the current access token expires (UTC). We refresh slightly
    /// ahead of this to avoid racing the boundary.</summary>
    public DateTime? AccessTokenExpiresAt { get; set; }

    /// <summary>Human-readable account label captured at connect time (e.g. the
    /// Jobber account/company name), for display in the dashboard.</summary>
    public string? RemoteAccountLabel { get; set; }

    /// <summary>When false the connection is ignored by the dispatcher (a soft
    /// disconnect that keeps the row for re-enable/audit).</summary>
    public bool IsActive { get; set; } = true;

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}
