using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using DIYHelper2.Api.Data;
using DIYHelper2.Api.Models;
using DIYHelper2.Api.Services;
using DIYHelper2.Tests.Infrastructure;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;

namespace DIYHelper2.Tests.Integration;

/// <summary>
/// A8 assets + multi-property: device-scoped customer equipment (with the
/// email-match path for owner-entered assets), per-asset service history,
/// saved properties whose address is copied onto bookings (skipping the
/// geocoder when coords exist), booking-time ownership validation, the
/// idempotent warranty sweep, and the auth posture split between the public
/// /api/my/assets routes and the admin-gated /api/assets CRUD.
/// </summary>
public class AssetsAndPropertiesTests : IClassFixture<ApiFactory>
{
    private readonly ApiFactory _factory;
    public AssetsAndPropertiesTests(ApiFactory factory) => _factory = factory;

    private static int _ipSeq;

    private HttpClient Device(string brand, string device)
    {
        var c = _factory.CreateClient();
        // Unique per-client IP so the per-IP "submit" limiter never couples tests.
        c.DefaultRequestHeaders.Add("X-Forwarded-For", $"10.47.{Interlocked.Increment(ref _ipSeq)}.1");
        c.DefaultRequestHeaders.Add("X-Brand", brand);
        c.DefaultRequestHeaders.Add("X-Device-Id", device);
        return c;
    }

    private static async Task<HttpResponseMessage> BookRawAsync(
        HttpClient device, string email = "cust@x.example",
        int? assetId = null, int? propertyId = null, string title = "Asset job")
    {
        return await device.PostAsJsonAsync("/api/help-requests", new
        {
            customerName = "A", customerEmail = email, customerPhone = "5551234567",
            projectTitle = title, userDescription = "d", projectData = "{}",
            imageBase64 = (string?)null, assetId, propertyId,
        });
    }

