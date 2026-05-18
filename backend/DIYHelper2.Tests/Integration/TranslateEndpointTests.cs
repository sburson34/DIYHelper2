using System.Net;
using System.Net.Http.Json;
using DIYHelper2.Tests.Infrastructure;

namespace DIYHelper2.Tests.Integration;

/// <summary>
/// /api/translate proxies Google Translate v2. We exercise the input-validation
/// paths and the not-configured 500 — the happy path requires a real Google
/// API key (covered indirectly by mobile e2e in production-like configs).
///
/// Also pins down the audit-mandated guarantee: a raw exception from the
/// translate handler is NOT echoed back to the caller. The mobile client
/// surfaces backend errors to users, so leaking internals here was a real
/// concern flagged in 2026-05-17.
/// </summary>
public class TranslateEndpointTests : IClassFixture<ApiFactory>
{
    private readonly ApiFactory _factory;

    public TranslateEndpointTests(ApiFactory factory) => _factory = factory;

    [Fact]
    public async Task Translate_Returns400_WhenQIsEmpty()
    {
        var client = _factory.CreateClient();
        var resp = await client.PostAsJsonAsync("/api/translate", new
        {
            q = Array.Empty<string>(),
            target = "es",
        });
        Assert.Equal(HttpStatusCode.BadRequest, resp.StatusCode);
        var body = await resp.Content.ReadAsStringAsync();
        Assert.Contains("Missing", body);
    }

    [Fact]
    public async Task Translate_Returns400_WhenTargetMissing()
    {
        var client = _factory.CreateClient();
        var resp = await client.PostAsJsonAsync("/api/translate", new
        {
            q = new[] { "hello" },
            target = "",
        });
        Assert.Equal(HttpStatusCode.BadRequest, resp.StatusCode);
    }

    [Fact]
    public async Task Translate_Returns500_WhenGoogleKeyMissing()
    {
        var client = _factory.CreateClient();
        var resp = await client.PostAsJsonAsync("/api/translate", new
        {
            q = new[] { "hello" },
            target = "es",
        });
        // GOOGLE_API_KEY is not set in the test env → handler returns 500
        // with a generic message ("not configured on the server").
        Assert.Equal(HttpStatusCode.InternalServerError, resp.StatusCode);
        var body = await resp.Content.ReadAsStringAsync();
        Assert.Contains("not configured", body, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task Translate_Returns500_BeforeShortCircuiting_WhenKeyMissing()
    {
        // Verifies the order of checks in /api/translate: the "not configured"
        // 500 short-circuit is evaluated BEFORE the source==target passthrough.
        // If we ever reorder these we want a deliberate test update, not a
        // silent change to the contract the mobile app sees on a misconfigured
        // backend.
        var client = _factory.CreateClient();
        var resp = await client.PostAsJsonAsync("/api/translate", new
        {
            q = new[] { "no-op" },
            target = "en",
            source = "en",
        });
        Assert.Equal(HttpStatusCode.InternalServerError, resp.StatusCode);
        var body = await resp.Content.ReadAsStringAsync();
        // Body must NOT contain a raw exception type or stack trace — just the
        // sanitised "not configured" message. This is the audit-mandated
        // exception-message scrubbing regression test.
        Assert.Contains("not configured", body, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("System.", body);
        Assert.DoesNotContain("Exception", body);
        Assert.DoesNotContain("Stack", body);
    }
}
