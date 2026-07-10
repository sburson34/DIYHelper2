using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using DIYHelper2.Tests.Infrastructure;
using Microsoft.Extensions.DependencyInjection;

namespace DIYHelper2.Tests.Integration;

/// <summary>
/// A5 job address + route view: booking persists the address and geocodes it
/// best-effort (fail-soft null coords on a miss), projections expose the
/// address + mapsUrl, and GET /api/ops/route orders a tech's day by
/// nearest-neighbor with un-geocoded jobs reported as unroutable.
/// </summary>
public class AddressAndRouteTests : IClassFixture<ApiFactory>
{
    private readonly ApiFactory _factory;
    public AddressAndRouteTests(ApiFactory factory) => _factory = factory;

    private static int _ipSeq;

    private HttpClient NewClient()
    {
        var c = _factory.CreateClient();
        // Unique per-client IP so the per-IP "submit" limiter never couples tests.
        c.DefaultRequestHeaders.Add("X-Forwarded-For", $"10.45.{Interlocked.Increment(ref _ipSeq)}.1");
        return c;
    }

    private HttpClient Device(string brand, string device)
    {
        var c = NewClient();
        c.DefaultRequestHeaders.Add("X-Brand", brand);
        c.DefaultRequestHeaders.Add("X-Device-Id", device);
        return c;
    }

    private static string GeocodeJson(double lat, double lng) =>
        "{\"status\":\"OK\",\"results\":[{\"geometry\":{\"location\":{\"lat\":"
        + lat.ToString(System.Globalization.CultureInfo.InvariantCulture)
        + ",\"lng\":" + lng.ToString(System.Globalization.CultureInfo.InvariantCulture)
        + "}}}]}";

    private async Task<int> BookWithAddressAsync(HttpClient device, string address)
    {
        var resp = await device.PostAsJsonAsync("/api/help-requests", new
        {
            customerName = "A", customerEmail = "a@x.example", customerPhone = "5553334444",
            projectTitle = "Addr job", userDescription = "d", projectData = "{}",
            imageBase64 = (string?)null, address,
        });
        Assert.Equal(HttpStatusCode.Created, resp.StatusCode);
        return (await resp.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetInt32();
    }

    private async Task<DIYHelper2.Api.Models.HelpRequest> RowAsync(int id)
    {
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<DIYHelper2.Api.Data.AppDbContext>();
        return (await db.HelpRequests.FindAsync(id))!;
    }

    /// <summary>Seed a job directly (skips rate limits) for the route tests.</summary>
    private async Task<int> SeedJobAsync(string brand, int techId, string status,
        DateTime scheduledFor, double? lat, double? lng, string? address = null)
    {
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<DIYHelper2.Api.Data.AppDbContext>();
        var r = new DIYHelper2.Api.Models.HelpRequest
        {
            Brand = brand,
            CustomerName = "R",
            ProjectTitle = $"Route job {lat}/{lng}",
            Status = status,
            AssignedTechId = techId,
            ScheduledFor = scheduledFor,
            Address = address ?? "1 Test Way",
            Lat = lat,
            Lng = lng,
        };
        db.HelpRequests.Add(r);
        await db.SaveChangesAsync();
        return r.Id;
    }

    private async Task<int> SeedTechAsync(string brand, string name = "Route Tech")
    {
        var admin = _factory.CreateAdminClient();
        var resp = await admin.PostAsJsonAsync("/api/technicians", new { name, brand });
        Assert.Equal(HttpStatusCode.Created, resp.StatusCode);
        return (await resp.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetInt32();
    }

    [Fact]
    public async Task Booking_WithAddress_PersistsAndGeocodes()
    {
        await _factory.SeedBrandAsync("adr-ok", "Adr OK", "leads@ao.example");
        _factory.SetGoogleApiKey("test-geo-key");
        _factory.FakeGeocodeHandler.Responder = _ => Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK)
        {
            Content = new StringContent(GeocodeJson(44.9778, -93.2650), System.Text.Encoding.UTF8, "application/json"),
        });

        var device = Device("adr-ok", "ao-dev");
        var jobId = await BookWithAddressAsync(device, "123 Hennepin Ave, Minneapolis MN");

        var row = await RowAsync(jobId);
        Assert.Equal("123 Hennepin Ave, Minneapolis MN", row.Address);
        Assert.Null(row.City); // console refines these later
        Assert.Equal(44.9778, row.Lat!.Value, 4);
        Assert.Equal(-93.2650, row.Lng!.Value, 4);

        // Customer list + detail expose the address line.
        var detail = await device.GetFromJsonAsync<JsonElement>($"/api/my/requests/{jobId}");
        Assert.Equal("123 Hennepin Ave, Minneapolis MN", detail.GetProperty("address").GetString());
    }

