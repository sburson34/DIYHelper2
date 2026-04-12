using DIYHelper2.Api.Integrations;
using Microsoft.Extensions.Logging;
using Moq;
using Xunit;

namespace DIYHelper2.Tests;

public class AttomClientTests : IDisposable
{
    private readonly Mock<ILogger<AttomClient>> _mockLogger = new();

    public AttomClientTests()
    {
        // Ensure ATTOM_API_KEY is not set for most tests
        Environment.SetEnvironmentVariable("ATTOM_API_KEY", null);
    }

    public void Dispose()
    {
        Environment.SetEnvironmentVariable("ATTOM_API_KEY", null);
    }

    private AttomClient CreateClient()
    {
        return new AttomClient(new HttpClient(), _mockLogger.Object);
    }

    [Fact]
    public void IsConfigured_FalseByDefault()
    {
        var client = CreateClient();
        Assert.False(client.IsConfigured);
    }

    [Fact]
    public void IsConfigured_TrueWhenKeySet()
    {
        Environment.SetEnvironmentVariable("ATTOM_API_KEY", "test-key");
        var client = CreateClient();
        Assert.True(client.IsConfigured);
    }

    [Fact]
    public async Task EstimateAsync_ReturnsStaticEstimate_WhenNotConfigured()
    {
        var client = CreateClient();
        var result = await client.EstimateAsync("90210", "kitchen", 10000);

        Assert.NotNull(result);
        Assert.Equal("static", result.Source);
        Assert.Equal("low", result.Confidence);
        Assert.Equal(7500, result.EstimatedValueAdd); // kitchen = 0.75 * 10000
    }

    [Theory]
    [InlineData("kitchen", 0.75)]
    [InlineData("bathroom", 0.60)]
    [InlineData("roof", 0.60)]
    [InlineData("flooring", 0.70)]
    [InlineData("windows", 0.70)]
    [InlineData("deck", 0.65)]
    [InlineData("exterior_paint", 0.55)]
    [InlineData("interior_paint", 0.40)]
    [InlineData("plumbing", 0.45)]
    [InlineData("electrical", 0.45)]
    [InlineData("hvac", 0.50)]
    [InlineData("landscaping", 0.50)]
    [InlineData("garage", 0.60)]
    [InlineData("basement", 0.70)]
    [InlineData("drywall", 0.40)]
    [InlineData("general", 0.50)]
    public async Task EstimateAsync_UsesCorrectMultiplier(string repairType, double expectedMultiplier)
    {
        var client = CreateClient();
        var result = await client.EstimateAsync("12345", repairType, 10000);

        Assert.NotNull(result);
        Assert.Equal(Math.Round(10000 * expectedMultiplier, 0), result.EstimatedValueAdd);
    }

    [Fact]
    public async Task EstimateAsync_UsesDefaultMultiplier_ForUnknownRepairType()
    {
        var client = CreateClient();
        var result = await client.EstimateAsync("12345", "unknown_type", 10000);

        Assert.NotNull(result);
        Assert.Equal(5000, result.EstimatedValueAdd); // default 0.5
    }

    [Fact]
    public async Task EstimateAsync_UsesDefaultMultiplier_ForNullRepairType()
    {
        var client = CreateClient();
        var result = await client.EstimateAsync("12345", null!, 10000);

        Assert.Equal(5000, result.EstimatedValueAdd);
    }

    [Fact]
    public async Task EstimateAsync_IsCaseInsensitive()
    {
        var client = CreateClient();
        var result = await client.EstimateAsync("12345", "KITCHEN", 10000);

        Assert.Equal(7500, result.EstimatedValueAdd);
    }
}
