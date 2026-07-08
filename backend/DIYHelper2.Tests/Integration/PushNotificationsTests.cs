using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using DIYHelper2.Tests.Infrastructure;

namespace DIYHelper2.Tests.Integration;

/// <summary>
/// Per-brand promotional push: a device registers its Expo token (attributed to
/// the X-Brand header), a brand's dashboard broadcasts only to its own opted-in
/// devices, and campaign history / audience counts are tenant-scoped. Expo is
/// stubbed via <see cref="ApiFactory.FakeExpoHandler"/> so nothing hits exp.host.
/// </summary>
public class PushNotificationsTests : IClassFixture<ApiFactory>
{
    private readonly ApiFactory _factory;

    public PushNotificationsTests(ApiFactory factory)
    {
        _factory = factory;
        SetExpoOkResponder();
    }

    // Returns one "ok" ticket per message in the /push/send body; empty data for
    // /push/getReceipts. Also records each send's message count for assertions.
    private void SetExpoOkResponder()
    {
        _factory.FakeExpoHandler.Requests.Clear();
        _factory.FakeExpoHandler.Responder = async req =>
        {
            var path = req.RequestUri?.AbsolutePath ?? "";
            if (path.Contains("getReceipts"))
                return Json("{\"data\":{}}");

            var body = req.Content is null ? "[]" : await req.Content.ReadAsStringAsync();
            using var doc = JsonDocument.Parse(body);
            var count = doc.RootElement.GetArrayLength();
            var tickets = string.Join(",",
                Enumerable.Range(0, count).Select(i => $"{{\"status\":\"ok\",\"id\":\"tkt-{Guid.NewGuid():N}\"}}"));
            return Json($"{{\"data\":[{tickets}]}}");
        };
    }

    private static HttpResponseMessage Json(string body) =>
        new(HttpStatusCode.OK) { Content = new StringContent(body, System.Text.Encoding.UTF8, "application/json") };

    private static string NewToken() => $"ExponentPushToken[{Guid.NewGuid():N}]";

    private async Task RegisterAsync(string brand, string token, string platform = "ios", bool optIn = true)
    {
        var req = new HttpRequestMessage(HttpMethod.Post, "/api/push/register")
        {
            Content = JsonContent.Create(new { token, platform, marketingOptIn = optIn }),
        };
        req.Headers.Add("X-Brand", brand);
        var resp = await _factory.CreateClient().SendAsync(req);
        Assert.Equal(HttpStatusCode.Created, resp.StatusCode);
    }

    [Fact]
    public async Task Register_TagsBrandFromHeader_AndUpsertsByToken()
    {
        var token = NewToken();
        await RegisterAsync("push-a", token, "ios", optIn: true);
        // Re-register the SAME token opting out — must upsert, not duplicate.
        await RegisterAsync("push-a", token, "ios", optIn: false);

        await _factory.SeedBrandAsync("push-a", "Push A", "a@example", "push-a-admin", "pw");
        var admin = _factory.CreateBrandClient("push-a-admin", "pw");
        var aud = await (await admin.GetAsync("/api/push/audience")).Content.ReadAsStringAsync();
        // Opted out on the second register → audience is zero (one row, not two).
        Assert.Contains("\"total\":0", aud.Replace(" ", ""));
    }

    [Fact]
    public async Task Send_OnlyTargetsOwnBrandsOptedInDevices()
    {
        await _factory.SeedBrandAsync("send-a", "Send A", "a@example", "send-a-admin", "pw");
        await _factory.SeedBrandAsync("send-b", "Send B", "b@example", "send-b-admin", "pw");

        await _factory.SeedPushTokenAsync("send-a", "ios", marketingOptIn: true);
        await _factory.SeedPushTokenAsync("send-a", "android", marketingOptIn: true);
        await _factory.SeedPushTokenAsync("send-a", "ios", marketingOptIn: false);   // opted out → excluded
        await _factory.SeedPushTokenAsync("send-b", "ios", marketingOptIn: true);    // other brand → excluded

        _factory.FakeExpoHandler.Requests.Clear();
        var admin = _factory.CreateBrandClient("send-a-admin", "pw");
        var resp = await admin.PostAsJsonAsync("/api/push/send", new
        {
            title = "Summer decks!",
            body = "Great time to build outside — contact us.",
        });
        Assert.Equal(HttpStatusCode.OK, resp.StatusCode);

        var json = JsonDocument.Parse(await resp.Content.ReadAsStringAsync()).RootElement;
        Assert.Equal("sent", json.GetProperty("status").GetString());
        Assert.Equal(2, json.GetProperty("recipientCount").GetInt32());   // only send-a opted-in

        // Exactly two messages went to Expo, both for send-a's tokens.
        Assert.Single(_factory.FakeExpoHandler.Requests);
    }

    [Fact]
    public async Task Send_RespectsPlatformFilter()
    {
        await _factory.SeedBrandAsync("plat-a", "Plat A", "a@example", "plat-a-admin", "pw");
        await _factory.SeedPushTokenAsync("plat-a", "ios", marketingOptIn: true);
        await _factory.SeedPushTokenAsync("plat-a", "android", marketingOptIn: true);
        await _factory.SeedPushTokenAsync("plat-a", "android", marketingOptIn: true);

        var admin = _factory.CreateBrandClient("plat-a-admin", "pw");
        var resp = await admin.PostAsJsonAsync("/api/push/send", new
        {
            title = "Android only", body = "hi", platform = "android",
        });
        var json = JsonDocument.Parse(await resp.Content.ReadAsStringAsync()).RootElement;
        Assert.Equal(2, json.GetProperty("recipientCount").GetInt32());
    }

