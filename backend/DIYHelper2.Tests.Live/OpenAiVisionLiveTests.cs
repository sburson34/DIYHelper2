using DIYHelper2.Api.AI;
using Microsoft.Extensions.Logging.Abstractions;

namespace DIYHelper2.Tests.Live;

/// <summary>
/// Real-network contract test against OpenAI's vision endpoint. Verifies the
/// SDK's request shape still matches what we wire up in
/// <see cref="DIYHelper2.Api.AI.OpenAIVisionClient"/> after an SDK bump.
///
/// Cost target: &lt; $0.001 per run. Uses a 1×1 PNG so the image-tokens
/// fee is negligible. Skipped unless RUN_LIVE_CONTRACT=true + OPENAI_API_KEY
/// are set in the env.
/// </summary>
public class OpenAiVisionLiveTests
{
    // Smallest valid PNG: 1×1 transparent pixel.
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

    [LiveContractFact("OPENAI_API_KEY")]
    public async Task OpenAiVisionClient_ReturnsNonEmptyResponse_For1x1Png()
    {
        var apiKey = Environment.GetEnvironmentVariable("OPENAI_API_KEY")!;
        var client = new OpenAIVisionClient(apiKey, NullLogger<OpenAIVisionClient>.Instance);

        var request = new AIChatRequest(
            System: "Reply with the single word OK.",
            User: "Acknowledge.",
            Images: new List<AIImagePart> { new(OnePixelPng, "image/png") },
            Timeout: TimeSpan.FromSeconds(30));

        var result = await client.CompleteAsync(request);
        Assert.False(string.IsNullOrWhiteSpace(result),
            "OpenAI vision returned an empty response — the SDK or the auth path likely regressed.");
    }
}
