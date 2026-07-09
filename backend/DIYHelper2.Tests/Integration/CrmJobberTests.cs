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
/// Jobber CRM integration (step 2): a connected brand's leads push into Jobber
/// via GraphQL clientCreate, with OAuth token refresh, provider precedence over
/// the generic webhook, and the OAuth connect/callback flow. Jobber's HTTP
/// endpoints are stubbed via <see cref="ApiFactory.FakeJobberTokenHandler"/> and
/// <see cref="ApiFactory.FakeJobberGraphQlHandler"/>.
/// </summary>
public class CrmJobberTests : IClassFixture<ApiFactory>
{
    private readonly ApiFactory _factory;

    public CrmJobberTests(ApiFactory factory) => _factory = factory;

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

    private void StubClientCreate(string clientId, Action<HttpRequestMessage>? capture = null)
    {
        _factory.FakeJobberGraphQlHandler.Responder = req =>
        {
            capture?.Invoke(req);
            var json = "{\"data\":{\"clientCreate\":{\"client\":{\"id\":\"" + clientId + "\"},\"userErrors\":[]}}}";
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
    public async Task Create_PushesLeadToJobber_AndStoresRemoteId()
    {
        await _factory.SeedBrandAsync("jb-basic", "Jobber Basic", "leads@jb.example");
        await _factory.SeedJobberConnectionAsync("jb-basic");
        StubClientCreate("gid://Jobber/Client/999");

        var resp = await _factory.CreateClient().SendAsync(PostLead("jb-basic", "Sink fix", "cust@example.com"));
        Assert.Equal(HttpStatusCode.Created, resp.StatusCode);

        var id = (await resp.Content.ReadFromJsonAsync<CreatedResponse>())!.id;
        Assert.Equal("gid://Jobber/Client/999", await CrmRemoteIdOf(_factory, id));
    }

    [Fact]
    public async Task JobberConnection_TakesPrecedenceOverWebhook()
    {
        await _factory.SeedBrandAsync(
            "jb-precedence", "Both Co", "leads@both.example",
            leadWebhookUrl: "https://example.com/hooks/should-not-fire");
        await _factory.SeedJobberConnectionAsync("jb-precedence");

        var webhookCalled = false;
        _factory.FakeCrmWebhookHandler.Responder = _ =>
        {
            webhookCalled = true;
            return Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK));
        };
        var jobberCalled = false;
        StubClientCreate("gid://Jobber/Client/1", _ => jobberCalled = true);

        var resp = await _factory.CreateClient().SendAsync(PostLead("jb-precedence", "X", "c@example.com"));
        Assert.Equal(HttpStatusCode.Created, resp.StatusCode);

        Assert.True(jobberCalled, "Jobber should be used when a connection exists");
        Assert.False(webhookCalled, "webhook must not fire when a native connection wins");
    }

