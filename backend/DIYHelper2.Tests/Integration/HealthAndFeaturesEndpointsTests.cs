using System.Net;
using System.Net.Http.Json;
using DIYHelper2.Tests.Infrastructure;

namespace DIYHelper2.Tests.Integration;

/// <summary>
/// Smoke tests for endpoints that power the app's boot-time health + feature
/// polling. These are the canaries for startup wiring — CORS, DI, middleware,
/// and rate-limiter registration.
/// </summary>
public class HealthAndFeaturesEndpointsTests : IClassFixture<ApiFactory>
{
    private readonly ApiFactory _factory;

    public HealthAndFeaturesEndpointsTests(ApiFactory factory) => _factory = factory;

    [Fact]
    public async Task Root_ReturnsRunningMessage()
    {
        var client = _factory.CreateClient();
        var response = await client.GetAsync("/");
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        Assert.Contains("DIYHelper2 API is running", body);
    }

    [Fact]
    public async Task Health_Returns200AndHealthyStatus()
    {
        var client = _factory.CreateClient();
        var response = await client.GetAsync("/api/health");
        var body = await response.Content.ReadAsStringAsync();
        Assert.True(response.StatusCode == HttpStatusCode.OK,
            $"Expected 200 OK, got {(int)response.StatusCode} {response.StatusCode}. Body: {body}");

        var payload = await response.Content.ReadFromJsonAsync<HealthResponse>();
        Assert.NotNull(payload);
        Assert.Equal("healthy", payload!.status);
    }

    [Fact]
    public async Task Health_ReturnsCorrelationIdHeader()
    {
        var client = _factory.CreateClient();
        var response = await client.GetAsync("/api/health");
        Assert.True(response.Headers.Contains("X-Correlation-ID"),
            "Health responses must echo a correlation ID for trace linking.");
    }

    [Fact]
    public async Task Features_Returns200AndFlagShape()
    {
        var client = _factory.CreateClient();
        var response = await client.GetAsync("/api/features");
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);

        var body = await response.Content.ReadAsStringAsync();
        // The shape is a camelCase flag object — assert a few stable keys exist.
        Assert.Contains("\"amazonPa\"", body);
        Assert.Contains("\"youtube\"", body);
        Assert.Contains("\"pubChem\"", body, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task Emergency_ReturnsStaticCategories()
    {
        var client = _factory.CreateClient();
        var response = await client.GetAsync("/api/emergency");
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);

        var body = await response.Content.ReadAsStringAsync();
        foreach (var expectedCategory in new[] { "water", "electric", "gas", "fire" })
            Assert.Contains($"\"id\":\"{expectedCategory}\"", body);
    }

    private record HealthResponse(string status, DateTime timestamp);
}
