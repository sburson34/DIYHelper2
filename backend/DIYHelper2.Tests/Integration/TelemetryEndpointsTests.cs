using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using DIYHelper2.Api.Data;
using DIYHelper2.Tests.Infrastructure;
using Microsoft.Extensions.DependencyInjection;
using Xunit;

namespace DIYHelper2.Tests.Integration;

/// <summary>
/// Anonymous telemetry ingest persists events; the usage-digest endpoint
/// returns an aggregated rollup (open in the Testing host environment via the
/// shared UsageDigestGate). The ingest endpoint needs no auth by design.
/// </summary>
[Collection("SerialEnv")]
public class TelemetryEndpointsTests : IClassFixture<ApiFactory>
{
    private readonly ApiFactory _factory;
    public TelemetryEndpointsTests(ApiFactory factory) => _factory = factory;

    private record EventDto(string Name, Guid AnonId, Guid SessionId, DateTime ClientTs,
        string? AppVersion, string? Platform, object? Props);
    private record BatchDto(List<EventDto> Events);

    [Fact]
    public async Task Ingest_IsAnonymous_AndPersists()
    {
        var client = _factory.CreateClient();
        var anon = Guid.NewGuid();
        var session = Guid.NewGuid();
        var batch = new BatchDto(new()
        {
            new("app_opened", anon, session, DateTime.UtcNow, "1.0.0", "android", null),
            new("screen_viewed", anon, session, DateTime.UtcNow, "1.0.0", "android", new { screen = "Home" }),
        });

        var resp = await client.PostAsJsonAsync("/api/telemetry/events", batch);
        Assert.Equal(HttpStatusCode.Accepted, resp.StatusCode);

        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        Assert.Equal(2, db.AnalyticsEvents.Count(e => e.AnonId == anon));
    }

    [Fact]
    public async Task Digest_ReturnsAggregatedRollup()
    {
        var client = _factory.CreateClient();
        var anon = Guid.NewGuid();
        var session = Guid.NewGuid();
        var batch = new BatchDto(new()
        {
            new("app_opened", anon, session, DateTime.UtcNow, "1.0.0", "android", null),
            new("screen_viewed", anon, session, DateTime.UtcNow, "1.0.0", "android", new { screen = "DigestHome" }),
        });
        await client.PostAsJsonAsync("/api/telemetry/events", batch);

        var digest = await client.GetFromJsonAsync<JsonElement>("/api/admin/usage-digest?days=30");

        Assert.True(digest.GetProperty("totalEvents").GetInt64() >= 2);
        var screens = digest.GetProperty("screens").EnumerateArray()
            .Select(s => s.GetProperty("screen").GetString()).ToList();
        Assert.Contains("DigestHome", screens);
    }

    [Fact]
    public async Task Ingest_StampsBrand_FromXBrandHeader()
    {
        var client = _factory.CreateClient();
        var anon = Guid.NewGuid();
        var batch = new BatchDto(new()
        {
            new("app_opened", anon, Guid.NewGuid(), DateTime.UtcNow, "1.0.0", "ios", null),
        });

        using var req = new HttpRequestMessage(HttpMethod.Post, "/api/telemetry/events")
        {
            Content = JsonContent.Create(batch),
        };
        req.Headers.Add("X-Brand", "Acme-Plumbing"); // mixed case → normalised lower
        var resp = await client.SendAsync(req);
        Assert.Equal(HttpStatusCode.Accepted, resp.StatusCode);

        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var row = db.AnalyticsEvents.Single(e => e.AnonId == anon);
        Assert.Equal("acme-plumbing", row.Brand);
    }

    [Fact]
    public async Task Ingest_LeavesBrandNull_WhenHeaderAbsent()
    {
        var client = _factory.CreateClient();
        var anon = Guid.NewGuid();
        var batch = new BatchDto(new()
        {
            new("app_opened", anon, Guid.NewGuid(), DateTime.UtcNow, "1.0.0", "ios", null),
        });

        await client.PostAsJsonAsync("/api/telemetry/events", batch);

        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var row = db.AnalyticsEvents.Single(e => e.AnonId == anon);
        Assert.Null(row.Brand);
    }

    [Fact]
    public async Task BrandMau_ReturnsPerBrandActiveInstallCounts()
    {
        var client = _factory.CreateClient();
        var brand = "mau-brand-" + Guid.NewGuid().ToString("N")[..8];
        var anonA = Guid.NewGuid();
        var anonB = Guid.NewGuid();

        // Two distinct installs for this brand, three events (anonA appears twice).
        async Task Post(Guid anon, string name)
        {
            using var req = new HttpRequestMessage(HttpMethod.Post, "/api/telemetry/events")
            {
                Content = JsonContent.Create(new BatchDto(new()
                {
                    new(name, anon, Guid.NewGuid(), DateTime.UtcNow, "1.0.0", "ios", null),
                })),
            };
            req.Headers.Add("X-Brand", brand);
            (await client.SendAsync(req)).EnsureSuccessStatusCode();
        }
        await Post(anonA, "app_opened");
        await Post(anonA, "screen_viewed");
        await Post(anonB, "app_opened");

        var rows = await client.GetFromJsonAsync<JsonElement>("/api/admin/brand-mau?days=30");
        var mine = rows.EnumerateArray().Single(r => r.GetProperty("brand").GetString() == brand);

        Assert.Equal(2, mine.GetProperty("activeInstalls").GetInt32()); // distinct installs
        Assert.Equal(3, mine.GetProperty("events").GetInt64());
    }
}
