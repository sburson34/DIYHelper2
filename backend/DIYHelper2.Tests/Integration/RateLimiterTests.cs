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
}
