using DIYHelper2.Api.Integrations;
using Xunit;

namespace DIYHelper2.Tests;

public class FeatureFlagsTests : IDisposable
{
    private readonly List<string> _setVars = new();

    private void SetEnv(string name, string? value)
    {
        Environment.SetEnvironmentVariable(name, value);
        _setVars.Add(name);
    }

    public void Dispose()
    {
        foreach (var name in _setVars)
            Environment.SetEnvironmentVariable(name, null);
    }

    [Fact]
    public void Defaults_AreCorrect()
    {
        // Clear all feature vars first
        SetEnv("FEATURES_AMAZON_PA", null);
        SetEnv("FEATURES_ATTOM", null);
        SetEnv("FEATURES_PAINT_COLORS", null);
        SetEnv("FEATURES_CLAUDE_FALLBACK", null);
        SetEnv("YOUTUBE_API_KEY", null);
        SetEnv("OPENWEATHER_API_KEY", null);
        SetEnv("FEATURES_REDDIT", null);
        SetEnv("FEATURES_PUBCHEM", null);
        SetEnv("MINDEE_API_KEY", null);

        var flags = new FeatureFlags();

        Assert.False(flags.AmazonPa);
        Assert.False(flags.Attom);
        Assert.False(flags.PaintColors);
        Assert.False(flags.ClaudeFallback);
        Assert.False(flags.YouTube);
        Assert.False(flags.Weather);
        Assert.True(flags.Reddit);  // default ON
        Assert.True(flags.PubChem); // default ON
        Assert.False(flags.ReceiptOcr);
    }

    [Fact]
    public void ReadsTrue_FromEnvVar()
    {
        SetEnv("FEATURES_AMAZON_PA", "true");
        SetEnv("FEATURES_ATTOM", "1");
        var flags = new FeatureFlags();
        Assert.True(flags.AmazonPa);
        Assert.True(flags.Attom);
    }

    [Fact]
    public void YouTube_EnabledWhenKeySet()
    {
        SetEnv("YOUTUBE_API_KEY", "fake-key");
        var flags = new FeatureFlags();
        Assert.True(flags.YouTube);
    }

    [Fact]
    public void Weather_EnabledWhenKeySet()
    {
        SetEnv("OPENWEATHER_API_KEY", "fake-key");
        var flags = new FeatureFlags();
        Assert.True(flags.Weather);
    }

    [Fact]
    public void ReceiptOcr_EnabledWhenMindeeKeySet()
    {
        SetEnv("MINDEE_API_KEY", "fake-key");
        var flags = new FeatureFlags();
        Assert.True(flags.ReceiptOcr);
    }

    [Fact]
    public void Reddit_CanBeDisabled()
    {
        SetEnv("FEATURES_REDDIT", "false");
        var flags = new FeatureFlags();
        Assert.False(flags.Reddit);
    }

    [Fact]
    public void ToPublicJson_ReturnsCamelCaseObject()
    {
        SetEnv("FEATURES_AMAZON_PA", null);
        var flags = new FeatureFlags();
        var json = flags.ToPublicJson();
        var props = json.GetType().GetProperties();
        var names = props.Select(p => p.Name).ToList();
        Assert.Contains("amazonPa", names);
        Assert.Contains("youtube", names);
        Assert.Contains("receiptOcr", names);
    }
}
