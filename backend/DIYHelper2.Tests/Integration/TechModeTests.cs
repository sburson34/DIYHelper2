using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using DIYHelper2.Tests.Infrastructure;

namespace DIYHelper2.Tests.Integration;

/// <summary>
/// Phase 2 tech mode: the owner creates a technician (getting a one-time login
/// code), the tech exchanges it for a bearer token, and then sees + updates only
/// the jobs assigned to them. Covers the token gate, assignment scoping, and the
/// cross-tech 404 posture.
/// </summary>
public class TechModeTests : IClassFixture<ApiFactory>
{
    private readonly ApiFactory _factory;

    public TechModeTests(ApiFactory factory) => _factory = factory;

    private async Task<int> CreateLeadAsync(string brand, string title)
    {
        var req = new HttpRequestMessage(HttpMethod.Post, "/api/help-requests")
        {
            Content = JsonContent.Create(new
            {
                customerName = "C", customerEmail = "c@x.example", customerPhone = "5550001111",
                projectTitle = title, userDescription = "d", projectData = "{}", imageBase64 = (string?)null,
            }),
        };
        req.Headers.Add("X-Brand", brand);
        var resp = await _factory.CreateClient().SendAsync(req);
        var body = await resp.Content.ReadFromJsonAsync<JsonElement>();
        return body.GetProperty("id").GetInt32();
    }

    private HttpClient TechClient(string brand, string token)
    {
        var c = _factory.CreateClient();
        c.DefaultRequestHeaders.Add("X-Brand", brand);
        c.DefaultRequestHeaders.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", token);
        return c;
    }

    [Fact]
    public async Task Owner_CreatesTech_TechLogsIn_AndSeesOnlyAssignedJobs()
    {
        await _factory.SeedBrandAsync("tm-co", "TM Co", "leads@tm.example");
        var admin = _factory.CreateAdminClient();

        // Owner creates a technician and gets a one-time login code.
        var created = await (await admin.PostAsJsonAsync("/api/technicians", new { name = "Pat Tech", brand = "tm-co" }))
            .Content.ReadFromJsonAsync<JsonElement>();
        var techId = created.GetProperty("id").GetInt32();
        var code = created.GetProperty("loginCode").GetString()!;
        Assert.False(string.IsNullOrWhiteSpace(code));

        // Two leads; assign only the first to the tech.
        var assigned = await CreateLeadAsync("tm-co", "Assigned job");
        var other = await CreateLeadAsync("tm-co", "Unassigned job");
        var put = await admin.PutAsJsonAsync($"/api/help-requests/{assigned}", new { assignedTechId = techId });
        Assert.Equal(HttpStatusCode.OK, put.StatusCode);

        // Tech logs in with the code (brand from header) → bearer token.
        var loginReq = new HttpRequestMessage(HttpMethod.Post, "/api/tech/login")
        { Content = JsonContent.Create(new { code }) };
        loginReq.Headers.Add("X-Brand", "tm-co");
        var loginResp = await _factory.CreateClient().SendAsync(loginReq);
        Assert.Equal(HttpStatusCode.OK, loginResp.StatusCode);
        var token = (await loginResp.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("token").GetString()!;

        // Tech sees only the assigned job.
        var tech = TechClient("tm-co", token);
        var jobs = await tech.GetFromJsonAsync<JsonElement>("/api/tech/jobs");
        var ids = jobs.EnumerateArray().Select(j => j.GetProperty("id").GetInt32()).ToList();
        Assert.Contains(assigned, ids);
        Assert.DoesNotContain(other, ids);

        // Tech can update their job...
        var upd = await tech.PutAsJsonAsync($"/api/tech/jobs/{assigned}", new { status = "in_progress" });
        Assert.Equal(HttpStatusCode.OK, upd.StatusCode);

        // ...but not one that isn't theirs (404, not 403).
        var forbidden = await tech.GetAsync($"/api/tech/jobs/{other}");
        Assert.Equal(HttpStatusCode.NotFound, forbidden.StatusCode);
    }

    [Fact]
    public async Task TechJobs_Requires_ValidToken()
    {
        var noToken = _factory.CreateClient();
        noToken.DefaultRequestHeaders.Add("X-Brand", "tm-co");
        var resp = await noToken.GetAsync("/api/tech/jobs");
        Assert.Equal(HttpStatusCode.Unauthorized, resp.StatusCode);

        var badToken = TechClient("tm-co", "not.a.token");
        var resp2 = await badToken.GetAsync("/api/tech/jobs");
        Assert.Equal(HttpStatusCode.Unauthorized, resp2.StatusCode);
    }

    [Fact]
    public async Task TechLogin_WithWrongCode_Is401()
    {
        await _factory.SeedBrandAsync("tm-bad", "TM Bad", "leads@tmbad.example");
        var admin = _factory.CreateAdminClient();
        await admin.PostAsJsonAsync("/api/technicians", new { name = "Real Tech", brand = "tm-bad" });

        var req = new HttpRequestMessage(HttpMethod.Post, "/api/tech/login")
        { Content = JsonContent.Create(new { code = "WRONGCODE" }) };
        req.Headers.Add("X-Brand", "tm-bad");
        var resp = await _factory.CreateClient().SendAsync(req);
        Assert.Equal(HttpStatusCode.Unauthorized, resp.StatusCode);
    }

    [Fact]
    public async Task Technicians_List_IsBrandScopedForAdmin()
    {
        await _factory.SeedBrandAsync("tm-a", "A", "a@x.example");
        await _factory.SeedBrandAsync("tm-b", "B", "b@x.example");
        var admin = _factory.CreateAdminClient();
        await admin.PostAsJsonAsync("/api/technicians", new { name = "Alice", brand = "tm-a" });
        await admin.PostAsJsonAsync("/api/technicians", new { name = "Bob", brand = "tm-b" });

        var listA = await admin.GetFromJsonAsync<JsonElement>("/api/technicians?brand=tm-a");
        var namesA = listA.EnumerateArray().Select(t => t.GetProperty("name").GetString()).ToList();
        Assert.Contains("Alice", namesA);
        Assert.DoesNotContain("Bob", namesA);
    }
}
