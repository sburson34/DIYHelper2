using System.Net.Http.Json;
using System.Text.Json;
using DIYHelper2.Tests.Infrastructure;

namespace DIYHelper2.Tests.Integration;

/// <summary>Smart dispatch: suggest-tech returns the least-loaded active tech.</summary>
public class DispatchTests : IClassFixture<ApiFactory>
{
    private readonly ApiFactory _factory;
    public DispatchTests(ApiFactory factory) => _factory = factory;

    private async Task<int> CreateLeadAsync(string brand)
    {
        var req = new HttpRequestMessage(HttpMethod.Post, "/api/help-requests")
        {
            Content = JsonContent.Create(new
            {
                customerName = "C", customerEmail = "c@d.example", customerPhone = "5550001234",
                projectTitle = "Dispatch job", userDescription = "d", projectData = "{}", imageBase64 = (string?)null,
            }),
        };
        req.Headers.Add("X-Brand", brand);
        var resp = await _factory.CreateClient().SendAsync(req);
        return (await resp.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetInt32();
    }

    [Fact]
    public async Task SuggestTech_PicksLeastLoaded()
    {
        await _factory.SeedBrandAsync("disp-co", "Disp Co", "leads@disp.example");
        var admin = _factory.CreateAdminClient();

        var techA = (await (await admin.PostAsJsonAsync("/api/technicians", new { name = "Aaron", brand = "disp-co" }))
            .Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetInt32();
        var techB = (await (await admin.PostAsJsonAsync("/api/technicians", new { name = "Zoe", brand = "disp-co" }))
            .Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetInt32();

        // Load up tech A with an open job.
        var busyJob = await CreateLeadAsync("disp-co");
        await admin.PutAsJsonAsync($"/api/help-requests/{busyJob}", new { assignedTechId = techA, status = "scheduled" });

        // A new job should be suggested to the less-loaded tech B.
        var newJob = await CreateLeadAsync("disp-co");
        var doc = await admin.GetFromJsonAsync<JsonElement>($"/api/help-requests/{newJob}/suggest-tech");
        Assert.Equal(techB, doc.GetProperty("techId").GetInt32());
    }
}
