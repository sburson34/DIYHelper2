using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using DIYHelper2.Api.Data;
using DIYHelper2.Api.Models;
using DIYHelper2.Tests.Infrastructure;
using Microsoft.Extensions.DependencyInjection;

namespace DIYHelper2.Tests.Integration;

/// <summary>
/// Two edge guards added after review: the job-status column is a closed set
/// rather than whatever string a client sends, and <c>/api/config</c> stops
/// behaving as a tenant-enumeration oracle.
/// </summary>
public class JobStatusAndConfigHardeningTests : IClassFixture<ApiFactory>
{
    private readonly ApiFactory _factory;

    public JobStatusAndConfigHardeningTests(ApiFactory factory) => _factory = factory;

    /// <summary>Insert a lead straight into the database. Goes around
    /// <c>POST /api/help-requests</c> on purpose: that route is under the "submit"
    /// limiter (10/min/IP) and this class needs more leads than that, so seeding
    /// over HTTP would make the suite fail on 429s rather than on the behaviour
    /// under test.</summary>
    private async Task<int> CreateLeadAsync(string brand)
    {
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var lead = new HelpRequest
        {
            Brand = brand,
            CustomerName = "C",
            CustomerEmail = "c@x.example",
            CustomerPhone = "5550009999",
            ProjectTitle = "status test",
            UserDescription = "d",
            ProjectData = "{}",
            Status = "new",
        };
        db.HelpRequests.Add(lead);
        await db.SaveChangesAsync();
        return lead.Id;
    }

    // ── Job status whitelist ──────────────────────────────────────────────

    [Fact]
    public async Task Owner_Rejects_UnknownStatus()
    {
        await _factory.SeedBrandAsync("js-co", "JS Co", "leads@js.example");
        var id = await CreateLeadAsync("js-co");
        var admin = _factory.CreateAdminClient();

        var resp = await admin.PutAsJsonAsync($"/api/help-requests/{id}", new { status = "totally_made_up" });
        Assert.Equal(HttpStatusCode.BadRequest, resp.StatusCode);

        // And the row is untouched — a rejected transition must not half-apply.
        var after = await admin.GetFromJsonAsync<JsonElement>($"/api/help-requests/{id}");
        Assert.Equal("new", after.GetProperty("status").GetString());
    }

    [Theory]
    [InlineData("scheduled")]
    [InlineData("on_the_way")]
    [InlineData("in_progress")]
    [InlineData("cancelled")]
    public async Task Owner_Accepts_KnownStatuses(string status)
    {
        await _factory.SeedBrandAsync("js-co", "JS Co", "leads@js.example");
        var id = await CreateLeadAsync("js-co");
        var admin = _factory.CreateAdminClient();

        var resp = await admin.PutAsJsonAsync($"/api/help-requests/{id}", new { status });
        Assert.Equal(HttpStatusCode.OK, resp.StatusCode);
    }

    [Fact]
    public async Task Owner_CanStillOmitStatus_ToEditOtherFields()
    {
        // The guard only fires on a supplied status; a notes-only PUT is unaffected.
        await _factory.SeedBrandAsync("js-co", "JS Co", "leads@js.example");
        var id = await CreateLeadAsync("js-co");
        var admin = _factory.CreateAdminClient();

        var resp = await admin.PutAsJsonAsync($"/api/help-requests/{id}", new { notes = "called back" });
        Assert.Equal(HttpStatusCode.OK, resp.StatusCode);
    }