    [Fact]
    public async Task Booking_GeocodeFailure_Still201_WithNullCoords()
    {
        await _factory.SeedBrandAsync("adr-fail", "Adr Fail", "leads@af.example");
        _factory.SetGoogleApiKey("test-geo-key");
        _factory.FakeGeocodeHandler.Responder = _ =>
            Task.FromResult(new HttpResponseMessage(HttpStatusCode.InternalServerError));

        var device = Device("adr-fail", "af-dev");
        var jobId = await BookWithAddressAsync(device, "999 Nowhere Rd (unique adr-fail)");

        var row = await RowAsync(jobId);
        Assert.Equal("999 Nowhere Rd (unique adr-fail)", row.Address);
        Assert.Null(row.Lat);
        Assert.Null(row.Lng);
    }

    [Fact]
    public async Task Booking_AddressOver200Chars_Is400()
    {
        await _factory.SeedBrandAsync("adr-long", "Adr Long", "leads@al.example");
        var device = Device("adr-long", "al-dev");
        var resp = await device.PostAsJsonAsync("/api/help-requests", new
        {
            customerName = "A", customerEmail = "a@x.example", customerPhone = "5553334444",
            projectTitle = "Long", userDescription = "d", projectData = "{}",
            imageBase64 = (string?)null, address = new string('x', 201),
        });
        Assert.Equal(HttpStatusCode.BadRequest, resp.StatusCode);
    }

