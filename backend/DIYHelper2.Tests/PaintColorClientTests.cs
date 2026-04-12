using DIYHelper2.Api.Integrations;
using Microsoft.Extensions.Logging;
using Moq;
using Xunit;

namespace DIYHelper2.Tests;

public class PaintColorClientTests
{
    private readonly PaintColorClient _client;

    public PaintColorClientTests()
    {
        var logger = new Mock<ILogger<PaintColorClient>>();
        _client = new PaintColorClient(logger.Object);
    }

    [Fact]
    public void Match_ReturnsResults_ForAnyImageData()
    {
        // Create a fake image buffer large enough for the sampling algorithm
        var data = new byte[2048];
        new Random(42).NextBytes(data);

        var result = _client.Match(data, 3);

        Assert.NotNull(result);
        Assert.NotNull(result.DominantHex);
        Assert.StartsWith("#", result.DominantHex);
        Assert.Equal(3, result.Matches.Count);
    }

    [Fact]
    public void Match_ReturnsGray_ForSmallData()
    {
        // Data too small for sampling (< 512 + 3 bytes)
        var data = new byte[100];
        var result = _client.Match(data, 3);
        Assert.Equal("#808080", result.DominantHex);
    }

    [Fact]
    public void Match_ResultsAreSortedByDeltaE()
    {
        var data = new byte[4096];
        new Random(99).NextBytes(data);

        var result = _client.Match(data, 5);

        for (int i = 1; i < result.Matches.Count; i++)
        {
            Assert.True(result.Matches[i].DeltaE >= result.Matches[i - 1].DeltaE,
                $"Match {i} DeltaE ({result.Matches[i].DeltaE}) should be >= Match {i - 1} ({result.Matches[i - 1].DeltaE})");
        }
    }

    [Fact]
    public void Match_MatchesContainValidData()
    {
        var data = new byte[2048];
        new Random(7).NextBytes(data);

        var result = _client.Match(data, 1);
        var match = result.Matches[0];

        Assert.NotEmpty(match.Brand);
        Assert.NotEmpty(match.Name);
        Assert.NotEmpty(match.Code);
        Assert.StartsWith("#", match.Hex);
        Assert.True(match.DeltaE >= 0);
    }

    [Fact]
    public void Match_TopKLimitsResults()
    {
        var data = new byte[2048];
        new Random(42).NextBytes(data);

        var result1 = _client.Match(data, 1);
        Assert.Single(result1.Matches);

        var result5 = _client.Match(data, 5);
        Assert.Equal(5, result5.Matches.Count);
    }

    [Fact]
    public void Match_DefaultPaletteHas25Colors()
    {
        var data = new byte[2048];
        new Random(42).NextBytes(data);

        // Request all — default palette has 25
        var result = _client.Match(data, 100);
        Assert.Equal(25, result.Matches.Count);
    }
}
