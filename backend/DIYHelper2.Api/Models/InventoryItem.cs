namespace DIYHelper2.Api.Models;

/// <summary>
/// A stock item the shop tracks (truck stock / warehouse) — part name, quantity
/// on hand, and a reorder threshold so the console can flag low stock. Brand-
/// scoped like everything else.
/// </summary>
public class InventoryItem : IBrandOwned
{
    public int Id { get; set; }
    public string Brand { get; set; } = "diyhelper";

    public string Name { get; set; } = string.Empty;
    public string? Sku { get; set; }

    /// <summary>Current quantity on hand.</summary>
    public int Quantity { get; set; }

    /// <summary>Flag as low when Quantity drops to/below this. 0 = never flag.</summary>
    public int ReorderAt { get; set; }

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}
