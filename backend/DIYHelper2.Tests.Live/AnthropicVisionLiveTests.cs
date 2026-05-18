using DIYHelper2.Api.AI;
using Microsoft.Extensions.Logging.Abstractions;

namespace DIYHelper2.Tests.Live;

/// <summary>
/// Real-network contract test against Anthropic's vision endpoint. Mirrors
/// <see cref="OpenAiVisionLiveTests"/> for the Claude fallback path.
///
/// Cost target: &lt; $0.001 per run on Claude 3 Haiku. Skipped unless
/// RUN_LIVE_CONTRACT=true + ANTHROPIC_API_KEY are set.
/// </summary>
public class AnthropicVisionLiveTests
{
    private static readonly byte[] OnePixelPng = new byte[]
    {
        0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A,
        0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52,
        0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
        0x08, 0x06, 0x00, 0x00, 0x00, 0x1F, 0x15, 0xC4,
        0x89, 0x00, 0x00, 0x00, 0x0D, 0x49, 0x44, 0x41,
        0x54, 0x78, 0x9C, 0x63, 0x00, 0x01, 0x00, 0x00,
        0x05, 0x00, 0x01, 0x0D, 0x0A, 0x2D, 0xB4, 0x00,
        0x00, 0x00, 0x00, 0x49, 0x45, 0x4E, 0x44, 0xAE,
        0x42, 0x60, 0x82,
    };

    [LiveContractFact("ANTHROPIC_API_KEY")]
    public async Task AnthropicVisionClient_ReturnsNonEmptyResponse_For1x1Png()
    {
        var apiKey = Environment.GetEnvironmentVariable("ANTHROPIC_API_KEY")!;
        using var http = new HttpClient();
        var client = new AnthropicVisionClient(http, apiKey, NullLogger<AnthropicVisionClient>.Instance);

        var request = new AIChatRequest(
            System: "Reply with the single word OK.",
            User: "Acknowledge.",
            Images: new List<AIImagePart> { new(OnePixelPng, "image/png") },
            Timeout: TimeSpan.FromSeconds(30));

        var result = await client.CompleteAsync(request);
        Assert.False(string.IsNullOrWhiteSpace(result),
            "Anthropic vision returned an empty response — the SDK or the auth path likely regressed.");
    }
}
