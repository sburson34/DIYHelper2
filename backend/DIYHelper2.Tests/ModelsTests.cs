using DIYHelper2.Api.Models;
using DIYHelper2.Api.AI;
using DIYHelper2.Api.Integrations;
using Xunit;

namespace DIYHelper2.Tests;

public class ModelsTests
{
    [Fact]
    public void BetaFeedback_DefaultValues()
    {
        var feedback = new BetaFeedback();
        Assert.Equal(string.Empty, feedback.ClientId);
        Assert.Equal(string.Empty, feedback.Description);
        Assert.Null(feedback.WhatYouWereDoing);
        Assert.Null(feedback.ReproSteps);
        Assert.Null(feedback.AppVersion);
        Assert.Null(feedback.Platform);
        Assert.True(feedback.CreatedAt <= DateTime.UtcNow);
        Assert.True(feedback.CreatedAt > DateTime.UtcNow.AddSeconds(-5));
    }

    [Fact]
    public void BetaFeedback_SetProperties()
    {
        var feedback = new BetaFeedback
        {
            Id = 1,
            ClientId = "fb-123",
            Description = "Bug report",
            WhatYouWereDoing = "Testing",
            ReproSteps = "Step 1",
            AppVersion = "1.0.0",
            BuildNumber = "42",
            Platform = "android",
            OsVersion = "33",
            Environment = "beta",
            GitCommit = "abc123",
            CurrentScreen = "CaptureScreen",
            CorrelationId = "corr-123",
        };

        Assert.Equal(1, feedback.Id);
        Assert.Equal("fb-123", feedback.ClientId);
        Assert.Equal("Bug report", feedback.Description);
        Assert.Equal("android", feedback.Platform);
    }

    [Fact]
    public void AIImagePart_Record()
    {
        var data = new byte[] { 1, 2, 3 };
        var part = new AIImagePart(data, "image/jpeg");
        Assert.Equal(data, part.Data);
        Assert.Equal("image/jpeg", part.MimeType);
    }

    [Fact]
    public void AIChatRequest_Record()
    {
        var images = new List<AIImagePart> { new(new byte[] { 1 }, "image/png") };
        var request = new AIChatRequest("system prompt", "user prompt", images, TimeSpan.FromSeconds(30));
        Assert.Equal("system prompt", request.System);
        Assert.Equal("user prompt", request.User);
        Assert.Single(request.Images);
        Assert.Equal(TimeSpan.FromSeconds(30), request.Timeout);
    }

    [Fact]
    public void AIChatRequest_DefaultTimeout_IsNull()
    {
        var request = new AIChatRequest("sys", "user", Array.Empty<AIImagePart>());
        Assert.Null(request.Timeout);
    }

    [Fact]
    public void PropertyValueImpact_Record()
    {
        var impact = new PropertyValueImpact(7500, "medium", "attom");
        Assert.Equal(7500, impact.EstimatedValueAdd);
        Assert.Equal("medium", impact.Confidence);
        Assert.Equal("attom", impact.Source);
    }

    [Fact]
    public void PaintColor_Record()
    {
        var color = new PaintColor("Sherwin-Williams", "Alabaster", "SW 7008", "#EDEAE0");
        Assert.Equal("Sherwin-Williams", color.Brand);
        Assert.Equal("#EDEAE0", color.Hex);
    }

    [Fact]
    public void PaintMatch_Record()
    {
        var match = new PaintMatch("BM", "White", "OC-17", "#FFF", 3.5);
        Assert.Equal(3.5, match.DeltaE);
    }

    [Fact]
    public void PaintMatchResult_Record()
    {
        var matches = new List<PaintMatch> { new("BM", "White", "OC-17", "#FFF", 3.5) };
        var result = new PaintMatchResult("#FF0000", matches);
        Assert.Equal("#FF0000", result.DominantHex);
        Assert.Single(result.Matches);
    }
}