    [Fact]
    public async Task TechDetail_ExposesAddressAndMapsUrl()
    {
        await _factory.SeedBrandAsync("adr-tech", "Adr Tech", "leads@at.example");
        var admin = _factory.CreateAdminClient();
        var create = await admin.PostAsJsonAsync("/api/technicians", new { name = "Nav Tech", brand = "adr-tech" });
        var created = await create.Content.ReadFromJsonAsync<JsonElement>();
        var techId = created.GetProperty("id").GetInt32();
        var code = created.GetProperty("loginCode").GetString()!;

        var jobId = await SeedJobAsync("adr-tech", techId, "scheduled",
            DateTime.UtcNow.AddDays(1), 44.9778, -93.265, "500 Nicollet Mall");

        var login = NewClient();
        login.DefaultRequestHeaders.Add("X-Brand", "adr-tech");
        var loginResp = await login.PostAsJsonAsync("/api/tech/login", new { code });
        var token = (await loginResp.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("token").GetString()!;

        var tech = NewClient();
        tech.DefaultRequestHeaders.Add("X-Brand", "adr-tech");
        tech.DefaultRequestHeaders.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", token);
        var detail = await tech.GetFromJsonAsync<JsonElement>($"/api/tech/jobs/{jobId}");

        Assert.Equal("500 Nicollet Mall", detail.GetProperty("address").GetString());
        Assert.Equal("https://www.google.com/maps/dir/?api=1&destination=44.9778,-93.265",
            detail.GetProperty("mapsUrl").GetString());
    }

    [Fact]
    public async Task Route_OrdersByNearestNeighbor_AndFlagsCoordlessJobs()
    {
        await _factory.SeedBrandAsync("route-co", "Route Co", "leads@rc.example");
        var techId = await SeedTechAsync("route-co");
        var day = new DateTime(2026, 8, 3, 0, 0, 0, DateTimeKind.Utc);

        // Anchor at 8am (0.0), then 0.5° away at 10am, 0.1° away at 11am, and a
        // coordless noon job. NN from the anchor → 0.0, 0.1, 0.5, coordless.
        var a = await SeedJobAsync("route-co", techId, "scheduled", day.AddHours(8), 45.0, -93.0);
        var b = await SeedJobAsync("route-co", techId, "scheduled", day.AddHours(10), 45.0, -93.5);
        var c = await SeedJobAsync("route-co", techId, "on_the_way", day.AddHours(11), 45.0, -93.1);
        var d = await SeedJobAsync("route-co", techId, "in_progress", day.AddHours(12), null, null);
        // Noise that must NOT appear: completed same day, and next-day job.
        await SeedJobAsync("route-co", techId, "completed", day.AddHours(9), 45.0, -93.2);
        await SeedJobAsync("route-co", techId, "scheduled", day.AddDays(1).AddHours(9), 45.0, -93.3);

        var admin = _factory.CreateAdminClient();
        var route = await admin.GetFromJsonAsync<JsonElement>(
            $"/api/ops/route?techId={techId}&date=2026-08-03");

        var ids = route.GetProperty("stops").EnumerateArray().Select(s => s.GetProperty("id").GetInt32()).ToArray();
        Assert.Equal(new[] { a, c, b, d }, ids);
        Assert.Equal(new[] { d }, route.GetProperty("unroutable").EnumerateArray().Select(e => e.GetInt32()).ToArray());
        Assert.True(route.GetProperty("totalMiles").GetDouble() > 0);
        // First leg is 0; the coordless job has no legMiles.
        var stops = route.GetProperty("stops").EnumerateArray().ToList();
        Assert.Equal(0, stops[0].GetProperty("legMiles").GetDouble());
        Assert.Equal(JsonValueKind.Null, stops[3].GetProperty("legMiles").ValueKind);
    }

    [Fact]
    public async Task Route_IsBrandScoped_CrossTenant404()
    {
        await _factory.SeedBrandAsync("route-a", "Route A", "leads@ra.example",
            username: "route-a-admin", password: "route-a-pass");
        await _factory.SeedBrandAsync("route-b", "Route B", "leads@rb.example");
        var techBId = await SeedTechAsync("route-b", "B Tech");

        // Brand A's scoped login can't pull brand B's tech route (404, not 403).
        var scopedA = _factory.CreateBrandClient("route-a-admin", "route-a-pass");
        var resp = await scopedA.GetAsync($"/api/ops/route?techId={techBId}&date=2026-08-03");
        Assert.Equal(HttpStatusCode.NotFound, resp.StatusCode);

        // Missing/malformed params are 400s.
        var admin = _factory.CreateAdminClient();
        Assert.Equal(HttpStatusCode.BadRequest, (await admin.GetAsync("/api/ops/route?date=2026-08-03")).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await admin.GetAsync($"/api/ops/route?techId={techBId}&date=nope")).StatusCode);
    }

    [Fact]
    public async Task OwnerPut_ManualCoords_Win_And_AddressChangeRegeocodes()
    {
        await _factory.SeedBrandAsync("adr-own", "Adr Own", "leads@aw.example");
        _factory.SetGoogleApiKey("test-geo-key");
        var device = Device("adr-own", "aw-dev");
        var jobId = await BookWithAddressAsync(device, "1 Original St (adr-own)");

        var admin = _factory.CreateAdminClient();

        // Manual coords: no geocode call needed, values stick.
        var manual = await admin.PutAsJsonAsync($"/api/help-requests/{jobId}", new
        {
            address = "2 Manual Ave (adr-own)", city = "St Paul", state = "MN", zip = "55101",
            lat = 44.95, lng = -93.09,
        });
        Assert.Equal(HttpStatusCode.OK, manual.StatusCode);
        var row = await RowAsync(jobId);
        Assert.Equal("2 Manual Ave (adr-own)", row.Address);
        Assert.Equal("St Paul", row.City);
        Assert.Equal(44.95, row.Lat!.Value, 4);

        // Address-only change → server re-geocodes via the fake.
        _factory.FakeGeocodeHandler.Responder = _ => Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK)
        {
            Content = new StringContent(GeocodeJson(46.0, -94.0), System.Text.Encoding.UTF8, "application/json"),
        });
        var regeo = await admin.PutAsJsonAsync($"/api/help-requests/{jobId}", new
        {
            address = "3 Regeo Blvd (adr-own)",
        });
        Assert.Equal(HttpStatusCode.OK, regeo.StatusCode);
        row = await RowAsync(jobId);
        Assert.Equal(46.0, row.Lat!.Value, 4);
        Assert.Equal(-94.0, row.Lng!.Value, 4);
    }
}