    [Fact]
    public async Task Tech_Rejects_DispatchOnlyAndUnknownStatuses()
    {
        await _factory.SeedBrandAsync("jst-co", "JST Co", "leads@jst.example");
        var admin = _factory.CreateAdminClient();

        var created = await (await admin.PostAsJsonAsync("/api/technicians", new { name = "Sam", brand = "jst-co" }))
            .Content.ReadFromJsonAsync<JsonElement>();
        var techId = created.GetProperty("id").GetInt32();
        var code = created.GetProperty("loginCode").GetString()!;

        var id = await CreateLeadAsync("jst-co");
        await admin.PutAsJsonAsync($"/api/help-requests/{id}", new { assignedTechId = techId });

        var loginReq = new HttpRequestMessage(HttpMethod.Post, "/api/tech/login")
        { Content = JsonContent.Create(new { code }) };
        loginReq.Headers.Add("X-Brand", "jst-co");
        var token = (await (await _factory.CreateClient().SendAsync(loginReq))
            .Content.ReadFromJsonAsync<JsonElement>()).GetProperty("token").GetString()!;

        var tech = _factory.CreateClient();
        tech.DefaultRequestHeaders.Add("X-Brand", "jst-co");
        tech.DefaultRequestHeaders.Authorization =
            new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", token);

        // Invented value.
        Assert.Equal(HttpStatusCode.BadRequest,
            (await tech.PutAsJsonAsync($"/api/tech/jobs/{id}", new { status = "invoiced" })).StatusCode);

        // Real status, but a dispatch decision that belongs to the office.
        Assert.Equal(HttpStatusCode.BadRequest,
            (await tech.PutAsJsonAsync($"/api/tech/jobs/{id}", new { status = "cancelled" })).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest,
            (await tech.PutAsJsonAsync($"/api/tech/jobs/{id}", new { status = "scheduled" })).StatusCode);

        // What a tech legitimately reports still works.
        Assert.Equal(HttpStatusCode.OK,
            (await tech.PutAsJsonAsync($"/api/tech/jobs/{id}", new { status = "on_the_way" })).StatusCode);
        Assert.Equal(HttpStatusCode.OK,
            (await tech.PutAsJsonAsync($"/api/tech/jobs/{id}", new { status = "in_progress" })).StatusCode);
    }

    // ── /api/config enumeration ───────────────────────────────────────────

    [Fact]
    public async Task Config_UnknownBrand_IsIndistinguishableFromAnUnconfiguredOne()
    {
        // Any caller can put an arbitrary slug in X-Brand. If a miss looked
        // different from a hit, this endpoint would let someone walk a wordlist
        // and harvest the tenant list along with each company's phone + review URL.
        var client = _factory.CreateClient();
        client.DefaultRequestHeaders.Add("X-Brand", $"does-not-exist-{Guid.NewGuid():N}");

        var resp = await client.GetAsync("/api/config");
        Assert.Equal(HttpStatusCode.OK, resp.StatusCode);

        var body = await resp.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("", body.GetProperty("companyName").GetString());
        Assert.Equal(JsonValueKind.Null, body.GetProperty("phone").ValueKind);
        Assert.Equal(JsonValueKind.Null, body.GetProperty("reviewUrl").ValueKind);
        Assert.False(body.GetProperty("membershipEnabled").GetBoolean());
        // Still a usable config document, so an un-provisioned build isn't bricked.
        Assert.True(body.GetProperty("features").GetProperty("booking").GetBoolean());
    }

    [Fact]
    public async Task Config_InactiveBrand_LeaksNothing()
    {
        await _factory.SeedBrandAsync(
            "cfg-off", "Deactivated Co", "leads@off.example",
            isActive: false, phone: "5551234567", reviewUrl: "https://reviews.example/off");

        var client = _factory.CreateClient();
        client.DefaultRequestHeaders.Add("X-Brand", "cfg-off");
        var body = await client.GetFromJsonAsync<JsonElement>("/api/config");

        Assert.Equal("", body.GetProperty("companyName").GetString());
        Assert.Equal(JsonValueKind.Null, body.GetProperty("phone").ValueKind);
    }

    [Fact]
    public async Task Config_ActiveBrand_StillReturnsItsDetails()
    {
        // The hardening must not break the case it exists to serve.
        await _factory.SeedBrandAsync(
            "cfg-on", "Live Co", "leads@on.example",
            phone: "5559876543", reviewUrl: "https://reviews.example/on");

        var client = _factory.CreateClient();
        client.DefaultRequestHeaders.Add("X-Brand", "cfg-on");
        var body = await client.GetFromJsonAsync<JsonElement>("/api/config");

        Assert.Equal("Live Co", body.GetProperty("companyName").GetString());
        Assert.Equal("5559876543", body.GetProperty("phone").GetString());
    }
}
