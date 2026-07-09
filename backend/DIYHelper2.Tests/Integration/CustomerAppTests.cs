using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using DIYHelper2.Api.Data;
using DIYHelper2.Tests.Infrastructure;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace DIYHelper2.Tests.Integration;

/// <summary>
/// The customer-facing pro-services surface added in Wave 1: per-brand
/// <c>/api/config</c>, booking with device attribution + lightweight customer
/// upsert, the device-scoped "My Jobs" list, operator scheduling flowing back to
/// the customer, and the fail-soft membership seam. All of these are PUBLIC
/// (X-App-Key only in prod, a no-op here) and keyed off the X-Brand /
/// X-Device-Id headers, so the tests assert the header-based tenancy + scoping.
/// </summary>
public class CustomerAppTests : IClassFixture<ApiFactory>
{
    private readonly ApiFactory _factory;

    public CustomerAppTests(ApiFactory factory) => _factory = factory;

    private HttpClient DeviceClient(string brand, string deviceId)
    {
        var client = _factory.CreateClient();
        client.DefaultRequestHeaders.Add("X-Brand", brand);
        client.DefaultRequestHeaders.Add("X-Device-Id", deviceId);
        return client;
    }

    private static HttpRequestMessage Booking(
        string brand, string deviceId, string title, string email,
        string? serviceType = null, string? preferredWindow = null)
    {
        var req = new HttpRequestMessage(HttpMethod.Post, "/api/help-requests")
        {
            Content = JsonContent.Create(new
            {
                customerName = "Booking Cust",
                customerEmail = email,
                customerPhone = "5551112222",
                projectTitle = title,
                userDescription = "kitchen sink is leaking",
                projectData = "{}",
                imageBase64 = (string?)null,
                serviceType,
                preferredWindow,
            }),
        };
        req.Headers.Add("X-Brand", brand);
        req.Headers.Add("X-Device-Id", deviceId);
        return req;
    }

    [Fact]
    public async Task Config_ReturnsBrandInfoAndDefaultFeatures()
    {
        await _factory.SeedBrandAsync(
            "cfg-co", "Config Co", "leads@cfg.example",
            serviceTypesJson: "[\"Plumbing\",\"HVAC\"]", phone: "555-0100");

        var client = _factory.CreateClient();
        client.DefaultRequestHeaders.Add("X-Brand", "cfg-co");
        var doc = await client.GetFromJsonAsync<JsonElement>("/api/config");

        Assert.Equal("cfg-co", doc.GetProperty("brand").GetString());
        Assert.Equal("Config Co", doc.GetProperty("companyName").GetString());
        Assert.Equal("555-0100", doc.GetProperty("phone").GetString());

        var services = doc.GetProperty("serviceTypes").EnumerateArray().Select(e => e.GetString()).ToList();
        Assert.Equal(new[] { "Plumbing", "HVAC" }, services);

        // Core customer features default ON; memberships OFF (no payment provider).
        var features = doc.GetProperty("features");
        Assert.True(features.GetProperty("booking").GetBoolean());
        Assert.True(features.GetProperty("triage").GetBoolean());
        Assert.True(features.GetProperty("appointmentTracking").GetBoolean());
        Assert.False(features.GetProperty("memberships").GetBoolean());
        Assert.False(doc.GetProperty("membershipEnabled").GetBoolean());
    }

    [Fact]
    public async Task Config_RespectsPerBrandFeatureToggle()
    {
        await _factory.SeedBrandAsync(
            "cfg-off", "Toggle Co", "leads@toggle.example",
            featuresJson: "{\"referrals\":false}");

        var client = _factory.CreateClient();
        client.DefaultRequestHeaders.Add("X-Brand", "cfg-off");
        var doc = await client.GetFromJsonAsync<JsonElement>("/api/config");

        Assert.False(doc.GetProperty("features").GetProperty("referrals").GetBoolean());
        // A toggle for one feature must not disable the others.
        Assert.True(doc.GetProperty("features").GetProperty("booking").GetBoolean());
    }

    [Fact]
    public async Task Booking_PersistsBookingFields_AndAppearsInMyJobsForSameDevice()
    {
        await _factory.SeedBrandAsync("book-co", "Book Co", "leads@book.example");
        var client = DeviceClient("book-co", "device-AAA");

        var create = await client.SendAsync(Booking(
            "book-co", "device-AAA", "Leaky sink", "cust@book.example",
            serviceType: "Plumbing", preferredWindow: "morning"));
        Assert.Equal(HttpStatusCode.Created, create.StatusCode);

        var jobs = await client.GetFromJsonAsync<JsonElement>("/api/my/requests");
        Assert.Equal(1, jobs.GetArrayLength());
        var job = jobs[0];
        Assert.Equal("Leaky sink", job.GetProperty("projectTitle").GetString());
        Assert.Equal("Plumbing", job.GetProperty("serviceType").GetString());
        Assert.Equal("morning", job.GetProperty("preferredWindow").GetString());
        Assert.Equal("new", job.GetProperty("status").GetString());
    }

