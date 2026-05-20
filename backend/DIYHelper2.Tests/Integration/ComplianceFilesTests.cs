using System.Net;
using DIYHelper2.Tests.Infrastructure;
using Sburson.Shared.Testing.Assertions;

namespace DIYHelper2.Tests.Integration;

/// <summary>
/// Mandatory app-store compliance / RFC 9116 surfaces. These must serve a
/// non-empty body on every deploy or app review will reject a re-submission:
///
///   - <c>/privacy-policy.html</c> + <c>/terms-of-service.html</c>: linked
///     from Settings + the iOS / Google Play store listing.
///   - <c>/.well-known/security.txt</c>: contact for security researchers.
///   - <c>/healthz</c>: Docker + Caddy liveness probe.
///
/// The 200-plus-non-empty-body check on the three-file trio is delegated to
/// <see cref="ComplianceAssertions.AssertComplianceFilesServedAsync"/> in the
/// shared package — a future tweak (e.g. adding /robots.txt) lands in one
/// place. DIY-specific sanity asserts on body content stay local.
/// </summary>
public class ComplianceFilesTests : IClassFixture<ApiFactory>
{
    private readonly ApiFactory _factory;

    public ComplianceFilesTests(ApiFactory factory) => _factory = factory;

    [Fact]
    public Task ComplianceFileTrio_AllReturn200WithNonEmptyBodies()
        => ComplianceAssertions.AssertComplianceFilesServedAsync(_factory);

    [Fact]
    public async Task PrivacyPolicy_BodyMentionsPrivacy()
    {
        // DIY-specific sanity: if someone accidentally swaps in a TODO stub,
        // the App Store review would catch it but this catches it first.
        var client = _factory.CreateClient();
        var resp = await client.GetAsync("/privacy-policy.html");
        Assert.Equal(HttpStatusCode.OK, resp.StatusCode);
        var body = await resp.Content.ReadAsStringAsync();
        Assert.Contains("Privacy", body, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task TermsOfService_BodyMentionsTerms()
    {
        var client = _factory.CreateClient();
        var resp = await client.GetAsync("/terms-of-service.html");
        Assert.Equal(HttpStatusCode.OK, resp.StatusCode);
        var body = await resp.Content.ReadAsStringAsync();
        Assert.Contains("Terms", body, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task SecurityTxt_BodyHasContactDirective()
    {
        // RFC 9116 requires a Contact directive — locking it in catches the
        // accidental "replace with TODO" diff.
        var client = _factory.CreateClient();
        var resp = await client.GetAsync("/.well-known/security.txt");
        Assert.Equal(HttpStatusCode.OK, resp.StatusCode);
        var body = await resp.Content.ReadAsStringAsync();
        Assert.Contains("Contact:", body);
    }

    [Fact]
    public async Task Healthz_Returns200_NoBodyContract()
    {
        // Not part of the shared compliance trio — Docker / Caddy probes don't
        // read the body. Asserts it didn't crash and returned 200.
        var client = _factory.CreateClient();
        var resp = await client.GetAsync("/healthz");
        Assert.Equal(HttpStatusCode.OK, resp.StatusCode);
    }
}
