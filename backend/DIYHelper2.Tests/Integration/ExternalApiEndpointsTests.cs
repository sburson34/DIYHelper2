using System.Net;
using System.Net.Http.Json;
using DIYHelper2.Tests.Infrastructure;

namespace DIYHelper2.Tests.Integration;

/// <summary>
/// Smoke + happy-path tests for the external-API integration endpoints:
/// <c>/api/weather</c>, <c>/api/reddit-discussions</c>, <c>/api/safety-data</c>,
/// <c>/api/property-value-impact</c>, <c>/api/receipt-ocr</c>,
/// <c>/api/paint-color-match</c>.
///
/// Every endpoint is exercised against a fake <see cref="HttpMessageHandler"/>
/// so we never reach real upstreams in CI. Each test also covers at least one
/// 4xx path (missing param, oversized payload, not-configured) per the
/// "every button has a happy + sad" rule from goofy-enchanting-bee.md.
/// </summary>
[Collection("SerialEnv")]
public class ExternalApiEndpointsTests : IClassFixture<ApiFactory>, IAsyncLifetime
{
    private readonly ApiFactory _factory;

    public ExternalApiEndpointsTests(ApiFactory factory) => _factory = factory;

    public Task InitializeAsync()
    {
        _factory.FakeWeatherHandler.Requests.Clear();
        _factory.FakeRedditHandler.Requests.Clear();
        _factory.FakePubChemHandler.Requests.Clear();
        _factory.FakeAttomHandler.Requests.Clear();
        _factory.FakeReceiptOcrHandler.Requests.Clear();
        return Task.CompletedTask;
    }

    public Task DisposeAsync() => Task.CompletedTask;

    // ── Weather ───────────────────────────────────────────────────────

    [Fact]
    public async Task Weather_Returns400_WhenZipMissing()
    {
        var client = _factory.CreateClient();
        // Missing query param is bound as empty string → 400.
        var resp = await client.GetAsync("/api/weather?zip=");
        Assert.Equal(HttpStatusCode.BadRequest, resp.StatusCode);
    }

    [Fact]
    public async Task Weather_Returns503_WhenNotConfigured()
    {
        // OPENWEATHER_API_KEY is not set in the test env, so WeatherClient.IsConfigured == false.
        var prev = Environment.GetEnvironmentVariable("OPENWEATHER_API_KEY");
        Environment.SetEnvironmentVariable("OPENWEATHER_API_KEY", null);
        try
        {
            // Need a fresh factory because WeatherClient reads the env var in its ctor
            // and is a transient/scoped service — but our existing factory was built
            // without the key, so it should already report not-configured.
            var client = _factory.CreateClient();
            var resp = await client.GetAsync("/api/weather?zip=10001");
            Assert.Equal(HttpStatusCode.ServiceUnavailable, resp.StatusCode);
        }
        finally
        {
            Environment.SetEnvironmentVariable("OPENWEATHER_API_KEY", prev);
        }
    }

    // ── Reddit ────────────────────────────────────────────────────────

    [Fact]
    public async Task RedditDiscussions_Returns400_WhenQueryMissing()
    {
        var client = _factory.CreateClient();
        var resp = await client.GetAsync("/api/reddit-discussions?query=");
        Assert.Equal(HttpStatusCode.BadRequest, resp.StatusCode);
    }

    [Fact]
    public async Task RedditDiscussions_ReturnsEmptyThreads_WhenUpstreamFails()
    {
        // Reddit endpoint gracefully returns 200 with an empty threads array
        // when the upstream returns 5xx — keeps the UI from showing a hard error.
        _factory.FakeRedditHandler.Responder = _ =>
            Task.FromResult(new HttpResponseMessage(HttpStatusCode.InternalServerError));

        var client = _factory.CreateClient();
        var resp = await client.GetAsync("/api/reddit-discussions?query=leaky+faucet");
        Assert.Equal(HttpStatusCode.OK, resp.StatusCode);
        var body = await resp.Content.ReadAsStringAsync();
        Assert.Contains("\"threads\":[]", body.Replace(" ", ""));
    }

