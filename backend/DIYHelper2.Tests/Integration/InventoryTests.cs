using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using DIYHelper2.Tests.Infrastructure;

namespace DIYHelper2.Tests.Integration;

/// <summary>Inventory CRUD + the low-stock flag, brand-scoped and admin-gated.</summary>
public class InventoryTests : IClassFixture<ApiFactory>
{
    private readonly ApiFactory _factory;
    public InventoryTests(ApiFactory factory) => _factory = factory;

    [Fact]
    public async Task Create_List_FlagsLowStock()
    {
        await _factory.SeedBrandAsync("inv-co", "Inv Co", "leads@inv.example");
        var admin = _factory.CreateAdminClient();

        // Qty 2, reorder at 3 → should flag low.
        await admin.PostAsJsonAsync("/api/inventory", new { name = "Wax rings", quantity = 2, reorderAt = 3, brand = "inv-co" });
        // Qty 50, reorder at 5 → not low.
        await admin.PostAsJsonAsync("/api/inventory", new { name = "Teflon tape", quantity = 50, reorderAt = 5, brand = "inv-co" });

        var list = await admin.GetFromJsonAsync<JsonElement>("/api/inventory?brand=inv-co");
        var wax = list.EnumerateArray().First(i => i.GetProperty("name").GetString() == "Wax rings");
        var tape = list.EnumerateArray().First(i => i.GetProperty("name").GetString() == "Teflon tape");
        Assert.True(wax.GetProperty("low").GetBoolean());
        Assert.False(tape.GetProperty("low").GetBoolean());
    }

    [Fact]
    public async Task Inventory_RequiresAdmin()
    {
        var resp = await _factory.CreateClient().GetAsync("/api/inventory?brand=diyhelper");
        Assert.Equal(HttpStatusCode.Unauthorized, resp.StatusCode);
    }
}
