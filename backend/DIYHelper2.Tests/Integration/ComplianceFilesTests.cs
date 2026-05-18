using System.Net;
using DIYHelper2.Tests.Infrastructure;

namespace DIYHelper2.Tests.Integration;

/// <summary>
/// Mandatory app-store compliance / RFC 9116 surfaces. These must serve a
/// non-empty body on every deploy or app review will reject a re-submission:
///
///   - <c>/privacy-policy.html</c> + <c>/terms-of-service.html</c>: linked
///     from Settings + the iOS / Google Play store listing.
///   - <c>/.well-known/security.txt</c>: contact for security researchers.
///   - <c>/healthz</c>: Docker + Caddy liveness probe.
/// </summary>
public class ComplianceFilesTests : IClassFixture<ApiFactory>
{
    private readonly ApiFactory _factory;

    public ComplianceFilesTests(ApiFactory factory) => _factory = factory;

    [Fact]
    public async Task PrivacyPolicy_Returns200WithNonEmptyHtml()
    {
        var client = _factory.CreateClient();
        var resp = await client.GetAsync("/privacy-policy.html");
        Assert.Equal(HttpStatusCode.OK, resp.StatusCode);
        var body = await resp.Content.ReadAsStringAsync();
        Assert.False(string.IsNullOrWhiteSpace(body));
        // Sanity-check: ours says "Privacy Policy" somewhere — if that gets
        // accidentally deleted this test catches it before the App Store does.
        Assert.Contains("Privacy", body, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task TermsOfService_Returns200WithNonEmptyHtml()
    {
        var client = _factory.CreateClient();
        var resp = await client.GetAsync("/terms-of-service.html");
        Assert.Equal(HttpStatusCode.OK, resp.StatusCode);
        var body = await resp.Content.ReadAsStringAsync();
        Assert.False(string.IsNullOrWhiteSpace(body));
        Assert.Contains("Terms", body, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task SecurityTxt_Returns200WithContactLine()
    {
        var client = _factory.CreateClient();
        var resp = await client.GetAsync("/.well-known/security.txt");
        Assert.Equal(HttpStatusCode.OK, resp.StatusCode);
        var body = await resp.Content.ReadAsStringAsync();
        Assert.False(string.IsNullOrWhiteSpace(body));
        // RFC 9116 requires a Contact directive — locking it in catches the
        // accidental "replace with TODO" diff.
        Assert.Contains("Contact:", body);
    }

    [Fact]
    public async Task Healthz_Returns200_NoBodyContract()
    {
        var client = _factory.CreateClient();
        var resp = await client.GetAsync("/healthz");
        Assert.Equal(HttpStatusCode.OK, resp.StatusCode);
        // Healthz is intentionally empty — Docker / Caddy probes don't read
        // the body. Just assert it didn't crash and returned 200.
    }
}