    private static async Task<int> BookAsync(
        HttpClient device, string email = "cust@x.example",
        int? assetId = null, int? propertyId = null, string title = "Asset job")
    {
        var resp = await BookRawAsync(device, email, assetId, propertyId, title);
        Assert.Equal(HttpStatusCode.Created, resp.StatusCode);
        return (await resp.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetInt32();
    }

    private static async Task<int> CreateAssetAsync(HttpClient device, string label)
    {
        var resp = await device.PostAsJsonAsync("/api/my/assets", new { label });
        Assert.Equal(HttpStatusCode.Created, resp.StatusCode);
        return (await resp.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetInt32();
    }

    [Fact]
    public async Task CustomerAsset_Crud_IsDeviceAndBrandScoped()
    {
        await _factory.SeedBrandAsync("as-co", "Asset Co", "leads@as.example");
        await _factory.SeedBrandAsync("as-other", "Other Co", "leads@ao.example");
        var a = Device("as-co", "as-dev-A");

        var create = await a.PostAsJsonAsync("/api/my/assets", new
        {
            label = "Basement water heater", make = "Rheem", model = "XE50", serial = "SN-1",
        });
        Assert.Equal(HttpStatusCode.Created, create.StatusCode);
        var created = await create.Content.ReadFromJsonAsync<JsonElement>();
        var assetId = created.GetProperty("id").GetInt32();
        Assert.Equal("Basement water heater", created.GetProperty("label").GetString());
        Assert.Equal("Rheem", created.GetProperty("make").GetString());

        var list = await a.GetFromJsonAsync<JsonElement>("/api/my/assets");
        Assert.Equal(1, list.GetArrayLength());

        // Blank label → 400.
        var blank = await a.PostAsJsonAsync("/api/my/assets", new { label = "  " });
        Assert.Equal(HttpStatusCode.BadRequest, blank.StatusCode);

        // A different device on the same brand sees nothing and can't touch it.
        var b = Device("as-co", "as-dev-B");
        Assert.Equal(0, (await b.GetFromJsonAsync<JsonElement>("/api/my/assets")).GetArrayLength());
        Assert.Equal(HttpStatusCode.NotFound,
            (await b.PutAsJsonAsync($"/api/my/assets/{assetId}", new { label = "Hijack" })).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await b.DeleteAsync($"/api/my/assets/{assetId}")).StatusCode);

        // Same device id under a different brand sees nothing.
        var other = Device("as-other", "as-dev-A");
        Assert.Equal(0, (await other.GetFromJsonAsync<JsonElement>("/api/my/assets")).GetArrayLength());

        // Owner-device PUT round-trips; DELETE is a hard delete.
        var put = await a.PutAsJsonAsync($"/api/my/assets/{assetId}", new
        {
            label = "Garage water heater", make = "Rheem", model = "XE50", serial = "SN-1",
        });
        Assert.Equal(HttpStatusCode.OK, put.StatusCode);
        Assert.Equal("Garage water heater",
            (await put.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("label").GetString());

        Assert.Equal(HttpStatusCode.NoContent, (await a.DeleteAsync($"/api/my/assets/{assetId}")).StatusCode);
        Assert.Equal(0, (await a.GetFromJsonAsync<JsonElement>("/api/my/assets")).GetArrayLength());
    }

    [Fact]
    public async Task OwnerAsset_WithMatchingEmail_AppearsInCustomersList()
    {
        await _factory.SeedBrandAsync("em-co", "Email Co", "leads@em.example");
        var device = Device("em-co", "em-dev");
        // The booking upserts a Customer with this email for the device.
        await BookAsync(device, email: "match@em.example");

        // Owner enters the equipment against that email (super-admin: brand in body).
        var admin = _factory.CreateAdminClient();
        var create = await admin.PostAsJsonAsync("/api/assets", new
        {
            brand = "em-co", customerEmail = "match@em.example", label = "Attic furnace",
        });
        Assert.Equal(HttpStatusCode.Created, create.StatusCode);

        // The customer's device sees it via the email match (no device id on the asset).
        var list = await device.GetFromJsonAsync<JsonElement>("/api/my/assets");
        var labels = list.EnumerateArray().Select(x => x.GetProperty("label").GetString()).ToList();
        Assert.Contains("Attic furnace", labels);

        // Owner list filters by exact email.
        var filtered = await admin.GetFromJsonAsync<JsonElement>(
            "/api/assets?brand=em-co&customerEmail=match@em.example");
        Assert.Equal(1, filtered.GetArrayLength());
        Assert.Equal("em-co", filtered[0].GetProperty("brand").GetString());
        Assert.True(filtered[0].GetProperty("isActive").GetBoolean());
        var none = await admin.GetFromJsonAsync<JsonElement>(
            "/api/assets?brand=em-co&customerEmail=other@em.example");
        Assert.Equal(0, none.GetArrayLength());
    }

    [Fact]
    public async Task AssetHistory_ReturnsJobsNewestFirst_And404ForForeignDevice()
    {
        await _factory.SeedBrandAsync("hi-co", "History Co", "leads@hi.example");
        var device = Device("hi-co", "hi-dev");
        var assetId = await CreateAssetAsync(device, "Water heater");

        var first = await BookAsync(device, assetId: assetId, title: "First visit");
        var second = await BookAsync(device, assetId: assetId, title: "Second visit");

        // Drive the second job to completed via the admin PUT.
        var admin = _factory.CreateAdminClient();
        var put = await admin.PutAsJsonAsync($"/api/help-requests/{second}", new { status = "completed" });
        Assert.Equal(HttpStatusCode.OK, put.StatusCode);

        var history = await device.GetFromJsonAsync<JsonElement>($"/api/my/assets/{assetId}/history");
        Assert.Equal(2, history.GetArrayLength());
        Assert.Equal(second, history[0].GetProperty("id").GetInt32());   // newest first
        Assert.Equal("completed", history[0].GetProperty("status").GetString());
        Assert.NotEqual(JsonValueKind.Null, history[0].GetProperty("completedAt").ValueKind);
        Assert.Equal(first, history[1].GetProperty("id").GetInt32());
        Assert.Equal("First visit", history[1].GetProperty("projectTitle").GetString());

        // The "My Jobs" projection carries the assetId for the app's asset chip.
        var jobs = await device.GetFromJsonAsync<JsonElement>("/api/my/requests");
        Assert.All(jobs.EnumerateArray(), j => Assert.Equal(assetId, j.GetProperty("assetId").GetInt32()));

        // A foreign device can't read the asset's history — 404, not 403.
        var foreign = Device("hi-co", "hi-intruder");
        Assert.Equal(HttpStatusCode.NotFound,
            (await foreign.GetAsync($"/api/my/assets/{assetId}/history")).StatusCode);
    }

    [Fact]
    public async Task Properties_CrudDeviceScoped_AndBookingCopiesAddress()
    {
        await _factory.SeedBrandAsync("pr-co", "Prop Co", "leads@pr.example");
        var a = Device("pr-co", "pr-dev-A");

        var create = await a.PostAsJsonAsync("/api/my/properties", new
        {
            label = "Rental", address = "123 Main St", city = "Austin", state = "TX", zip = "78701",
        });
        Assert.Equal(HttpStatusCode.Created, create.StatusCode);
        var prop = await create.Content.ReadFromJsonAsync<JsonElement>();
        var propId = prop.GetProperty("id").GetInt32();
        Assert.Equal("123 Main St", prop.GetProperty("address").GetString());

        // Listed for the owning device; invisible + untouchable for another.
        Assert.Equal(1, (await a.GetFromJsonAsync<JsonElement>("/api/my/properties")).GetArrayLength());
        var b = Device("pr-co", "pr-dev-B");
        Assert.Equal(0, (await b.GetFromJsonAsync<JsonElement>("/api/my/properties")).GetArrayLength());
        Assert.Equal(HttpStatusCode.NotFound,
            (await b.PutAsJsonAsync($"/api/my/properties/{propId}", new { label = "Hijack" })).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await b.DeleteAsync($"/api/my/properties/{propId}")).StatusCode);

        var put = await a.PutAsJsonAsync($"/api/my/properties/{propId}", new
        {
            label = "Rental on 5th", address = "123 Main St", city = "Austin", state = "TX", zip = "78701",
        });
        Assert.Equal(HttpStatusCode.OK, put.StatusCode);
        Assert.Equal("Rental on 5th",
            (await put.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("label").GetString());

        // Booking against the property copies its address columns onto the job.
        var jobId = await BookAsync(a, propertyId: propId, title: "Prop job");
        var detail = await a.GetFromJsonAsync<JsonElement>($"/api/my/requests/{jobId}");
        Assert.Equal("123 Main St", detail.GetProperty("address").GetString());

        using (var scope = _factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var row = await db.HelpRequests.FindAsync(jobId);
            Assert.Equal("Austin", row!.City);
            Assert.Equal("TX", row.State);
            Assert.Equal("78701", row.Zip);
            Assert.Equal(propId, row.PropertyId);
        }

        // Booking with someone else's propertyId or assetId → 400, nothing saved.
        var assetId = await CreateAssetAsync(a, "AC unit");
        Assert.Equal(HttpStatusCode.BadRequest, (await BookRawAsync(b, propertyId: propId)).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await BookRawAsync(b, assetId: assetId)).StatusCode);
    }

    [Fact]
    public async Task Booking_WithGeocodedProperty_UsesStoredCoords_SkipsGeocoder()
    {
        await _factory.SeedBrandAsync("geo-co", "Geo Co", "leads@geo.example");
        var device = Device("geo-co", "geo-dev");
        var create = await device.PostAsJsonAsync("/api/my/properties",
            new { label = "Home", address = "9 Coord Way" });
        Assert.Equal(HttpStatusCode.Created, create.StatusCode);
        var propId = (await create.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetInt32();

        // Give the property known coords (as if geocoded once already).
        using (var scope = _factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var p = await db.CustomerProperties.FindAsync(propId);
            p!.Lat = 30.1;
            p.Lng = -97.2;
            await db.SaveChangesAsync();
        }

        // Geocoder configured and instrumented — it must NOT be called.
        _factory.SetGoogleApiKey("test-geo-key");
        var geocodeCalls = 0;
        _factory.FakeGeocodeHandler.Responder = _ =>
        {
            Interlocked.Increment(ref geocodeCalls);
            return Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK)
            {
                Content = new StringContent("{\"status\":\"OK\",\"results\":[]}"),
            });
        };

        var jobId = await BookAsync(device, propertyId: propId);

        using var check = _factory.Services.CreateScope();
        var db2 = check.ServiceProvider.GetRequiredService<AppDbContext>();
        var row = await db2.HelpRequests.FindAsync(jobId);
        Assert.Equal(30.1, row!.Lat);
        Assert.Equal(-97.2, row.Lng);
        Assert.Equal(0, geocodeCalls);
    }

