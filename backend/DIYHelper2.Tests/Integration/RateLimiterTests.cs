using System.Net;
using System.Net.Http.Json;
using DIYHelper2.Tests.Infrastructure;

namespace DIYHelper2.Tests.Integration;

/// <summary>
/// The "ai" rate-limit policy caps a single client to 20 req/min. Once the
/// bucket is drained the gateway must respond 429 rather than forwarding the
/// request to OpenAI — this protects the shared API key from a single bad
/// client burning quota.
///
/// We hit <c>/api/analyze</c> with no OpenAI key configured, so legitimate
/// requests cheaply short-circuit to 503 (<c>not_configured</c>). The rate
/// limiter runs before the handler, so we see 503s until the quota drains
/// and 429s after — without paying for any actual AI calls.
/// </summary>
[Collection("SerialEnv")]
public class RateLimiterTests : IClassFixture<ApiFactory>
{
    private readonly ApiFactory _factory;

    public RateLimiterTests(ApiFactory factory) => _factory = factory;

    [Fact]
    public async Task AiPolicy_Returns429_AfterLimitExceeded()
    {
        var prev = Environment.GetEnvironmentVariable("OPENAI_API_KEY");
        Environment.SetEnvironmentVariable("OPENAI_API_KEY", null);
        try
        {
            var client = _factory.CreateClient();
            var statuses = new List<HttpStatusCode>();

            // Policy permits 20/min — fire 25 to force the last few into 429.
            for (int i = 0; i < 25; i++)
            {
                var resp = await client.PostAsJsonAsync("/api/analyze", new
                {
                    description = $"rate limit probe {i}",
                });
                statuses.Add(resp.StatusCode);
            }

            var rateLimited = statuses.Count(s => s == HttpStatusCode.TooManyRequests);
            Assert.True(rateLimited >= 1,
                $"Expected at least one 429 after exceeding the ai policy (20/min). Got statuses: {string.Join(",", statuses)}");
        }
        finally
        {
            Environment.SetEnvironmentVariable("OPENAI_API_KEY", prev);
        }
    }

    /// <summary>
    /// The "public" policy (60/min) covers the unauthenticated reads that fan out
    /// to a metered third-party API or do real per-call work. They previously had
    /// no bucket at all, so one client could drain a partner quota as fast as it
    /// could open sockets.
    /// </summary>
    [Fact]
    public async Task PublicPolicy_Returns429_AfterLimitExceeded()
    {
        var client = _factory.CreateClient();
        // Own partition per test — the limiter keys off the resolved client IP,
        // which for the in-memory host comes from this header.
        client.DefaultRequestHeaders.Add("X-Forwarded-For", "203.0.113.61");

        var statuses = new List<HttpStatusCode>();
        for (var i = 0; i < 70; i++)
            statuses.Add((await client.GetAsync("/api/config")).StatusCode);

        Assert.Contains(HttpStatusCode.TooManyRequests, statuses);
        // ...and the early ones went through, so the limit isn't simply "closed".
        Assert.Equal(HttpStatusCode.OK, statuses[0]);
    }

    /// <summary>
    /// Backstop: a route that opted into no named policy is still bounded, so
    /// adding an endpoint and forgetting the attribute can't leave it unlimited.
    /// </summary>
    [Fact]
    public async Task GlobalLimiter_Bounds_AnEndpointWithNoNamedPolicy()
    {
        var client = _factory.CreateClient();
        client.DefaultRequestHeaders.Add("X-Forwarded-For", "203.0.113.62");

        var statuses = new List<HttpStatusCode>();
        for (var i = 0; i < 320; i++)
            statuses.Add((await client.GetAsync("/api/features")).StatusCode);

        Assert.Contains(HttpStatusCode.TooManyRequests, statuses);
        Assert.Equal(HttpStatusCode.OK, statuses[0]);
    }

    /// <summary>
    /// Health probes stay exempt — a throttled /healthz would make the
    /// orchestrator kill a container that is perfectly fine.
    /// </summary>
    [Fact]
    public async Task HealthProbes_AreNeverRateLimited()
    {
        var client = _factory.CreateClient();
        client.DefaultRequestHeaders.Add("X-Forwarded-For", "203.0.113.63");

        for (var i = 0; i < 320; i++)
            Assert.Equal(HttpStatusCode.OK, (await client.GetAsync("/healthz")).StatusCode);
    }
}