    [Fact]
    public async Task MyJobs_IsScopedToDevice()
    {
        await _factory.SeedBrandAsync("scope-co", "Scope Co", "leads@scope.example");

        // Device A books; device B (same brand) must not see A's job.
        var a = DeviceClient("scope-co", "dev-A");
        await a.SendAsync(Booking("scope-co", "dev-A", "A's job", "a@scope.example"));

        var b = DeviceClient("scope-co", "dev-B");
        var bJobs = await b.GetFromJsonAsync<JsonElement>("/api/my/requests");
        Assert.Equal(0, bJobs.GetArrayLength());

        var aJobs = await a.GetFromJsonAsync<JsonElement>("/api/my/requests");
        Assert.Equal(1, aJobs.GetArrayLength());
    }

    [Fact]
    public async Task MyRequestDetail_Returns404_ForAnotherDevice()
    {
        await _factory.SeedBrandAsync("detail-co", "Detail Co", "leads@detail.example");
        var a = DeviceClient("detail-co", "owner");
        var create = await a.SendAsync(Booking("detail-co", "owner", "Owned", "o@detail.example"));
        var id = (await create.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetInt32();

        // Owner sees it...
        var ownOk = await a.GetAsync($"/api/my/requests/{id}");
        Assert.Equal(HttpStatusCode.OK, ownOk.StatusCode);

        // ...a different device gets 404 (not 403) — can't probe another's id space.
        var b = DeviceClient("detail-co", "intruder");
        var other = await b.GetAsync($"/api/my/requests/{id}");
        Assert.Equal(HttpStatusCode.NotFound, other.StatusCode);
    }

    [Fact]
    public async Task OperatorSchedule_FlowsBackToCustomerTracker()
    {
        await _factory.SeedBrandAsync("sched-co", "Sched Co", "leads@sched.example");
        var device = DeviceClient("sched-co", "dev-sched");
        var create = await device.SendAsync(Booking("sched-co", "dev-sched", "Furnace", "f@sched.example"));
        var id = (await create.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetInt32();

        // Operator marks it on-the-way with an ETA via the admin PUT.
        var admin = _factory.CreateAdminClient();
        var when = DateTime.UtcNow.AddHours(2);
        var put = await admin.PutAsJsonAsync($"/api/help-requests/{id}", new
        {
            status = "on_the_way",
            scheduledFor = when,
            techEtaMinutes = 25,
        });
        Assert.Equal(HttpStatusCode.OK, put.StatusCode);

        // Customer's tracker reflects it.
        var jobs = await device.GetFromJsonAsync<JsonElement>("/api/my/requests");
        var job = jobs[0];
        Assert.Equal("on_the_way", job.GetProperty("status").GetString());
        Assert.Equal(25, job.GetProperty("techEtaMinutes").GetInt32());
    }

    [Fact]
    public async Task Booking_UpsertsSingleCustomer_ForRepeatBookingsOnSameDevice()
    {
        await _factory.SeedBrandAsync("cust-co", "Cust Co", "leads@cust.example");
        var device = DeviceClient("cust-co", "repeat-dev");

        await device.SendAsync(Booking("cust-co", "repeat-dev", "Job 1", "repeat@cust.example"));
        await device.SendAsync(Booking("cust-co", "repeat-dev", "Job 2", "repeat@cust.example"));

        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var customers = await db.Customers.Where(c => c.Brand == "cust-co" && c.DeviceId == "repeat-dev").ToListAsync();
        Assert.Single(customers);
        // Two leads, one customer.
        var leads = await db.HelpRequests.CountAsync(r => r.Brand == "cust-co" && r.DeviceId == "repeat-dev");
        Assert.Equal(2, leads);
    }

    [Fact]
    public async Task Membership_ReturnsUnavailable_WhenBrandNotOptedIn()
    {
        await _factory.SeedBrandAsync("nomem-co", "No Member Co", "leads@nomem.example");
        var client = _factory.CreateClient();
        client.DefaultRequestHeaders.Add("X-Brand", "nomem-co");

        var resp = await client.PostAsJsonAsync("/api/memberships/checkout", new
        {
            customerEmail = "m@nomem.example",
        });
        Assert.Equal(HttpStatusCode.OK, resp.StatusCode);
        var doc = await resp.Content.ReadFromJsonAsync<JsonElement>();
        Assert.False(doc.GetProperty("available").GetBoolean());
    }
}