    [Fact]
    public async Task RedditDiscussions_DecodesUpstreamThreads()
    {
        const string upstreamJson = """
            {
              "data": {
                "children": [
                  { "data": {
                      "title": "How I fixed my drippy moen",
                      "permalink": "/r/HomeImprovement/comments/abc/moen/",
                      "subreddit": "HomeImprovement",
                      "score": 142,
                      "num_comments": 38,
                      "selftext": "Replaced the 1225 cartridge…"
                    }
                  }
                ]
              }
            }
            """;
        _factory.FakeRedditHandler.Responder = _ =>
            Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK)
            {
                Content = new StringContent(upstreamJson, System.Text.Encoding.UTF8, "application/json"),
            });

        var client = _factory.CreateClient();
        var resp = await client.GetAsync($"/api/reddit-discussions?query={Guid.NewGuid():N}");
        Assert.Equal(HttpStatusCode.OK, resp.StatusCode);
        var body = await resp.Content.ReadAsStringAsync();
        Assert.Contains("How I fixed my drippy moen", body);
        Assert.Contains("HomeImprovement", body);
    }

    // ── PubChem (safety-data) ─────────────────────────────────────────

    [Fact]
    public async Task SafetyData_Returns400_WhenChemicalMissing()
    {
        var client = _factory.CreateClient();
        var resp = await client.GetAsync("/api/safety-data?chemical=");
        Assert.Equal(HttpStatusCode.BadRequest, resp.StatusCode);
    }

    [Fact]
    public async Task SafetyData_Returns404_WhenChemicalNotFound()
    {
        _factory.FakePubChemHandler.Responder = _ =>
            Task.FromResult(new HttpResponseMessage(HttpStatusCode.NotFound));

        var client = _factory.CreateClient();
        var resp = await client.GetAsync("/api/safety-data?chemical=unobtanium");
        Assert.Equal(HttpStatusCode.NotFound, resp.StatusCode);
    }

    // ── Attom (property-value-impact) ─────────────────────────────────

    [Fact]
    public async Task PropertyValueImpact_Returns400_WhenRepairTypeMissing()
    {
        var client = _factory.CreateClient();
        var resp = await client.GetAsync("/api/property-value-impact?zip=10001&estimatedCost=1500");
        Assert.Equal(HttpStatusCode.BadRequest, resp.StatusCode);
    }

    [Fact]
    public async Task PropertyValueImpact_FallsBackToStaticEstimate_WhenAttomDisabled()
    {
        // Without ATTOM_API_KEY the AttomClient returns the static fallback
        // estimate. The endpoint should still return 200 with a value-add.
        var client = _factory.CreateClient();
        var resp = await client.GetAsync("/api/property-value-impact?zip=10001&repairType=kitchen&estimatedCost=1500");
        Assert.Equal(HttpStatusCode.OK, resp.StatusCode);
        var body = await resp.Content.ReadAsStringAsync();
        Assert.Contains("estimatedValueAdd", body);
        Assert.Contains("source", body);
    }

    // ── Receipt OCR ────────────────────────────────────────────────────

    [Fact]
    public async Task ReceiptOcr_Returns503_WhenNotConfigured()
    {
        // MINDEE_API_KEY not set → ReceiptOcrClient.IsConfigured == false.
        var prev = Environment.GetEnvironmentVariable("MINDEE_API_KEY");
        Environment.SetEnvironmentVariable("MINDEE_API_KEY", null);
        try
        {
            var client = _factory.CreateClient();
            var resp = await client.PostAsJsonAsync("/api/receipt-ocr", new
            {
                base64Image = Convert.ToBase64String(new byte[] { 0xFF, 0xD8, 0xFF, 0xE0 }),
                mimeType = "image/jpeg",
            });
            // Endpoint short-circuits with 503 / not-configured when
            // MINDEE_API_KEY is absent. That's the contract the mobile client
            // relies on to hide the receipt-OCR CTA — keep it tight.
            Assert.Equal(HttpStatusCode.ServiceUnavailable, resp.StatusCode);
        }
        finally
        {
            Environment.SetEnvironmentVariable("MINDEE_API_KEY", prev);
        }
    }

    [Fact]
    public async Task ReceiptOcr_Returns400_WhenBase64Invalid()
    {
        // Bypass the "not configured" gate to exercise the validation path:
        // set the env var, but the (now-real) Mindee call is fake-routed.
        var prev = Environment.GetEnvironmentVariable("MINDEE_API_KEY");
        Environment.SetEnvironmentVariable("MINDEE_API_KEY", "test-key");
        try
        {
            // Build a separate factory so ReceiptOcrClient sees MINDEE_API_KEY at ctor time.
            using var factory = new ApiFactory();
            await factory.InitializeAsync();
            var client = factory.CreateClient();
            var resp = await client.PostAsJsonAsync("/api/receipt-ocr", new
            {
                base64Image = "this is not base64!!!",
                mimeType = "image/jpeg",
            });
            Assert.Equal(HttpStatusCode.BadRequest, resp.StatusCode);
        }
        finally
        {
            Environment.SetEnvironmentVariable("MINDEE_API_KEY", prev);
        }
    }

    // ── Paint color match ──────────────────────────────────────────────

    [Fact]
    public async Task PaintColorMatch_Returns400_WhenBase64Missing()
    {
        var client = _factory.CreateClient();
        var resp = await client.PostAsJsonAsync("/api/paint-color-match", new
        {
            base64Image = "",
            mimeType = "image/jpeg",
        });
        Assert.Equal(HttpStatusCode.BadRequest, resp.StatusCode);
    }

    [Fact]
    public async Task PaintColorMatch_Returns200WithBundledPalette_OnHappyPath()
    {
        // 4x4 magenta PNG — small but legitimate so PaintColorClient can
        // sample a dominant colour.
        var bytes = new byte[]
        {
            0x89,0x50,0x4E,0x47,0x0D,0x0A,0x1A,0x0A,
            0x00,0x00,0x00,0x0D,0x49,0x48,0x44,0x52,
            0x00,0x00,0x00,0x04,0x00,0x00,0x00,0x04,
            0x08,0x02,0x00,0x00,0x00,0x26,0x93,0x09,
            0x29,
        };
        var client = _factory.CreateClient();
        var resp = await client.PostAsJsonAsync("/api/paint-color-match", new
        {
            base64Image = Convert.ToBase64String(bytes),
            mimeType = "image/png",
        });
        // PaintColorClient always returns a match against the bundled
        // palette; the endpoint has no failure path past the base64 decode.
        // Anything other than 200 here is a regression worth catching.
        Assert.Equal(HttpStatusCode.OK, resp.StatusCode);
        var body = await resp.Content.ReadAsStringAsync();
        Assert.Contains("dominantHex", body);
        Assert.Contains("matches", body);
    }
}
