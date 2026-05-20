using System.Net;
using System.Net.Http.Json;
using DIYHelper2.Tests.Infrastructure;
using Sburson.Shared.Testing.Assertions;

namespace DIYHelper2.Tests.Integration;

/// <summary>
/// Cross-flow user-journey integration test. Exercises the always-present
/// surface (healthz + compliance trio) plus an anonymous DIY feature endpoint
/// (community-projects post+list) end-to-end through a single HttpClient so a
/// regression that breaks the path from "host boots" to "feature works"
/// surfaces in one place.
///
/// <para>
/// DIYHelper2 doesn't expose <c>/api/auth/register</c> or
/// <c>/api/auth/login</c> (the API is anonymous / admin-key gated), so the
/// shared <see cref="Sburson.Shared.Testing.Journey.JourneyTestBase{TProgram}"/>'s
/// RegisterUser/Login steps don't apply here. The two compliance / health
/// assertions still delegate to <see cref="ComplianceAssertions"/> +
/// <see cref="MiddlewareAssertions"/> so the shared package owns the
/// portfolio-wide invariants.
/// </para>
///
/// <para>
/// <c>[Collection("SerialEnv")]</c> is used because the journey runs against
/// the same <see cref="ApiFactory"/> as other tests that mutate process env
/// (AI_KILL_SWITCH, PLAY_INTEGRITY_PROJECT_NUMBER) — serial execution keeps
/// the feature-endpoint assertions deterministic. The "SerialEnv" collection
/// is registered by <c>Sburson.Shared.Testing.SerialEnvCollection</c>.
/// </para>
/// </summary>
[Collection("SerialEnv")]
public class JourneyTests : IClassFixture<ApiFactory>
{
    private readonly ApiFactory _factory;

    public JourneyTests(ApiFactory factory)
    {
        _factory = factory;
    }

    [Fact]
    public async Task Healthz_Then_Compliance_Then_Community_Feature_All_Reachable_In_One_Flow()
    {
        // Single HttpClient for the whole flow so a regression that drops a
        // header or breaks cookie/state propagation between requests shows up.
        var client = _factory.CreateClient();

        // Step 1 — health check (Docker / Caddy liveness probe).
        var health = await client.GetAsync("/healthz");
        Assert.Equal(HttpStatusCode.OK, health.StatusCode);

        // Step 2 — middleware pipeline (correlation-id + security headers).
        // Delegated to the shared package so a future tweak (e.g. a new
        // audited header) lands in one place.
        await MiddlewareAssertions.AssertSburonMiddlewareWiredAsync(_factory, "/api/health");

        // Step 3 — compliance file trio (App Store + Play + RFC 9116).
        await ComplianceAssertions.AssertComplianceFilesServedAsync(_factory);

        // Step 4 — DIY-specific feature: post a community project, then list
        // it back. Anonymous routes, no auth header needed.
        var title = $"Journey project {Guid.NewGuid():N}";
        var create = await client.PostAsJsonAsync("/api/community-projects", new
        {
            title,
            description = "Posted from JourneyTests so the GET below has something to return.",
            difficulty = "easy",
        });
        Assert.Equal(HttpStatusCode.Created, create.StatusCode);

        var list = await client.GetAsync("/api/community-projects");
        Assert.Equal(HttpStatusCode.OK, list.StatusCode);
        var body = await list.Content.ReadAsStringAsync();
        Assert.Contains(title, body);
    }
}
