using DIYHelper2.Api.AI;
using Xunit;

namespace DIYHelper2.Tests;

public class HighRiskTaskClassifierTests
{
    [Fact]
    public void Assess_ReturnsSafe_ForNullOrEmpty()
    {
        Assert.False(HighRiskTaskClassifier.Assess(null).IsHighRisk);
        Assert.False(HighRiskTaskClassifier.Assess("").IsHighRisk);
        Assert.False(HighRiskTaskClassifier.Assess("   ").IsHighRisk);
    }

    [Fact]
    public void Assess_ReturnsSafe_ForBenignTask()
    {
        var result = HighRiskTaskClassifier.Assess("I want to hang a picture frame on a drywall wall");
        Assert.False(result.IsHighRisk);
        Assert.Empty(result.Categories);
    }

    [Theory]
    [InlineData("I need to rewire the kitchen outlets", "electrical")]
    [InlineData("How do I open the breaker panel safely?", "electrical")]
    [InlineData("Working with 240V dryer line", "electrical")]
    [InlineData("There's knob and tube wiring behind the wall", "electrical")]
    public void Assess_FlagsElectrical(string text, string expected)
    {
        var result = HighRiskTaskClassifier.Assess(text);
        Assert.True(result.IsHighRisk);
        Assert.Contains(expected, result.Categories);
    }

    [Theory]
    [InlineData("I smell gas near the stove pilot light")]
    [InlineData("Need to replace a gas valve on the water heater")]
    [InlineData("How do I cap an old gas line?")]
    public void Assess_FlagsGas(string text)
    {
        var result = HighRiskTaskClassifier.Assess(text);
        Assert.True(result.IsHighRisk);
        Assert.Contains("gas", result.Categories);
    }

    [Theory]
    [InlineData("Removing a load-bearing wall in the basement")]
    [InlineData("Need to cut into a support beam to run a duct")]
    public void Assess_FlagsStructural(string text)
    {
        var result = HighRiskTaskClassifier.Assess(text);
        Assert.True(result.IsHighRisk);
        Assert.Contains("structural", result.Categories);
    }

    [Fact]
    public void Assess_FlagsRoofing()
    {
        var result = HighRiskTaskClassifier.Assess("I need to climb on the roof to fix a leak");
        Assert.True(result.IsHighRisk);
        Assert.Contains("roofing", result.Categories);
    }

    [Fact]
    public void Assess_FlagsGarageSpring()
    {
        var result = HighRiskTaskClassifier.Assess("My garage door spring snapped");
        Assert.True(result.IsHighRisk);
        Assert.Contains("garage_spring", result.Categories);
    }

    [Fact]
    public void Assess_FlagsHeavyMachinery()
    {
        var result = HighRiskTaskClassifier.Assess("Renting an excavator to dig a trench");
        Assert.True(result.IsHighRisk);
        Assert.Contains("heavy_machinery", result.Categories);
    }

    [Fact]
    public void Assess_DoesNotFlagBenignElectricalAdjacent()
    {
        // "outlet" alone is too generic — caulking around an outlet, painting around outlets, etc.
        // We only flag concrete dangerous-action phrases.
        var result = HighRiskTaskClassifier.Assess("I want to paint around my outlets");
        Assert.False(result.IsHighRisk);
    }

    [Fact]
    public void Assess_ReturnsAllMatchedCategories()
    {
        var result = HighRiskTaskClassifier.Assess("Replacing a gas line in the attic, also need to walk the roof");
        Assert.True(result.IsHighRisk);
        Assert.Contains("gas", result.Categories);
        Assert.Contains("roofing", result.Categories);
    }

    [Fact]
    public void WarningFor_ReturnsCategorySpecificText()
    {
        Assert.Contains("electrician", HighRiskTaskClassifier.WarningFor("electrical"));
        Assert.Contains("gas", HighRiskTaskClassifier.WarningFor("gas"));
        Assert.Contains("structural engineer", HighRiskTaskClassifier.WarningFor("structural"));
        Assert.Contains("roofer", HighRiskTaskClassifier.WarningFor("roofing"));
        Assert.Contains("garage door", HighRiskTaskClassifier.WarningFor("garage_spring"));
    }

    [Fact]
    public void WarningFor_HasFallback_ForUnknownCategory()
    {
        var warning = HighRiskTaskClassifier.WarningFor("not-a-real-category");
        Assert.False(string.IsNullOrWhiteSpace(warning));
    }
}
