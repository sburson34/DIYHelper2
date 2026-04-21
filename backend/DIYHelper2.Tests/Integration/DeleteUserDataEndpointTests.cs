using System.Net;
using System.Net.Http.Json;
using DIYHelper2.Tests.Infrastructure;

namespace DIYHelper2.Tests.Integration;

/// <summary>
/// Privacy deletion endpoint — must queue a request when contact info is
/// provided, return 400 when both email and phone are missing, and silently
/// accept (so the endpoint can't be used as a user-existence oracle) once
/// the per-email rate limit is hit.
/// </summary>
public class DeleteUserDataEndpointTests : IClassFixture<ApiFactory>
{
    private readonly ApiFactory _factory;

    public DeleteUserDataEndpointTests(ApiFactory factory) => _factory = factory;

    [Fact]
    public async Task MissingEmailAndPhone_Returns400()
    {
        var client = _factory.CreateClient();
        var resp = await client.PostAsJsonAsync("/api/delete-user-data", new { name = "Bob" });
        Assert.Equal(HttpStatusCode.BadRequest, resp.StatusCode);
    }

    [Fact]
    public async Task WithEmail_QueuesRequest()
    {
        var client = _factory.CreateClient();
        var resp = await client.PostAsJsonAsync("/api/delete-user-data", new
        {
            name = "Carol",
            email = "carol@example.com",
        });
        Assert.Equal(HttpStatusCode.OK, resp.StatusCode);

        var body = await resp.Content.ReadAsStringAsync();
        Assert.Contains("\"status\":\"queued\"", body);
        Assert.Contains("\"requestId\":", body);
    }

    [Fact]
    public async Task WithPhoneOnly_QueuesRequest()
    {
        var client = _factory.CreateClient();
        var resp = await client.PostAsJsonAsync("/api/delete-user-data", new
        {
            phone = "5558675309",
        });
        Assert.Equal(HttpStatusCode.OK, resp.StatusCode);
    }

    [Fact]
    public async Task PerEmailRateLimit_SilentlyAcceptsOverflow()
    {
        var client = _factory.CreateClient();
        var email = $"ratelimit-{Guid.NewGuid():N}@example.com";

        // Three real submissions under the daily cap
        for (int i = 0; i < 3; i++)
        {
            var resp = await client.PostAsJsonAsync("/api/delete-user-data", new { email });
            Assert.Equal(HttpStatusCode.OK, resp.StatusCode);
        }

        // Fourth must still return 200 with a fake request id — not 429 —
        // so the endpoint doesn't leak whether this email was already seen.
        var overflowResp = await client.PostAsJsonAsync("/api/delete-user-data", new { email });
        Assert.Equal(HttpStatusCode.OK, overflowResp.StatusCode);
        var body = await overflowResp.Content.ReadAsStringAsync();
        Assert.Contains("\"status\":\"queued\"", body);
    }
}
