namespace DIYHelper2.Api.Models;

/// <summary>
/// A white-label tenant. One row per company the app is rebranded for. The
/// <see cref="Slug"/> matches the mobile app's build-time brand id (sent as the
/// <c>X-Brand</c> header), which is how a "call a pro" lead
/// (<see cref="HelpRequest"/>) is attributed and routed to the right company.
///
/// <para>
/// Dashboard credentials are nullable: the flagship <c>diyhelper</c> brand
/// exists purely for lead routing and its operator signs in with the
/// super-admin config credentials (ADMIN_USERNAME/ADMIN_PASSWORD), not a row
/// here. A company brand gets a <see cref="DashboardUsername"/> +
/// <see cref="DashboardPasswordHash"/> so it can log into the scoped dashboard.
/// </para>
/// </summary>
public class Brand
{
    public int Id { get; set; }

    /// <summary>Stable lowercase id, e.g. "diyhelper", "acme-home". Matches the
    /// app's <c>X-Brand</c> header and the brands/&lt;slug&gt; build folder.</summary>
    public string Slug { get; set; } = string.Empty;

    public string CompanyName { get; set; } = string.Empty;

    /// <summary>Where each lead for this brand is emailed on submit.</summary>
    public string LeadEmail { get; set; } = string.Empty;

    /// <summary>Optional per-brand webhook for companies with their own CRM.
    /// Reserved for a future delivery mode; not wired yet.</summary>
    public string? LeadWebhookUrl { get; set; }

    /// <summary>Basic-Auth username for the scoped dashboard. Null for brands
    /// that don't get their own login (e.g. the flagship super-brand).</summary>
    public string? DashboardUsername { get; set; }

    /// <summary>BCrypt hash of the dashboard password
    /// (<see cref="Sburson.Shared.Auth.PasswordHasher"/>). Null → no login.</summary>
    public string? DashboardPasswordHash { get; set; }

    /// <summary>When false the dashboard login is refused (fail-closed for a
    /// brand seeded without a password).</summary>
    public bool IsActive { get; set; } = true;

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}
