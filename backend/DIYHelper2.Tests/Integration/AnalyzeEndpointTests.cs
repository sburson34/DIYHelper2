using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using DIYHelper2.Tests.Infrastructure;

namespace DIYHelper2.Tests.Integration;

/// <summary>
/// Exercises the full <c>/api/analyze</c> pipeline with a stubbed
/// <see cref="DIYHelper2.Api.AI.IAIVisionClient"/>. Covers:
///   • request decoding (description + base64 image + skill level)
///   • AI call shape (system prompt, user prompt, image bytes)
///   • JSON extraction from markdown-fenced AI responses
///   • shopping-link affiliate URL rewriting (Amazon associate tag, Home Depot id)
///   • YouTube query → link fallback when YouTube API is not configured
///   • response surfaces the canned title + steps back to the caller.
///
/// Uses <see cref="ApiFactory"/>'s injectable <see cref="FakeAIVisionClient"/>
/// so tests never hit a real LLM.
/// </summary>
public class AnalyzeEndpointTests : IClassFixture<ApiFactory>, IAsyncLifetime
{
    private readonly ApiFactory _factory;

    public AnalyzeEndpointTests(ApiFactory factory) => _factory = factory;

    public Task InitializeAsync()
    {
        _factory.SetOpenAiKey("test-key");
        _factory.FakeAi.Requests.Clear();
        _factory.FakeAi.Responder = _ => Task.FromResult(CannedAnalysisJson);
        return Task.CompletedTask;
    }

    public Task DisposeAsync() => Task.CompletedTask;

    // Realistic canned AI response. Markdown code fence is intentional — the
    // JsonExtractor in AiWorkflow must strip it. shopping_links are plain
    // strings (what GPT-4o returns); the handler is expected to rewrite them
    // into affiliate URL objects. youtube_queries is set; YouTube client is
    // not configured in tests so the handler falls back to search URLs.
    private const string CannedAnalysisJson = """
        ```json
        {
          "title": "Replace kitchen faucet cartridge",
          "steps": [
            { "text": "Shut off water under sink.", "reference_image_search": null },
            { "text": "Unscrew cartridge retainer.", "reference_image_search": "moen cartridge retainer" }
          ],
          "tools_and_materials": ["adjustable wrench", "Moen 1225 cartridge"],
          "difficulty": "easy",
          "estimated_time": "30 minutes",
          "estimated_cost": "$25-$40",
          "youtube_queries": ["moen cartridge replacement", "kitchen faucet repair"],
          "shopping_links": ["Moen 1225 cartridge", "plumber's grease"],
          "safety_tips": ["Turn off water first."],
          "when_to_call_pro": ["Leak persists after cartridge swap."],
          "permit_required": false,
          "outdoor": false,
          "repair_type": "plumbing"
        }
        ```
        """;

