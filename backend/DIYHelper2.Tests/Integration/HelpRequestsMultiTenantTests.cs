using System.Net;
using System.Net.Http.Json;
using DIYHelper2.Tests.Infrastructure;

namespace DIYHelper2.Tests.Integration;

/// <summary>
/// White-label lead routing: a "call a pro" lead is attributed to the brand in
/// the X-Brand header, emailed to that brand's inbox, and visible only to that
/// brand's scoped dashboard login (the super-admin still sees everything).
/// </summary>
public class HelpRequestsMultiTenantTests : IClassFixture<ApiFactory>
{
    private readonly ApiFactory _factory;

    public HelpRequestsMultiTenantTests(ApiFactory factory) => _factory = factory;

    private static HttpRequestMessage PostLead(string brand, string projectTitle, string customerEmail)
    {
        var req = new HttpRequestMessage(HttpMethod.Post, "/api/help-requests")
        {
            Content = JsonContent.Create(new
            {
                customerName = "Cust",
                customerEmail,
                customerPhone = "5550000000",
                projectTitle,
                userDescription = "desc",
                projectData = "{}",
                imageBase64 = (string?)null,
            }),
        };
        req.Headers.Add("X-Brand", brand);
        return req;
    }

    [Fact]
    public async Task Create_TagsBrandFromHeader_AndEmailsThatBrandsInbox()
    {
        await _factory.SeedBrandAsync("acme-a", "Acme A", "leads@acme-a.example");
        _factory.FakeEmail.SentMessages.Clear();

        var client = _factory.CreateClient();
        var resp = await client.SendAsync(PostLead("acme-a", "Faucet", "c1@example.com"));
        Assert.Equal(HttpStatusCode.Created, resp.StatusCode);

        // Emailed to the brand's configured inbox, with the customer's contact.
        Assert.Contains(_factory.FakeEmail.SentMessages,
            m => m.To == "leads@acme-a.example" && m.TextBody.Contains("c1@example.com"));

        // And the persisted lead is tagged with the brand (visible to super-admin).
        var admin = _factory.CreateAdminClient();
        var list = await (await admin.GetAsync("/api/help-requests?brand=acme-a")).Content.ReadAsStringAsync();
        Assert.Contains("c1@example.com", list);
        Assert.Contains("\"brand\":\"acme-a\"", list);
    }

    [Fact]
    public async Task Create_Returns201_EvenWhenEmailThrows()
    {
        await _factory.SeedBrandAsync("acme-fail", "Acme Fail", "leads@fail.example");
        _factory.FakeEmail.OnSend = () => throw new Exception("SES down");
        try
        {
            var client = _factory.CreateClient();
            var resp = await client.SendAsync(PostLead("acme-fail", "X", "c@example.com"));
            Assert.Equal(HttpStatusCode.Created, resp.StatusCode);
        }
        finally
        {
            _factory.FakeEmail.OnSend = null;
        }
    }

    [Fact]
    public async Task BrandLogin_SeesOnlyOwnLeads_AndCannotTouchOthers()
    {
        await _factory.SeedBrandAsync("tenant-a", "Tenant A", "a@example", "tenant-a-admin", "pwA");
        await _factory.SeedBrandAsync("tenant-b", "Tenant B", "b@example", "tenant-b-admin", "pwB");

        var anon = _factory.CreateClient();
        var aResp = await anon.SendAsync(PostLead("tenant-a", "A job", "a-lead@example.com"));
        var bResp = await anon.SendAsync(PostLead("tenant-b", "B job", "b-lead@example.com"));
        var aId = (await aResp.Content.ReadFromJsonAsync<CreatedResponse>())!.id;
        var bId = (await bResp.Content.ReadFromJsonAsync<CreatedResponse>())!.id;

        var aClient = _factory.CreateBrandClient("tenant-a-admin", "pwA");

        // Tenant A's list contains only its own lead.
        var list = await (await aClient.GetAsync("/api/help-requests")).Content.ReadAsStringAsync();
        Assert.Contains("a-lead@example.com", list);
        Assert.DoesNotContain("b-lead@example.com", list);

        // Tenant A cannot read / update / delete Tenant B's lead — 404, not 403.
        Assert.Equal(HttpStatusCode.NotFound, (await aClient.GetAsync($"/api/help-requests/{bId}")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound,
            (await aClient.PutAsJsonAsync($"/api/help-requests/{bId}", new { status = "done" })).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await aClient.DeleteAsync($"/api/help-requests/{bId}")).StatusCode);

        // But it can access its own.
        Assert.Equal(HttpStatusCode.OK, (await aClient.GetAsync($"/api/help-requests/{aId}")).StatusCode);

        // The super-admin sees both tenants' leads.
        var admin = _factory.CreateAdminClient();
        var adminList = await (await admin.GetAsync("/api/help-requests")).Content.ReadAsStringAsync();
        Assert.Contains("a-lead@example.com", adminList);
        Assert.Contains("b-lead@example.com", adminList);
    }

    [Fact]
    public async Task Brands_Endpoint_ScopesToCaller()
    {
        await _factory.SeedBrandAsync("brands-a", "Brands A Co", "a@example", "brands-a-admin", "pw");

        var scoped = await (await _factory.CreateBrandClient("brands-a-admin", "pw")
            .GetAsync("/api/brands")).Content.ReadAsStringAsync();
        Assert.Contains("Brands A Co", scoped);
        Assert.Contains("\"isSuperAdmin\":false", scoped);

        var all = await (await _factory.CreateAdminClient().GetAsync("/api/brands")).Content.ReadAsStringAsync();
        Assert.Contains("\"isSuperAdmin\":true", all);
    }

    [Fact]
    public async Task InactiveBrand_CannotLogin()
    {
        await _factory.SeedBrandAsync("inactive-co", "Inactive", "x@example", "inactive-admin", "pw", isActive: false);
        var resp = await _factory.CreateBrandClient("inactive-admin", "pw").GetAsync("/api/help-requests");
        Assert.Equal(HttpStatusCode.Unauthorized, resp.StatusCode);
    }

    [Fact]
    public async Task AdminSurface_FailsClosed_WithoutCredentials()
    {
        var resp = await _factory.CreateClient().GetAsync("/api/help-requests");
        Assert.Equal(HttpStatusCode.Unauthorized, resp.StatusCode);
    }

    private record CreatedResponse(int id);
}
