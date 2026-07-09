using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using DIYHelper2.Tests.Infrastructure;

namespace DIYHelper2.Tests.Integration;

/// <summary>
/// Owner-facing AI tools: the quote assistant (photo/desc + price book → line
/// items), the review responder (draft a reply), and the rule-based next-actions
/// digest. AI goes through the FakeAIVisionClient so responses are deterministic.
/// </summary>
public class AiOwnerToolsTests : IClassFixture<ApiFactory>
{
    private readonly ApiFactory _factory;
    public AiOwnerToolsTests(ApiFactory factory) => _factory = factory;

    private async Task<int> BookAsync(string brand)
    {
        var c = _factory.CreateClient();
        c.DefaultRequestHeaders.Add("X-Brand", brand);
        c.DefaultRequestHeaders.Add("X-Device-Id", "ai-dev");
        var req = new HttpRequestMessage(HttpMethod.Post, "/api/help-requests")
        {
            Content = JsonContent.Create(new
            {
                customerName = "C", customerEmail = "c@ai.example", customerPhone = "5550009999",
                projectTitle = "AI job", userDescription = "leaky faucet", projectData = "{}", imageBase64 = (string?)null,
            }),
        };
        req.Headers.Add("X-Brand", brand);
        req.Headers.Add("X-Device-Id", "ai-dev");
        return (await (await c.SendAsync(req)).Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetInt32();
    }

    [Fact]
    public async Task SuggestQuote_ReturnsLines()
    {
        _factory.SetOpenAiKey("test-key");
        _factory.FakeAi.Responder = _ => Task.FromResult(
            "{\"lines\":[{\"description\":\"Diagnostic fee\",\"amount\":89,\"quantity\":1},{\"description\":\"Faucet cartridge\",\"amount\":45,\"quantity\":1}]}");

        await _factory.SeedBrandAsync("ai-co", "AI Co", "leads@ai.example");
        var jobId = await BookAsync("ai-co");
        var admin = _factory.CreateAdminClient();

        var resp = await admin.PutAsJsonAsync($"/api/help-requests/{jobId}/suggest-quote", new { });
        Assert.Equal(HttpStatusCode.OK, resp.StatusCode);
        var doc = await resp.Content.ReadFromJsonAsync<JsonElement>();
        var lines = doc.GetProperty("lines");
        Assert.Equal(2, lines.GetArrayLength());
        Assert.Equal("Diagnostic fee", lines[0].GetProperty("description").GetString());
        Assert.Equal(89m, lines[0].GetProperty("amount").GetDecimal());
    }

    [Fact]
    public async Task ReviewResponse_ReturnsDraft()
    {
        _factory.SetOpenAiKey("test-key");
        _factory.FakeAi.Responder = _ => Task.FromResult("Thank you so much for the kind words — we loved helping!");

        var admin = _factory.CreateAdminClient();
        var resp = await admin.PostAsJsonAsync("/api/ai/review-response",
            new { review = "Great job, fixed it fast!", rating = 5, company = "AI Co" });
        Assert.Equal(HttpStatusCode.OK, resp.StatusCode);
        var doc = await resp.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Contains("Thank you", doc.GetProperty("response").GetString());
    }

    [Fact]
    public async Task NextActions_CountsNewLeads()
    {
        await _factory.SeedBrandAsync("na-co", "NA Co", "leads@na.example");
        await BookAsyncFor("na-co");   // a fresh "new" lead

        var admin = _factory.CreateAdminClient();
        var doc = await admin.GetFromJsonAsync<JsonElement>("/api/ops/next-actions?brand=na-co");
        Assert.True(doc.GetProperty("newLeads").GetInt32() >= 1);
    }

    private async Task BookAsyncFor(string brand)
    {
        var c = _factory.CreateClient();
        c.DefaultRequestHeaders.Add("X-Brand", brand);
        var req = new HttpRequestMessage(HttpMethod.Post, "/api/help-requests")
        {
            Content = JsonContent.Create(new
            {
                customerName = "N", customerEmail = "n@na.example", customerPhone = "5551112223",
                projectTitle = "New lead", userDescription = "d", projectData = "{}", imageBase64 = (string?)null,
            }),
        };
        req.Headers.Add("X-Brand", brand);
        await c.SendAsync(req);
    }
}
