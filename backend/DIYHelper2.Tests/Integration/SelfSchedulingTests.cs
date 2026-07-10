using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using DIYHelper2.Api.Services;
using DIYHelper2.Tests.Infrastructure;
using Microsoft.Extensions.DependencyInjection;

namespace DIYHelper2.Tests.Integration;

/// <summary>
/// A6 online self-scheduling: slot expansion is DST-correct, /api/availability
/// is public and empty for unconfigured brands, booking with slotStart claims
/// a seat transactionally (full slot → 409 slot_taken with NOTHING persisted),
/// cancellation releases the seat, and claims are brand-isolated.
/// </summary>
public class SelfSchedulingTests : IClassFixture<ApiFactory>
{
    private const string MonFri8To12 =
        """{"mon":[{"start":"08:00","end":"12:00"}],"tue":[{"start":"08:00","end":"12:00"}],"wed":[{"start":"08:00","end":"12:00"}],"thu":[{"start":"08:00","end":"12:00"}],"fri":[{"start":"08:00","end":"12:00"}],"sat":[{"start":"08:00","end":"12:00"}],"sun":[{"start":"08:00","end":"12:00"}]}""";

    private readonly ApiFactory _factory;
    public SelfSchedulingTests(ApiFactory factory) => _factory = factory;

    private static int _ipSeq;

    private HttpClient Device(string brand, string device)
    {
        var c = _factory.CreateClient();
        c.DefaultRequestHeaders.Add("X-Forwarded-For", $"10.46.{Interlocked.Increment(ref _ipSeq)}.1");
        c.DefaultRequestHeaders.Add("X-Brand", brand);
        c.DefaultRequestHeaders.Add("X-Device-Id", device);
        return c;
    }

    /// <summary>A brand-local date far enough out that its slots are never
    /// "past" while tests run.</summary>
    private static string FutureDate => DateOnly.FromDateTime(DateTime.UtcNow.AddDays(14)).ToString("yyyy-MM-dd");

    private async Task<HttpResponseMessage> BookSlotAsync(HttpClient device, string slotStartIso, string title = "Slot job")
    {
        return await device.PostAsJsonAsync("/api/help-requests", new
        {
            customerName = "S", customerEmail = "s@x.example", customerPhone = "5556667777",
            projectTitle = title, userDescription = "d", projectData = "{}",
            imageBase64 = (string?)null, slotStart = slotStartIso,
        });
    }

    // ── Pure slot expansion (DST pinning) ────────────────────────────────

    [Fact]
    public void ExpandSlots_SpringForward_ProducesCorrectUtcStarts()
    {
        // 2026-03-08 is the US spring-forward date. 08:00 America/Chicago is
        // already CDT (UTC-5) → 13:00Z; 10:00 → 15:00Z. A CST morning the day
        // before would have been UTC-6 — this pins the zone conversion.
        var slots = AvailabilityService.ExpandSlotsUtc(
            """{"sun":[{"start":"08:00","end":"12:00"}]}""",
            new DateOnly(2026, 3, 8), "America/Chicago", 120);

        Assert.Equal(2, slots.Count);
        Assert.Equal(new DateTime(2026, 3, 8, 13, 0, 0, DateTimeKind.Utc), slots[0].StartUtc);
        Assert.Equal(new DateTime(2026, 3, 8, 15, 0, 0, DateTimeKind.Utc), slots[0].EndUtc);
        Assert.Equal(new DateTime(2026, 3, 8, 15, 0, 0, DateTimeKind.Utc), slots[1].StartUtc);
    }

    [Fact]
    public void ExpandSlots_SkipsNonexistentSpringForwardHour()
    {
        // 02:00–03:00 doesn't exist on 2026-03-08 in Chicago: 01:00 is CST
        // (07:00Z), 02:00 is invalid (skipped), 03:00 is CDT (08:00Z).
        var slots = AvailabilityService.ExpandSlotsUtc(
            """{"sun":[{"start":"01:00","end":"04:00"}]}""",
            new DateOnly(2026, 3, 8), "America/Chicago", 60);

        Assert.Equal(2, slots.Count);
        Assert.Equal(new DateTime(2026, 3, 8, 7, 0, 0, DateTimeKind.Utc), slots[0].StartUtc);
        Assert.Equal(new DateTime(2026, 3, 8, 8, 0, 0, DateTimeKind.Utc), slots[1].StartUtc);
    }

