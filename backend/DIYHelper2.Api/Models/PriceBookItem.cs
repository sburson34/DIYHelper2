namespace DIYHelper2.Api.Models;

/// <summary>
/// A reusable flat-rate line item in a brand's price book. The owner builds a
/// quote for a job by picking these (or adding one-off custom lines), instead of
/// hand-typing prices every time. Brand-scoped like everything else (denormalized
/// slug, no FK).
/// </summary>
public class PriceBookItem : IBrandOwned
{
    public int Id { get; set; }
    public string Brand { get; set; } = "diyhelper";

    public string Name { get; set; } = string.Empty;

    /// <summary>Default price in the brand's currency (assumed USD). Stored as
    /// decimal for exact money math; the operator can override per quote.</summary>
    public decimal DefaultPrice { get; set; }

    public bool IsActive { get; set; } = true;

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}
