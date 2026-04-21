using System.Net;
using System.Net.Http.Json;
using DIYHelper2.Tests.Infrastructure;

namespace DIYHelper2.Tests.Integration;

/// <summary>
/// Without OPENAI_API_KEY or a valid SECRET_ARN, every AI-backed endpoint
/// must return 503 with the "not_configured" shape. This is the contract
/// the mobile app relies on to show a friendly "service unavailable" banner
/// instead of crashing.
/// </summary>
public class AiEndpointsNotConfiguredTests : IClassFixture<ApiFactory>
{
    private readonly ApiFactory _factory;

    public AiEndpointsNotConfiguredTests(ApiFactory factory) => _factory = factory;

    [Theory]
    [InlineData("/api/analyze")]
    [InlineData("/api/ask-helper")]
    [InlineData("/api/verify-step")]
    [InlineData("/api/diagnose")]
    [InlineData("/api/clarify")]
    public async Task AiEndpoint_Returns503_WhenKeyMissing(string path)
    {
        // Deliberately ensure no key is present for this test. We restore
        // whatever was there afterward so this doesn't leak into other tests.
        var prev = Environment.GetEnvironmentVariable("OPENAI_API_KEY");
        Environment.SetEnvironmentVariable("OPENAI_API_KEY", null);
        try
        {
            var client = _factory.CreateClient();
            var resp = await client.PostAsJsonAsync(path, new
            {
                description = "anything",
                stepText = "any",
                projectTitle = "any",
                question = "any",
                projectContext = new { },
            });
            Assert.Equal(HttpStatusCode.ServiceUnavailable, resp.StatusCode);
            var body = await resp.Content.ReadAsStringAsync();
            Assert.Contains("\"code\":\"not_configured\"", body);
        }
        finally
        {
            Environment.SetEnvironmentVariable("OPENAI_API_KEY", prev);
        }
    }
}