    [Fact]
    public void ExpandSlots_UnconfiguredOrMalformed_IsEmpty()
    {
        var day = new DateOnly(2026, 8, 3);
        Assert.Empty(AvailabilityService.ExpandSlotsUtc(null, day, "America/Chicago", 120));
        Assert.Empty(AvailabilityService.ExpandSlotsUtc("not json", day, "America/Chicago", 120));
        Assert.Empty(AvailabilityService.ExpandSlotsUtc(MonFri8To12, day, "Not/AZone", 120));
        Assert.Empty(AvailabilityService.ExpandSlotsUtc(
            """{"mon":[{"start":"12:00","end":"08:00"}]}""", day, "America/Chicago", 120));
    }

    // ── Endpoint + booking flow ──────────────────────────────────────────

    [Fact]
    public async Task Availability_UnconfiguredBrand_ReturnsEmptySlots()
    {
        await _factory.SeedBrandAsync("slot-none", "Slot None", "leads@sn.example");
        var device = Device("slot-none", "sn-dev");
        var resp = await device.GetFromJsonAsync<JsonElement>($"/api/availability?date={FutureDate}");
        Assert.Empty(resp.GetProperty("slots").EnumerateArray());
    }

    [Fact]
    public async Task Availability_IsPublic_NotAdminGated()
    {
        // No Basic auth, no session — just brand headers. 200, never 401.
        await _factory.SeedBrandAsync("slot-pub", "Slot Pub", "leads@sp.example");
        var device = Device("slot-pub", "sp-dev");
        var resp = await device.GetAsync($"/api/availability?date={FutureDate}");
        Assert.Equal(HttpStatusCode.OK, resp.StatusCode);
    }