    [Fact]
    public async Task WarrantySweep_CreatesOneReminder_IdempotentAcrossRuns()
    {
        await _factory.SeedBrandAsync("wr-co", "Warranty Co", "leads@wr.example");
        int assetId;
        using (var seed = _factory.Services.CreateScope())
        {
            var db = seed.ServiceProvider.GetRequiredService<AppDbContext>();
            var asset = new Asset
            {
                Brand = "wr-co",
                DeviceId = "wr-dev",
                CustomerEmail = "warr@wr.example",
                Label = "Garage heat pump",
                WarrantyExpiresAt = DateTime.UtcNow.AddDays(30),
            };
            db.Assets.Add(asset);
            // No email → skipped (and left unstamped for a later email attach).
            db.Assets.Add(new Asset
            {
                Brand = "wr-co", DeviceId = "wr-dev2", Label = "No email unit",
                WarrantyExpiresAt = DateTime.UtcNow.AddDays(10),
            });
            // Outside the 60-day horizon → not swept.
            db.Assets.Add(new Asset
            {
                Brand = "wr-co", CustomerEmail = "far@wr.example", Label = "New unit",
                WarrantyExpiresAt = DateTime.UtcNow.AddDays(200),
            });
            await db.SaveChangesAsync();
            assetId = asset.Id;
        }

        // Run the sweep TWICE — the idempotency stamp must hold it to one reminder.
        for (var i = 0; i < 2; i++)
        {
            using var run = _factory.Services.CreateScope();
            var db = run.ServiceProvider.GetRequiredService<AppDbContext>();
            await MaintenanceReminderService.CreateWarrantyRemindersAsync(db, NullLogger.Instance);
        }

        using var check = _factory.Services.CreateScope();
        var db2 = check.ServiceProvider.GetRequiredService<AppDbContext>();
        var reminders = await db2.MaintenanceReminders.Where(m => m.Brand == "wr-co").ToListAsync();
        var reminder = Assert.Single(reminders);
        Assert.Equal("warr@wr.example", reminder.CustomerEmail);
        Assert.Equal("warranty check — Garage heat pump", reminder.ServiceType);
        Assert.Null(reminder.SentAt);
        // Expiry-30d ≈ now for a 30-day-out warranty → due immediately.
        Assert.True((reminder.DueAt - DateTime.UtcNow).Duration() < TimeSpan.FromMinutes(5));

        var swept = await db2.Assets.FindAsync(assetId);
        Assert.NotNull(swept!.WarrantyReminderCreatedAt);
    }

    [Fact]
    public async Task MyAssets_IsPublic_OwnerAssets_RequiresAdminAuth()
    {
        await _factory.SeedBrandAsync("auth-co", "Auth Co", "leads@auth.example");

        // Regression guard: the /api/assets admin gate must NOT catch the
        // customer-facing /api/my/assets routes (no admin creds here).
        var device = Device("auth-co", "auth-dev");
        var mine = await device.GetAsync("/api/my/assets");
        Assert.Equal(HttpStatusCode.OK, mine.StatusCode);

        // Owner CRUD is admin-gated: anonymous → 401, admin → 200.
        var anon = _factory.CreateClient();
        Assert.Equal(HttpStatusCode.Unauthorized, (await anon.GetAsync("/api/assets")).StatusCode);
        var admin = _factory.CreateAdminClient();
        Assert.Equal(HttpStatusCode.OK, (await admin.GetAsync("/api/assets")).StatusCode);
    }
}