    [Fact]
    public async Task Create_Returns201_AndNoRemoteId_WhenJobberUserErrors()
    {
        await _factory.SeedBrandAsync("jb-usererr", "UserErr Co", "leads@ue.example");
        await _factory.SeedJobberConnectionAsync("jb-usererr");
        _factory.FakeJobberGraphQlHandler.Responder = _ =>
        {
            const string json = """{"data":{"clientCreate":{"client":null,"userErrors":[{"message":"Email is invalid","path":["input","emails"]}]}}}""";
            return Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK)
            {
                Content = new StringContent(json, Encoding.UTF8, "application/json"),
            });
        };

        var resp = await _factory.CreateClient().SendAsync(PostLead("jb-usererr", "X", "bad-email"));
        Assert.Equal(HttpStatusCode.Created, resp.StatusCode);   // best-effort: submit still succeeds

        var id = (await resp.Content.ReadFromJsonAsync<CreatedResponse>())!.id;
        Assert.Null(await CrmRemoteIdOf(_factory, id));
    }

    [Fact]
    public async Task RefreshesAccessToken_WhenExpired_AndUsesFreshTokenForGraphQl()
    {
        await _factory.SeedBrandAsync("jb-refresh", "Refresh Co", "leads@rf.example");
        // Access token already expired → the sink must refresh before calling GraphQL.
        await _factory.SeedJobberConnectionAsync("jb-refresh", accessToken: "stale", refreshToken: "rt",
            expiresAt: DateTime.UtcNow.AddMinutes(-5));

        var tokenEndpointCalled = false;
        _factory.FakeJobberTokenHandler.Responder = _ =>
        {
            tokenEndpointCalled = true;
            const string json = """{"access_token":"fresh-access","refresh_token":"rotated-refresh","expires_in":3600}""";
            return Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK)
            {
                Content = new StringContent(json, Encoding.UTF8, "application/json"),
            });
        };

        string? sentAuth = null;
        StubClientCreate("gid://Jobber/Client/77", req => sentAuth = req.Headers.Authorization?.ToString());

        var resp = await _factory.CreateClient().SendAsync(PostLead("jb-refresh", "X", "c@example.com"));
        Assert.Equal(HttpStatusCode.Created, resp.StatusCode);

        Assert.True(tokenEndpointCalled, "an expired access token must trigger a refresh");
        Assert.Equal("bearer fresh-access", sentAuth);   // GraphQL used the refreshed token
    }

    // ── OAuth connect/callback flow ─────────────────────────────────────

    private HttpClient AdminNoRedirect()
    {
        var client = _factory.CreateClient(new WebApplicationFactoryClientOptions { AllowAutoRedirect = false });
        var b64 = Convert.ToBase64String(Encoding.UTF8.GetBytes($"{ApiFactory.AdminUsername}:{ApiFactory.AdminPassword}"));
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Basic", b64);
        return client;
    }

    private static string QueryParam(string url, string key)
    {
        var q = new Uri(url).Query.TrimStart('?');
        foreach (var pair in q.Split('&'))
        {
            var kv = pair.Split('=', 2);
            if (kv[0] == key) return Uri.UnescapeDataString(kv.Length > 1 ? kv[1] : "");
        }
        return "";
    }

    [Fact]
    public async Task Connect_RequiresAdmin()
    {
        var anon = _factory.CreateClient(new WebApplicationFactoryClientOptions { AllowAutoRedirect = false });
        var resp = await anon.GetAsync("/api/crm/jobber/connect?brand=whatever");
        Assert.Equal(HttpStatusCode.Unauthorized, resp.StatusCode);
    }

    [Fact]
    public async Task Connect_RedirectsToJobber_ThenCallback_CreatesConnection()
    {
        await _factory.SeedBrandAsync("jb-oauth", "OAuth Co", "leads@oauth.example");

        // 1) connect → 302 to Jobber authorize URL carrying our signed state.
        var connect = await AdminNoRedirect().GetAsync("/api/crm/jobber/connect?brand=jb-oauth");
        Assert.Equal(HttpStatusCode.Redirect, connect.StatusCode);
        var location = connect.Headers.Location!.ToString();
        Assert.StartsWith("https://api.getjobber.com/api/oauth/authorize", location);
        var state = QueryParam(location, "state");
        Assert.NotEqual("", state);

        // 2) Jobber redirects the browser back to /callback with code + our state.
        _factory.FakeJobberTokenHandler.Responder = _ =>
        {
            const string json = """{"access_token":"cb-access","refresh_token":"cb-refresh","expires_in":3600}""";
            return Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK)
            {
                Content = new StringContent(json, Encoding.UTF8, "application/json"),
            });
        };

        var callback = await _factory.CreateClient()
            .GetAsync($"/api/crm/jobber/callback?code=the-code&state={Uri.EscapeDataString(state)}");
        Assert.Equal(HttpStatusCode.OK, callback.StatusCode);

        // The connection is now persisted, active, and Jobber-typed with tokens.
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var conn = await db.BrandCrmConnections.FirstOrDefaultAsync(c => c.BrandSlug == "jb-oauth");
        Assert.NotNull(conn);
        Assert.True(conn!.IsActive);
        Assert.Equal((int)DIYHelper2.Api.Integrations.Crm.CrmProvider.Jobber, conn.Provider);
        Assert.NotNull(conn.AccessTokenEnc);
        Assert.NotNull(conn.RefreshTokenEnc);
    }

    [Fact]
    public async Task Callback_RejectsInvalidState()
    {
        var resp = await _factory.CreateClient()
            .GetAsync("/api/crm/jobber/callback?code=x&state=not-a-valid-state");
        Assert.Equal(HttpStatusCode.BadRequest, resp.StatusCode);
    }
}