    [Fact]
    public async Task CapacityOne_Book_SlotDisappears_SecondBook409_CancelReleases()
    {
        await _factory.SeedBrandAsync("slot-cap1", "Slot Cap1", "leads@sc.example",
            businessHoursJson: MonFri8To12, slotMinutes: 120, slotCapacity: 1, timeZoneId: "America/Chicago");
        var device = Device("slot-cap1", "sc-dev");

        // Two open slots (08–10, 10–12 local), capacity 1 each.
        var avail = await device.GetFromJsonAsync<JsonElement>($"/api/availability?date={FutureDate}");
        Assert.Equal(120, avail.GetProperty("slotMinutes").GetInt32());
        var slots = avail.GetProperty("slots").EnumerateArray().ToList();
        Assert.Equal(2, slots.Count);
        Assert.All(slots, s => Assert.Equal(1, s.GetProperty("remaining").GetInt32()));
        var slotStart = slots[0].GetProperty("start").GetString()!;

        // Book it → scheduled with ScheduledFor = the slot start.
        var book = await BookSlotAsync(device, slotStart);
        Assert.Equal(HttpStatusCode.Created, book.StatusCode);
        var jobId = (await book.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetInt32();
        var detail = await device.GetFromJsonAsync<JsonElement>($"/api/my/requests/{jobId}");
        Assert.Equal("scheduled", detail.GetProperty("status").GetString());
        Assert.Equal(DateTime.Parse(slotStart, null, System.Globalization.DateTimeStyles.AdjustToUniversal),
            detail.GetProperty("scheduledFor").GetDateTime());

        // The slot is gone from availability.
        avail = await device.GetFromJsonAsync<JsonElement>($"/api/availability?date={FutureDate}");
        var openStarts = avail.GetProperty("slots").EnumerateArray()
            .Select(s => s.GetProperty("start").GetString()).ToList();
        Assert.DoesNotContain(slotStart, openStarts);
        Assert.Single(openStarts);

        // Second booking of the same slot → 409 slot_taken, NOTHING persisted.
        int CountJobs()
        {
            using var scope = _factory.Services.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<DIYHelper2.Api.Data.AppDbContext>();
            return db.HelpRequests.Count(r => r.Brand == "slot-cap1");
        }
        var before = CountJobs();
        var second = await BookSlotAsync(Device("slot-cap1", "sc-dev2"), slotStart, "Loser booking");
        Assert.Equal(HttpStatusCode.Conflict, second.StatusCode);
        var err = await second.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("slot_taken", err.GetProperty("code").GetString());
        Assert.Equal(before, CountJobs());

        // Cancelling the job releases the seat — the slot reopens.
        var admin = _factory.CreateAdminClient();
        var cancel = await admin.PutAsJsonAsync($"/api/help-requests/{jobId}", new { status = "cancelled" });
        Assert.Equal(HttpStatusCode.OK, cancel.StatusCode);
        avail = await device.GetFromJsonAsync<JsonElement>($"/api/availability?date={FutureDate}");
        openStarts = avail.GetProperty("slots").EnumerateArray()
            .Select(s => s.GetProperty("start").GetString()).ToList();
        Assert.Contains(slotStart, openStarts);
    }

    [Fact]
    public async Task Claims_AreBrandIsolated()
    {
        await _factory.SeedBrandAsync("slot-iso-a", "Slot Iso A", "leads@sia.example",
            businessHoursJson: MonFri8To12, slotCapacity: 1);
        await _factory.SeedBrandAsync("slot-iso-b", "Slot Iso B", "leads@sib.example",
            businessHoursJson: MonFri8To12, slotCapacity: 1);

        var deviceA = Device("slot-iso-a", "sia-dev");
        var availA = await deviceA.GetFromJsonAsync<JsonElement>($"/api/availability?date={FutureDate}");
        var slotStart = availA.GetProperty("slots").EnumerateArray().First().GetProperty("start").GetString()!;

        // Brand A books the slot out.
        Assert.Equal(HttpStatusCode.Created, (await BookSlotAsync(deviceA, slotStart)).StatusCode);

        // The same wall-clock slot is still open for brand B.
        var deviceB = Device("slot-iso-b", "sib-dev");
        var availB = await deviceB.GetFromJsonAsync<JsonElement>($"/api/availability?date={FutureDate}");
        Assert.Contains(slotStart, availB.GetProperty("slots").EnumerateArray()
            .Select(s => s.GetProperty("start").GetString()));
    }

    // ── Owner scheduling config ──────────────────────────────────────────

    [Fact]
    public async Task SchedulingConfig_RoundTrips_AndValidates()
    {
        await _factory.SeedBrandAsync("slot-cfg", "Slot Cfg", "leads@scf.example");
        var admin = _factory.CreateAdminClient();

        var put = await admin.PutAsJsonAsync("/api/brands/slot-cfg/scheduling", new
        {
            businessHours = new { mon = new[] { new { start = "09:00", end = "17:00" } } },
            slotMinutes = 60,
            slotCapacity = 2,
            timeZoneId = "America/New_York",
        });
        Assert.Equal(HttpStatusCode.OK, put.StatusCode);

        var get = await admin.GetFromJsonAsync<JsonElement>("/api/brands/slot-cfg/scheduling");
        Assert.Equal(60, get.GetProperty("slotMinutes").GetInt32());
        Assert.Equal(2, get.GetProperty("slotCapacity").GetInt32());
        Assert.Equal("America/New_York", get.GetProperty("timeZoneId").GetString());
        Assert.Equal("09:00", get.GetProperty("businessHours").GetProperty("mon")[0].GetProperty("start").GetString());

        // Validation 400s: slot length, IANA zone, hours shape.
        Assert.Equal(HttpStatusCode.BadRequest, (await admin.PutAsJsonAsync(
            "/api/brands/slot-cfg/scheduling", new { slotMinutes = 5 })).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await admin.PutAsJsonAsync(
            "/api/brands/slot-cfg/scheduling", new { timeZoneId = "Central Time" })).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await admin.PutAsJsonAsync(
            "/api/brands/slot-cfg/scheduling",
            new { businessHours = new { mon = new[] { new { start = "17:00", end = "09:00" } } } })).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await admin.PutAsJsonAsync(
            "/api/brands/slot-cfg/scheduling",
            new { businessHours = new { funday = new[] { new { start = "09:00", end = "17:00" } } } })).StatusCode);
    }

    [Fact]
    public async Task SchedulingConfig_ScopedLogin_OtherBrand404s()
    {
        await _factory.SeedBrandAsync("slot-scope", "Slot Scope", "leads@ss.example",
            username: "slot-scope-admin", password: "slot-scope-pass");
        await _factory.SeedBrandAsync("slot-other", "Slot Other", "leads@so.example");

        var scoped = _factory.CreateBrandClient("slot-scope-admin", "slot-scope-pass");
        Assert.Equal(HttpStatusCode.NotFound,
            (await scoped.GetAsync("/api/brands/slot-other/scheduling")).StatusCode);
        Assert.Equal(HttpStatusCode.OK,
            (await scoped.GetAsync("/api/brands/slot-scope/scheduling")).StatusCode);
    }
}
