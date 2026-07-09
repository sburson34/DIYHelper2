using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text;
using DIYHelper2.Api.Data;
using DIYHelper2.Tests.Infrastructure;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace DIYHelper2.Tests.Integration;

/// <summary>
/// Housecall Pro CRM integration (step 3): a connected brand's leads create a
/// customer then a Job-Inbox lead via REST, with OAuth token refresh, provider
/// precedence, MAX-plan gating surfaced clearly, and the connect/callback flow.
/// Housecall's HTTP is stubbed via <see cref="ApiFactory.FakeHousecallTokenHandler"/>
/// and <see cref="ApiFactory.FakeHousecallApiHandler"/>.
/// </summary>
public class CrmHousecallTests : IClassFixture<ApiFactory>
{
    private readonly ApiFactory _factory;

    public CrmHousecallTests(ApiFactory factory) => _factory = factory;

    private static HttpRequestMessage PostLead(string brand, string projectTitle, string customerEmail)
    {
        var req = new HttpRequestMessage(HttpMethod.Post, "/api/help-requests")
        {
            Content = JsonContent.Create(new
            {
                customerName = "Jane Doe",
                customerEmail,
                customerPhone = "5551234567",
                projectTitle,
                userDescription = "kitchen sink leak",
                projectData = "{}",
                imageBase64 = (string?)null,
            }),
        };
        req.Headers.Add("X-Brand", brand);
        return req;
    }

