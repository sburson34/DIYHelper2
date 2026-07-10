using System.Net;
using DIYHelper2.Tests.Infrastructure;

namespace DIYHelper2.Tests.Integration;

/// <summary>
/// Variant of <see cref="ApiFactory"/> that sets <c>APP_KEY</c> before the
/// host is built, so AppKeyMiddleware actually enforces the shared secret.
/// Restores the previous value on dispose (same pattern as
/// <see cref="KillSwitchApiFactory"/>) to keep sibling fixtures hermetic.
/// </summary>
public class AppKeyApiFactory : ApiFactory
{
    public const string TestAppKey = "test-app-key";
    private readonly string? _previousValue;

    public AppKeyApiFactory()
    {
        _previousValue = Environment.GetEnvironmentVariable("APP_KEY");
        Environment.SetEnvironmentVariable("APP_KEY", TestAppKey);
    }

    public new async Task DisposeAsync()
    {
        Environment.SetEnvironmentVariable("APP_KEY", _previousValue);
        await base.DisposeAsync();
    }
}

/// <summary>
/// OAuth providers (Jobber, Housecall Pro, QuickBooks) redirect the operator's
/// browser to our /callback endpoints and cannot attach X-App-Key. Those exact
/// paths must be exempt from AppKeyMiddleware — the signed, 10-minute state
/// parameter is what authenticates them. Everything else under /api must stay
/// locked when APP_KEY is set.
/// </summary>
[Collection("SerialEnv")]
public class AppKeyExemptionTests : IClassFixture<AppKeyApiFactory>
{
    private readonly AppKeyApiFactory _factory;

    public AppKeyExemptionTests(AppKeyApiFactory factory) => _factory = factory;

    [Theory]
    [InlineData("/api/crm/jobber/callback")]
    [InlineData("/api/crm/housecall/callback")]
    [InlineData("/api/accounting/qbo/callback")]
    public async Task OAuthCallbacks_ReachHandler_WithoutAppKey(string path)
    {
        var client = _factory.CreateClient();
        var resp = await client.GetAsync(path);

        // 400 ("missing code or state") proves the handler ran; the middleware
        // would have short-circuited with 401 before the route was reached.
        Assert.Equal(HttpStatusCode.BadRequest, resp.StatusCode);
    }

    [Fact]
    public async Task NonExemptApi_Rejected_WithoutAppKey()
    {
        var client = _factory.CreateClient();
        var resp = await client.GetAsync("/api/config");

        Assert.Equal(HttpStatusCode.Unauthorized, resp.StatusCode);
    }

    [Fact]
    public async Task NonExemptApi_Allowed_WithAppKey()
    {
        var client = _factory.CreateClient();
        client.DefaultRequestHeaders.Add("X-App-Key", AppKeyApiFactory.TestAppKey);
        var resp = await client.GetAsync("/api/config");

        Assert.Equal(HttpStatusCode.OK, resp.StatusCode);
    }

    [Theory]
    [InlineData("/api/sms/incoming")]
    [InlineData("/api/stripe/webhook")]
    public async Task ExternalWebhooks_StayExempt(string path)
    {
        var client = _factory.CreateClient();
        var resp = await client.PostAsync(path, new StringContent(""));

        // Whatever the handler returns (400 for a malformed payload etc.),
        // it must not be the middleware's 401.
        Assert.NotEqual(HttpStatusCode.Unauthorized, resp.StatusCode);
    }
}
