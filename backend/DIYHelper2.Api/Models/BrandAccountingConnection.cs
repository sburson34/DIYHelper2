namespace DIYHelper2.Api.Models;

/// <summary>
/// A brand's OAuth connection to an accounting provider (QuickBooks Online).
/// Direct parallel of <see cref="BrandCrmConnection"/> — one row per brand,
/// tokens AES-GCM encrypted at rest, refreshed on demand. Populated by the QBO
/// connect → callback flow; consumed by the invoice provider on job completion.
/// </summary>
public class BrandAccountingConnection
{
    public int Id { get; set; }

    /// <summary>Tenant key (matches <see cref="Brand.Slug"/> / the X-Brand header).
    /// Unique — one accounting connection per brand.</summary>
    public string BrandSlug { get; set; } = string.Empty;

    /// <summary>Provider discriminator (1 = QuickBooks Online). Kept as an int for
    /// forward-compat with other providers (Xero, etc.).</summary>
    public int Provider { get; set; } = 1;

    /// <summary>QBO company id ("realm"), required on every QBO API call.</summary>
    public string? RealmId { get; set; }

    public string? AccessTokenEnc { get; set; }
    public string? RefreshTokenEnc { get; set; }
    public DateTime? AccessTokenExpiresAt { get; set; }

    public bool IsActive { get; set; }

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}