    // Routes POST /customers → {id}, POST /leads → {id}, by request path.
    private void StubApi(string customerId, string leadId, Action<HttpRequestMessage>? capture = null)
    {
        _factory.FakeHousecallApiHandler.Responder = req =>
        {
            capture?.Invoke(req);
            var path = req.RequestUri?.AbsolutePath ?? "";
            var id = path.EndsWith("/leads") ? leadId : customerId;
            var json = "{\"id\":\"" + id + "\"}";
            return Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK)
            {
                Content = new StringContent(json, Encoding.UTF8, "application/json"),
            });
        };
    }

    private static async Task<string?> CrmRemoteIdOf(ApiFactory factory, int leadId)
    {
        using var scope = factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        return (await db.HelpRequests.FindAsync(leadId))?.CrmRemoteId;
    }

    private record CreatedResponse(int id);

    [Fact]
    public async Task Create_CreatesCustomerThenLead_AndStoresLeadIdAsRemoteId()
    {
        await _factory.SeedBrandAsync("hcp-basic", "HCP Basic", "leads@hcp.example");
        await _factory.SeedHousecallConnectionAsync("hcp-basic");

        var paths = new List<string>();
        StubApi("cus_1", "lead_9", req => paths.Add(req.RequestUri!.AbsolutePath));

        var resp = await _factory.CreateClient().SendAsync(PostLead("hcp-basic", "Sink fix", "cust@example.com"));
        Assert.Equal(HttpStatusCode.Created, resp.StatusCode);

        // Both endpoints hit, customer before lead.
        Assert.Equal(new[] { "/customers", "/leads" }, paths);

        var id = (await resp.Content.ReadFromJsonAsync<CreatedResponse>())!.id;
        Assert.Equal("lead_9", await CrmRemoteIdOf(_factory, id));   // lead id preferred
    }

    [Fact]
    public async Task Create_Returns201_AndSurfacesMaxPlan_When403()
    {
        await _factory.SeedBrandAsync("hcp-maxplan", "No Max Co", "leads@nm.example");
        await _factory.SeedHousecallConnectionAsync("hcp-maxplan");
        // Housecall refuses the customer create because the account isn't on MAX.
        _factory.FakeHousecallApiHandler.Responder = _ =>
            Task.FromResult(new HttpResponseMessage(HttpStatusCode.Forbidden));

        var resp = await _factory.CreateClient().SendAsync(PostLead("hcp-maxplan", "X", "c@example.com"));
        Assert.Equal(HttpStatusCode.Created, resp.StatusCode);       // best-effort: submit still succeeds

        var id = (await resp.Content.ReadFromJsonAsync<CreatedResponse>())!.id;
        Assert.Null(await CrmRemoteIdOf(_factory, id));              // nothing landed
    }

    [Fact]
    public async Task HousecallConnection_TakesPrecedenceOverWebhook()
    {
        await _factory.SeedBrandAsync(
            "hcp-precedence", "Both Co", "leads@both.example",
            leadWebhookUrl: "https://example.com/hooks/should-not-fire");
        await _factory.SeedHousecallConnectionAsync("hcp-precedence");

        var webhookCalled = false;
        _factory.FakeCrmWebhookHandler.Responder = _ =>
        {
            webhookCalled = true;
            return Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK));
        };
        var hcpCalled = false;
        StubApi("cus_1", "lead_1", _ => hcpCalled = true);

        var resp = await _factory.CreateClient().SendAsync(PostLead("hcp-precedence", "X", "c@example.com"));
        Assert.Equal(HttpStatusCode.Created, resp.StatusCode);

        Assert.True(hcpCalled, "Housecall should be used when a connection exists");
        Assert.False(webhookCalled, "webhook must not fire when a native connection wins");
    }

    [Fact]
    public async Task RefreshesAccessToken_WhenExpired_AndUsesFreshTokenForApi()
    {
        await _factory.SeedBrandAsync("hcp-refresh", "Refresh Co", "leads@rf.example");
        await _factory.SeedHousecallConnectionAsync("hcp-refresh", accessToken: "stale", refreshToken: "rt",
            expiresAt: DateTime.UtcNow.AddMinutes(-5));

        var tokenCalled = false;
        _factory.FakeHousecallTokenHandler.Responder = _ =>
        {
            tokenCalled = true;
            const string json = """{"access_token":"fresh-access","refresh_token":"rotated","expires_in":2592000}""";
            return Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK)
            {
                Content = new StringContent(json, Encoding.UTF8, "application/json"),
            });
        };

        string? sentAuth = null;
        StubApi("cus_1", "lead_1", req => sentAuth ??= req.Headers.Authorization?.ToString());

        var resp = await _factory.CreateClient().SendAsync(PostLead("hcp-refresh", "X", "c@example.com"));
        Assert.Equal(HttpStatusCode.Created, resp.StatusCode);

        Assert.True(tokenCalled, "an expired access token must trigger a refresh");
        Assert.Equal("Bearer fresh-access", sentAuth);
    }

    // ── OAuth connect/callback ──────────────────────────────────────────

    private HttpClient AdminNoRedirect()
    {
        var client = _factory.CreateClient(new WebApplicationFactoryClientOptions { AllowAutoRedirect = false });
        var b64 = Convert.ToBase64String(Encoding.UTF8.GetBytes($"{ApiFactory.AdminUsername}:{ApiFactory.AdminPassword}"));
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Basic", b64);
        return client;
    }

    private static string QueryParam(string url, string key)
    {
        foreach (var pair in new Uri(url).Query.TrimStart('?').Split('&'))
        {
            var kv = pair.Split('=', 2);
            if (kv[0] == key) return Uri.UnescapeDataString(kv.Length > 1 ? kv[1] : "");
        }
        return "";
    }

    [Fact]
    public async Task Connect_RedirectsToHousecall_ThenCallback_CreatesConnection()
    {
        await _factory.SeedBrandAsync("hcp-oauth", "OAuth Co", "leads@oauth.example");

        var connect = await AdminNoRedirect().GetAsync("/api/crm/housecall/connect?brand=hcp-oauth");
        Assert.Equal(HttpStatusCode.Redirect, connect.StatusCode);
        var location = connect.Headers.Location!.ToString();
        Assert.StartsWith("https://pro.housecallpro.com/oauth/authorize", location);
        var state = QueryParam(location, "state");
        Assert.NotEqual("", state);

        _factory.FakeHousecallTokenHandler.Responder = _ =>
        {
            const string json = """{"access_token":"cb-access","refresh_token":"cb-refresh","expires_in":2592000}""";
            return Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK)
            {
                Content = new StringContent(json, Encoding.UTF8, "application/json"),
            });
        };

        var callback = await _factory.CreateClient()
            .GetAsync($"/api/crm/housecall/callback?code=the-code&state={Uri.EscapeDataString(state)}");
        Assert.Equal(HttpStatusCode.OK, callback.StatusCode);

        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var conn = await db.BrandCrmConnections.FirstOrDefaultAsync(c => c.BrandSlug == "hcp-oauth");
        Assert.NotNull(conn);
        Assert.True(conn!.IsActive);
        Assert.Equal((int)DIYHelper2.Api.Integrations.Crm.CrmProvider.HousecallPro, conn.Provider);
        Assert.NotNull(conn.AccessTokenEnc);
        Assert.NotNull(conn.RefreshTokenEnc);
    }

    [Fact]
    public async Task Connect_RequiresAdmin()
    {
        var anon = _factory.CreateClient(new WebApplicationFactoryClientOptions { AllowAutoRedirect = false });
        var resp = await anon.GetAsync("/api/crm/housecall/connect?brand=whatever");
        Assert.Equal(HttpStatusCode.Unauthorized, resp.StatusCode);
    }
}
