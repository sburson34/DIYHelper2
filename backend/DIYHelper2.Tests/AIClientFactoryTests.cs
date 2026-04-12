using DIYHelper2.Api.AI;
using Microsoft.Extensions.Logging;
using Moq;
using Xunit;

namespace DIYHelper2.Tests;

public class AIClientFactoryTests
{
    private readonly Mock<IAIVisionClient> _mockOpenAi = new();
    private readonly Mock<IAIVisionClient> _mockAnthropic = new();
    private readonly Mock<ILogger<AIClientFactory>> _mockLogger = new();

    private AIClientFactory CreateFactory(string mode, IAIVisionClient? anthropic = null)
    {
        return new AIClientFactory(_mockOpenAi.Object, anthropic, mode, _mockLogger.Object);
    }

    [Fact]
    public async Task DefaultMode_UsesOpenAI()
    {
        _mockOpenAi.Setup(c => c.CompleteAsync(It.IsAny<AIChatRequest>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync("openai response");

        var factory = CreateFactory("openai");
        var request = new AIChatRequest("sys", "user", Array.Empty<AIImagePart>());
        var result = await factory.CompleteAsync(request);

        Assert.Equal("openai response", result);
        _mockOpenAi.Verify(c => c.CompleteAsync(request, It.IsAny<CancellationToken>()), Times.Once);
    }

    [Fact]
    public async Task AnthropicMode_UsesAnthropic()
    {
        _mockAnthropic.Setup(c => c.CompleteAsync(It.IsAny<AIChatRequest>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync("anthropic response");

        var factory = CreateFactory("anthropic", _mockAnthropic.Object);
        var request = new AIChatRequest("sys", "user", Array.Empty<AIImagePart>());
        var result = await factory.CompleteAsync(request);

        Assert.Equal("anthropic response", result);
    }

    [Fact]
    public async Task AnthropicMode_ThrowsWhenNotConfigured()
    {
        var factory = CreateFactory("anthropic", null);
        var request = new AIChatRequest("sys", "user", Array.Empty<AIImagePart>());

        await Assert.ThrowsAsync<InvalidOperationException>(() => factory.CompleteAsync(request));
    }

    [Fact]
    public async Task FallbackMode_FallsBackToAnthropic_OnOpenAIFailure()
    {
        _mockOpenAi.Setup(c => c.CompleteAsync(It.IsAny<AIChatRequest>(), It.IsAny<CancellationToken>()))
            .ThrowsAsync(new HttpRequestException("OpenAI down"));

        _mockAnthropic.Setup(c => c.CompleteAsync(It.IsAny<AIChatRequest>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync("anthropic fallback");

        var factory = CreateFactory("openai-with-anthropic-fallback", _mockAnthropic.Object);
        var request = new AIChatRequest("sys", "user", Array.Empty<AIImagePart>());
        var result = await factory.CompleteAsync(request);

        Assert.Equal("anthropic fallback", result);
        _mockOpenAi.Verify(c => c.CompleteAsync(request, It.IsAny<CancellationToken>()), Times.Once);
        _mockAnthropic.Verify(c => c.CompleteAsync(request, It.IsAny<CancellationToken>()), Times.Once);
    }

    [Fact]
    public async Task FallbackMode_UsesOpenAI_WhenItSucceeds()
    {
        _mockOpenAi.Setup(c => c.CompleteAsync(It.IsAny<AIChatRequest>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync("openai ok");

        var factory = CreateFactory("openai-with-anthropic-fallback", _mockAnthropic.Object);
        var request = new AIChatRequest("sys", "user", Array.Empty<AIImagePart>());
        var result = await factory.CompleteAsync(request);

        Assert.Equal("openai ok", result);
        _mockAnthropic.Verify(c => c.CompleteAsync(It.IsAny<AIChatRequest>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    [Fact]
    public async Task FallbackMode_PropagatesError_WhenNoAnthropicConfigured()
    {
        _mockOpenAi.Setup(c => c.CompleteAsync(It.IsAny<AIChatRequest>(), It.IsAny<CancellationToken>()))
            .ThrowsAsync(new HttpRequestException("OpenAI down"));

        var factory = CreateFactory("openai-with-anthropic-fallback", null);
        var request = new AIChatRequest("sys", "user", Array.Empty<AIImagePart>());

        await Assert.ThrowsAsync<HttpRequestException>(() => factory.CompleteAsync(request));
    }
}
