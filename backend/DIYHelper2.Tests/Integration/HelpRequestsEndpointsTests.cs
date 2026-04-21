using System.Net;
using System.Net.Http.Json;
using DIYHelper2.Tests.Infrastructure;

namespace DIYHelper2.Tests.Integration;

/// <summary>
/// Exercises the CRUD loop for /api/help-requests against a real EF Core +
/// SQLite pipeline. Covers the "customer requests a pro" flow end-to-end on
/// the backend side — create, list, get-by-id, update (status change),
/// filter-by-status, and delete.
/// </summary>
public class HelpRequestsEndpointsTests : IClassFixture<ApiFactory>
{
    private readonly ApiFactory _factory;

    public HelpRequestsEndpointsTests(ApiFactory factory) => _factory = factory;

    [Fact]
    public async Task FullCrudLifecycle_Works()
    {
        var client = _factory.CreateClient();

        // CREATE
        var createPayload = new
        {
            customerName = "Alice",
            customerEmail = "alice@example.com",
            customerPhone = "5551112222",
            projectTitle = "Leaky faucet",
            userDescription = "Drip from under sink.",
            projectData = "{}",
            imageBase64 = (string?)null,
        };
        var createResp = await client.PostAsJsonAsync("/api/help-requests", createPayload);
        Assert.Equal(HttpStatusCode.Created, createResp.StatusCode);

        var created = await createResp.Content.ReadFromJsonAsync<CreatedResponse>();
        Assert.NotNull(created);
        var id = created!.id;
        Assert.True(id > 0);

        // GET by id
        var getResp = await client.GetAsync($"/api/help-requests/{id}");
        Assert.Equal(HttpStatusCode.OK, getResp.StatusCode);
        var fetched = await getResp.Content.ReadAsStringAsync();
        Assert.Contains("\"customerName\":\"Alice\"", fetched);
        Assert.Contains("\"status\":\"new\"", fetched);

        // LIST
        var listResp = await client.GetAsync("/api/help-requests");
        Assert.Equal(HttpStatusCode.OK, listResp.StatusCode);
        var list = await listResp.Content.ReadAsStringAsync();
        Assert.Contains("alice@example.com", list);

        // UPDATE — move to 'contacted' with a note
        var updatePayload = new { status = "contacted", notes = "Called back." };
        var updateResp = await client.PutAsJsonAsync($"/api/help-requests/{id}", updatePayload);
        Assert.Equal(HttpStatusCode.OK, updateResp.StatusCode);
        var updated = await updateResp.Content.ReadAsStringAsync();
        Assert.Contains("\"status\":\"contacted\"", updated);
        Assert.Contains("\"notes\":\"Called back.\"", updated);

        // FILTER
        var filteredResp = await client.GetAsync("/api/help-requests?status=contacted");
        Assert.Equal(HttpStatusCode.OK, filteredResp.StatusCode);
        var filtered = await filteredResp.Content.ReadAsStringAsync();
        Assert.Contains("alice@example.com", filtered);

        var emptyFilterResp = await client.GetAsync("/api/help-requests?status=new");
        var emptyFilter = await emptyFilterResp.Content.ReadAsStringAsync();
        Assert.DoesNotContain("alice@example.com", emptyFilter);

        // DELETE
        var deleteResp = await client.DeleteAsync($"/api/help-requests/{id}");
        Assert.Equal(HttpStatusCode.NoContent, deleteResp.StatusCode);

        var missingResp = await client.GetAsync($"/api/help-requests/{id}");
        Assert.Equal(HttpStatusCode.NotFound, missingResp.StatusCode);
    }

    [Fact]
    public async Task Get_Returns404_ForUnknownId()
    {
        var client = _factory.CreateClient();
        var resp = await client.GetAsync("/api/help-requests/999999");
        Assert.Equal(HttpStatusCode.NotFound, resp.StatusCode);
    }

    [Fact]
    public async Task Update_Returns404_ForUnknownId()
    {
        var client = _factory.CreateClient();
        var resp = await client.PutAsJsonAsync("/api/help-requests/999999", new { status = "contacted" });
        Assert.Equal(HttpStatusCode.NotFound, resp.StatusCode);
    }

    private record CreatedResponse(int id);
}