    [Fact]
    public async Task Analyze_ReturnsPipelineResult_WithAffiliateLinks()
    {
        var client = _factory.CreateClient();

        // A tiny base64 image is enough — we don't actually decode it meaningfully,
        // the handler just forwards bytes to the (fake) AI client.
        var imageBytes = new byte[] { 0xFF, 0xD8, 0xFF, 0xE0 }; // JPEG magic
        var payload = new
        {
            description = "kitchen faucet drips from spout base",
            language = "en",
            skillLevel = "intermediate",
            media = new[]
            {
                new { type = "image", mimeType = "image/jpeg", base64 = Convert.ToBase64String(imageBytes) },
            },
        };

        var response = await client.PostAsJsonAsync("/api/analyze", payload);

        var body = await response.Content.ReadAsStringAsync();
        Assert.True(response.StatusCode == HttpStatusCode.OK,
            $"Expected 200 OK, got {(int)response.StatusCode}. Body: {body}");

        // ── AI client was called with the expected shape ──
        Assert.Single(_factory.FakeAi.Requests);
        var aiCall = _factory.FakeAi.Requests[0];

        Assert.Contains("DIY project assistant", aiCall.System);
        Assert.Contains("kitchen faucet drips from spout base", aiCall.User);
        Assert.Contains("intermediate DIYer", aiCall.User);
        Assert.Single(aiCall.Images);
        Assert.Equal("image/jpeg", aiCall.Images[0].MimeType);
        Assert.Equal(imageBytes, aiCall.Images[0].Data);

        // ── Response body shape ──
        using var doc = JsonDocument.Parse(body);
        var root = doc.RootElement;

        Assert.Equal("Replace kitchen faucet cartridge", root.GetProperty("title").GetString());
        Assert.Equal(2, root.GetProperty("steps").GetArrayLength());
        Assert.Equal("plumbing", root.GetProperty("repair_type").GetString());

        // ── Affiliate rewriting on shopping_links ──
        var shoppingLinks = root.GetProperty("shopping_links");
        Assert.Equal(2, shoppingLinks.GetArrayLength());
        var firstLink = shoppingLinks[0];
        Assert.Equal("Moen 1225 cartridge", firstLink.GetProperty("item").GetString());
        var amazonUrl = firstLink.GetProperty("amazon_url").GetString();
        Assert.NotNull(amazonUrl);
        Assert.Contains("amazon.com/s?k=", amazonUrl!);
        Assert.Contains("tag=", amazonUrl!);
        var homeDepotUrl = firstLink.GetProperty("homedepot_url").GetString();
        Assert.NotNull(homeDepotUrl);
        Assert.Contains("homedepot.com/s/", homeDepotUrl!);

        // ── YouTube fallback to search URLs (real YT client not configured) ──
        Assert.True(root.TryGetProperty("youtube_links", out var yt),
            "Expected youtube_links enrichment to populate even when YouTube client is not configured.");
        Assert.Equal(2, yt.GetArrayLength());
        var firstYt = yt[0];
        Assert.Contains("moen cartridge replacement", firstYt.GetProperty("query").GetString()!);
        Assert.Contains("search_query=", firstYt.GetProperty("url").GetString()!);
    }

    [Fact]
    public async Task Analyze_Returns400_WhenNoDescriptionOrImages()
    {
        var client = _factory.CreateClient();
        var resp = await client.PostAsJsonAsync("/api/analyze", new
        {
            description = "",
            media = Array.Empty<object>(),
        });

        Assert.Equal(HttpStatusCode.BadRequest, resp.StatusCode);
        var body = await resp.Content.ReadAsStringAsync();
        Assert.Contains("bad_request", body);
    }

    [Fact]
    public async Task Analyze_Returns502_WhenAiReturnsUnparseableJson()
    {
        var client = _factory.CreateClient();
        _factory.FakeAi.Responder = _ => Task.FromResult("this is not JSON at all");

        var resp = await client.PostAsJsonAsync("/api/analyze", new
        {
            description = "anything",
            media = Array.Empty<object>(),
        });

        Assert.Equal(HttpStatusCode.BadGateway, resp.StatusCode);
        var body = await resp.Content.ReadAsStringAsync();
        Assert.Contains("ai_parse_error", body);
    }

    [Fact]
    public async Task Analyze_InjectsSpanishInstruction_WhenLanguageIsEs()
    {
        var client = _factory.CreateClient();
        await client.PostAsJsonAsync("/api/analyze", new
        {
            description = "fuga en el fregadero",
            language = "es",
            media = Array.Empty<object>(),
        });

        Assert.Single(_factory.FakeAi.Requests);
        var aiCall = _factory.FakeAi.Requests[0];
        Assert.Contains("MUST be written in Spanish", aiCall.System);
    }

    [Fact]
    public async Task Analyze_PassesOwnedToolsIntoPrompt()
    {
        var client = _factory.CreateClient();
        await client.PostAsJsonAsync("/api/analyze", new
        {
            description = "fix drippy faucet",
            media = Array.Empty<object>(),
            ownedTools = new[] { "adjustable wrench", "plumber's tape" },
        });

        Assert.Single(_factory.FakeAi.Requests);
        var aiCall = _factory.FakeAi.Requests[0];
        Assert.Contains("adjustable wrench", aiCall.User);
        Assert.Contains("plumber's tape", aiCall.User);
        Assert.Contains("already owns", aiCall.User);
    }
}