    [Fact]
    public async Task Send_ScheduledInFuture_IsNotDispatchedImmediately()
    {
        await _factory.SeedBrandAsync("sched-a", "Sched A", "a@example", "sched-a-admin", "pw");
        await _factory.SeedPushTokenAsync("sched-a", "ios", marketingOptIn: true);

        _factory.FakeExpoHandler.Requests.Clear();
        var admin = _factory.CreateBrandClient("sched-a-admin", "pw");
        var resp = await admin.PostAsJsonAsync("/api/push/send", new
        {
            title = "Later", body = "scheduled",
            scheduledFor = DateTime.UtcNow.AddDays(1),
        });
        var json = JsonDocument.Parse(await resp.Content.ReadAsStringAsync()).RootElement;
        Assert.Equal("scheduled", json.GetProperty("status").GetString());
        Assert.Empty(_factory.FakeExpoHandler.Requests);   // nothing sent yet
    }

    [Fact]
    public async Task Audience_And_Campaigns_AreBrandScoped()
    {
        await _factory.SeedBrandAsync("scope-a", "Scope A", "a@example", "scope-a-admin", "pw");
        await _factory.SeedBrandAsync("scope-b", "Scope B", "b@example", "scope-b-admin", "pw");
        await _factory.SeedPushTokenAsync("scope-a", "ios", marketingOptIn: true);
        await _factory.SeedPushTokenAsync("scope-b", "ios", marketingOptIn: true);

        var aClient = _factory.CreateBrandClient("scope-a-admin", "pw");
        var bClient = _factory.CreateBrandClient("scope-b-admin", "pw");

        // A sends a campaign; B must never see it.
        var sendResp = await aClient.PostAsJsonAsync("/api/push/send", new { title = "A promo", body = "b" });
        var campaignId = JsonDocument.Parse(await sendResp.Content.ReadAsStringAsync()).RootElement.GetProperty("id").GetInt32();

        var aList = await (await aClient.GetAsync("/api/push/campaigns")).Content.ReadAsStringAsync();
        Assert.Contains("A promo", aList);
        var bList = await (await bClient.GetAsync("/api/push/campaigns")).Content.ReadAsStringAsync();
        Assert.DoesNotContain("A promo", bList);

        // B cannot read A's campaign by id — 404, not 403.
        Assert.Equal(HttpStatusCode.NotFound, (await bClient.GetAsync($"/api/push/campaigns/{campaignId}")).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await aClient.GetAsync($"/api/push/campaigns/{campaignId}")).StatusCode);

        // Audience is scoped to the caller's own brand.
        var aAud = await (await aClient.GetAsync("/api/push/audience")).Content.ReadAsStringAsync();
        Assert.Contains("\"total\":1", aAud.Replace(" ", ""));
    }

    [Fact]
    public async Task TestSend_HitsSingleToken()
    {
        await _factory.SeedBrandAsync("test-a", "Test A", "a@example", "test-a-admin", "pw");
        _factory.FakeExpoHandler.Requests.Clear();

        var admin = _factory.CreateBrandClient("test-a-admin", "pw");
        var resp = await admin.PostAsJsonAsync("/api/push/test", new
        {
            token = NewToken(), title = "Preview", body = "test push",
        });
        Assert.Equal(HttpStatusCode.OK, resp.StatusCode);
        Assert.Contains("\"ok\":true", (await resp.Content.ReadAsStringAsync()).Replace(" ", ""));
        Assert.Single(_factory.FakeExpoHandler.Requests);
    }

    [Fact]
    public async Task TestSend_RejectsBadToken()
    {
        await _factory.SeedBrandAsync("bad-a", "Bad A", "a@example", "bad-a-admin", "pw");
        var admin = _factory.CreateBrandClient("bad-a-admin", "pw");
        var resp = await admin.PostAsJsonAsync("/api/push/test", new { token = "not-a-token", title = "x", body = "y" });
        Assert.Equal(HttpStatusCode.BadRequest, resp.StatusCode);
    }

    [Fact]
    public async Task AdminPushSurface_FailsClosed_WithoutCredentials()
    {
        var anon = _factory.CreateClient();
        Assert.Equal(HttpStatusCode.Unauthorized, (await anon.GetAsync("/api/push/audience")).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await anon.GetAsync("/api/push/campaigns")).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized,
            (await anon.PostAsJsonAsync("/api/push/send", new { title = "x", body = "y" })).StatusCode);
    }

    [Fact]
    public async Task Register_IsPublic_NoAdminAuthRequired()
    {
        // The mobile register path must NOT require Basic Auth (it's gated by
        // X-App-Key like other mobile POSTs).
        await RegisterAsync("public-a", NewToken());
    }

    [Fact]
    public async Task Send_RequiresBrand_ForSuperAdmin()
    {
        // Super-admin with no brand selected cannot send (ambiguous target).
        var admin = _factory.CreateAdminClient();
        var resp = await admin.PostAsJsonAsync("/api/push/send", new { title = "x", body = "y" });
        Assert.Equal(HttpStatusCode.BadRequest, resp.StatusCode);
    }
}
