using System.Net;
using System.Net.Http.Json;
using DIYHelper2.Tests.Infrastructure;

namespace DIYHelper2.Tests.Integration;

/// <summary>
/// /api/confirm-deletion takes the 6-digit code emailed to the user by
/// /api/delete-user-data and flips the request from "pending_verification"
/// to "verified". The handler is privacy-sensitive — it must NOT leak
/// whether a given requestId exists, expired, or had the wrong code.
/// Every failure path returns the same generic 400 shape.
/// </summary>
public class ConfirmDeletionEndpointTests : IClassFixture<ApiFactory>
{
    private readonly ApiFactory _factory;

    public ConfirmDeletionEndpointTests(ApiFactory factory) => _factory = factory;

    [Fact]
    public async Task Returns400_WhenRequestIdMissing()
    {
        var client = _factory.CreateClient();
        var resp = await client.PostAsJsonAsync("/api/confirm-deletion", new
        {
            requestId = "",
            code = "123456",
        });
        Assert.Equal(HttpStatusCode.BadRequest, resp.StatusCode);
    }

    [Fact]
    public async Task Returns400_WhenCodeMissing()
    {
        var client = _factory.CreateClient();
        var resp = await client.PostAsJsonAsync("/api/confirm-deletion", new
        {
            requestId = Guid.NewGuid().ToString(),
            code = "",
        });
        Assert.Equal(HttpStatusCode.BadRequest, resp.StatusCode);
    }

    [Fact]
    public async Task Returns400_WhenRequestIdNotFound()
    {
        var client = _factory.CreateClient();
        var resp = await client.PostAsJsonAsync("/api/confirm-deletion", new
        {
            requestId = Guid.NewGuid().ToString(),
            code = "000000",
        });
        // The endpoint MUST return the same shape regardless of whether the
        // requestId exists — anything else is an oracle for "is this user
        // pending deletion?". Lock that down here.
        Assert.Equal(HttpStatusCode.BadRequest, resp.StatusCode);
        var body = await resp.Content.ReadAsStringAsync();
        Assert.Contains("invalid_code", body);
    }

    [Fact]
    public async Task Returns400_WhenCodeDoesNotMatch_ExistingRequest()
    {
        var client = _factory.CreateClient();

        // First create a pending-verification request via the public endpoint.
        var createResp = await client.PostAsJsonAsync("/api/delete-user-data", new
        {
            email = $"confirm-test-{Guid.NewGuid():N}@example.com",
        });
        Assert.Equal(HttpStatusCode.OK, createResp.StatusCode);
        var createdJson = await createResp.Content.ReadAsStringAsync();
        var doc = System.Text.Json.JsonDocument.Parse(createdJson);
        var requestId = doc.RootElement.GetProperty("requestId").GetString();
        Assert.NotNull(requestId);

        // Wrong code → same generic invalid_code error shape.
        var confirmResp = await client.PostAsJsonAsync("/api/confirm-deletion", new
        {
            requestId,
            code = "000000",
        });
        Assert.Equal(HttpStatusCode.BadRequest, confirmResp.StatusCode);
        var body = await confirmResp.Content.ReadAsStringAsync();
        Assert.Contains("invalid_code", body);
    }
}
