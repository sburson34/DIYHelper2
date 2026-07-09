using System.Net.Http.Json;
using System.Text.Json;
using DIYHelper2.Tests.Infrastructure;

namespace DIYHelper2.Tests.Integration;

/// <summary>
/// Phase 5 job costing: the ops summary computes revenue from approved quotes,
/// subtracts owner-entered labor + parts, and reports the margin — the
/// "did we make money?" view. Brand-scoped and admin-gated.
/// </summary>
public class OpsSummaryTests : IClassFixture<ApiFactory>
{
    private readonly ApiFactory _factory;
    public OpsSummaryTests(ApiFactory factory) => _factory = factory;

    [Fact]
    public async Task Summary_ComputesRevenueCostAndMargin()
    {
        await _factory.SeedBrandAsync("ops-co", "Ops Co", "leads@ops.example");
        var device = _factory.CreateClient();
        device.DefaultRequestHeaders.Add("X-Brand", "ops-co");
        device.DefaultRequestHeaders.Add("X-Device-Id", "ops-dev");

        var bookReq = new HttpRequestMessage(HttpMethod.Post, "/api/help-requests")
        {
            Content = JsonContent.Create(new
            {
                customerName = "C", customerEmail = "c@ops.example", customerPhone = "5550002222",
                projectTitle = "Costed job", userDescription = "d", projectData = "{}", imageBase64 = (string?)null,
            }),
        };
        bookReq.Headers.Add("X-Brand", "ops-co");
        bookReq.Headers.Add("X-Device-Id", "ops-dev");
        var jobId = (await (await device.SendAsync(bookReq)).Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetInt32();

        var admin = _factory.CreateAdminClient();
        // Quote $500, approved → revenue 500.
        await admin.PutAsJsonAsync($"/api/help-requests/{jobId}/quote", new
        { lines = new[] { new { description = "Work", amount = 500.0, quantity = 1 } } });
        await device.PutAsJsonAsync($"/api/my/requests/{jobId}/quote", new { decision = "approved" });
        // Labor 120 + parts 80 → cost 200, margin 300.
        await admin.PutAsJsonAsync($"/api/help-requests/{jobId}", new { laborCost = 120.0, partsCost = 80.0 });

        var ops = await admin.GetFromJsonAsync<JsonElement>("/api/ops/summary?brand=ops-co");
        Assert.Equal(500m, ops.GetProperty("revenue").GetDecimal());
        Assert.Equal(200m, ops.GetProperty("cost").GetDecimal());
        Assert.Equal(300m, ops.GetProperty("margin").GetDecimal());
    }

    [Fact]
    public async Task Summary_RequiresAdmin()
    {
        // No Basic auth → the admin gate challenges.
        var resp = await _factory.CreateClient().GetAsync("/api/ops/summary?brand=diyhelper");
        Assert.Equal(System.Net.HttpStatusCode.Unauthorized, resp.StatusCode);
    }
}
