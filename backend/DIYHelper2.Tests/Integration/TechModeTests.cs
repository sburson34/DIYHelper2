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

/// <summary>
/// Variant of <see cref="ApiFactory"/> that sets the TWILIO_* env vars before
/// the host is built so <c>TwilioOptions.IsConfigured</c> is true and the
/// automated customer texts actually fire (into <c>FakeTwilioHandler</c> — the
/// primary handler is stubbed, so nothing reaches the network). Restores the
/// previous values on dispose (same pattern as <see cref="AppKeyApiFactory"/>).
/// </summary>
public class SmsConfiguredApiFactory : ApiFactory
{
    private readonly string? _prevSid;
    private readonly string? _prevToken;
    private readonly string? _prevFrom;

    public SmsConfiguredApiFactory()
    {
        _prevSid = Environment.GetEnvironmentVariable("TWILIO_ACCOUNT_SID");
        _prevToken = Environment.GetEnvironmentVariable("TWILIO_AUTH_TOKEN");
        _prevFrom = Environment.GetEnvironmentVariable("TWILIO_FROM_NUMBER");
        Environment.SetEnvironmentVariable("TWILIO_ACCOUNT_SID", "ACtest");
        Environment.SetEnvironmentVariable("TWILIO_AUTH_TOKEN", "test-token");
        Environment.SetEnvironmentVariable("TWILIO_FROM_NUMBER", "+15550009999");
    }

    public new async Task DisposeAsync()
    {
        Environment.SetEnvironmentVariable("TWILIO_ACCOUNT_SID", _prevSid);
        Environment.SetEnvironmentVariable("TWILIO_AUTH_TOKEN", _prevToken);
        Environment.SetEnvironmentVariable("TWILIO_FROM_NUMBER", _prevFrom);
        await base.DisposeAsync();
    }
}

/// <summary>
/// A tech moving a job to on_the_way now fires the same customer text the
/// owner PUT always sent (deliberate A2 behavior alignment: the shared
/// <c>HelpRequestWriteService.HandleTransitionAsync</c> runs for both paths).
/// Asserts via the SmsMessages log the way <see cref="SmsTests"/> does.
/// </summary>
[Collection("SerialEnv")]
public class TechSmsTransitionTests : IClassFixture<SmsConfiguredApiFactory>
{
    private readonly SmsConfiguredApiFactory _factory;

    public TechSmsTransitionTests(SmsConfiguredApiFactory factory) => _factory = factory;

    [Fact]
    public async Task TechPut_OnTheWay_RecordsCustomerSmsAttempt()
    {
        // Twilio's send endpoint answers success so the attempt logs Sent=true.
        _factory.FakeTwilioHandler.Responder = _ => Task.FromResult(new HttpResponseMessage(System.Net.HttpStatusCode.OK)
        {
            Content = new StringContent("{\"sid\":\"SM_test\"}", System.Text.Encoding.UTF8, "application/json"),
        });

        await _factory.SeedBrandAsync("tm-sms", "TM SMS Co", "leads@tmsms.example");
        var admin = _factory.CreateAdminClient();

        // Owner creates a tech and assigns them a booked job.
        var created = await (await admin.PostAsJsonAsync("/api/technicians", new { name = "Sms Tech", brand = "tm-sms" }))
            .Content.ReadFromJsonAsync<JsonElement>();
        var techId = created.GetProperty("id").GetInt32();
        var code = created.GetProperty("loginCode").GetString()!;

        var bookReq = new HttpRequestMessage(HttpMethod.Post, "/api/help-requests")
        {
            Content = JsonContent.Create(new
            {
                customerName = "C", customerEmail = "c@x.example", customerPhone = "+15550001111",
                projectTitle = "SMS transition job", userDescription = "d", projectData = "{}", imageBase64 = (string?)null,
            }),
        };
        bookReq.Headers.Add("X-Brand", "tm-sms");
        var bookResp = await _factory.CreateClient().SendAsync(bookReq);
        var jobId = (await bookResp.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetInt32();

        // Assignment alone is not a status transition — must not text anyone.
        var assign = await admin.PutAsJsonAsync($"/api/help-requests/{jobId}", new { assignedTechId = techId });
        Assert.Equal(HttpStatusCode.OK, assign.StatusCode);

        // Tech logs in and flips the job to on_the_way.
        var loginReq = new HttpRequestMessage(HttpMethod.Post, "/api/tech/login")
        { Content = JsonContent.Create(new { code }) };
        loginReq.Headers.Add("X-Brand", "tm-sms");
        var loginResp = await _factory.CreateClient().SendAsync(loginReq);
        var token = (await loginResp.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("token").GetString()!;

        var tech = _factory.CreateClient();
        tech.DefaultRequestHeaders.Add("X-Brand", "tm-sms");
        tech.DefaultRequestHeaders.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", token);
        var upd = await tech.PutAsJsonAsync($"/api/tech/jobs/{jobId}", new { status = "on_the_way", techEtaMinutes = 20 });
        Assert.Equal(HttpStatusCode.OK, upd.StatusCode);

        // The on-the-way text was attempted and logged against the job.
        var msgs = await admin.GetFromJsonAsync<JsonElement>($"/api/help-requests/{jobId}/messages");
        Assert.True(msgs.GetArrayLength() >= 1);
        var last = msgs[msgs.GetArrayLength() - 1];
        Assert.Equal("out", last.GetProperty("direction").GetString());
        Assert.Contains("on the way", last.GetProperty("body").GetString());
        Assert.True(last.GetProperty("sent").GetBoolean());
    }
}
