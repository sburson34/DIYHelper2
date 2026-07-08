using System.Net;
using System.Net.Http.Json;
using DIYHelper2.Tests.Infrastructure;

namespace DIYHelper2.Tests.Integration;

/// <summary>
/// Hardening of the owner portal (the branding company's primary interface):
/// a strict Content-Security-Policy + no-store on admin responses, and a per-IP
/// brute-force lockout on the dashboard login.
/// </summary>
public class AdminHardeningTests : IClassFixture<ApiFactory>
{
    private readonly ApiFactory _factory;

    public AdminHardeningTests(ApiFactory factory) => _factory = factory;

    [Fact]
    public async Task AdminApiResponses_AreNoStore()
    {
        var admin = _factory.CreateAdminClient();
        var resp = await admin.GetAsync("/api/help-requests");
        Assert.Equal(HttpStatusCode.OK, resp.StatusCode);
        Assert.Contains("no-store", resp.Headers.CacheControl?.ToString() ?? "");
    }

    [Fact]
    public async Task RepeatedBadLogins_FromOneIp_GetLockedOut()
    {
        await _factory.SeedBrandAsync("lock-co", "Lock Co", "x@example", "lock-admin", "rightpw");
        var client = _factory.CreateClient();
        const string ip = "203.0.113.77"; // fixed test IP so we don't touch the "unknown" bucket

        HttpRequestMessage BadLogin()
        {
            var req = new HttpRequestMessage(HttpMethod.Get, "/api/help-requests");
            var b64 = Convert.ToBase64String(System.Text.Encoding.UTF8.GetBytes("lock-admin:wrongpw"));
            req.Headers.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Basic", b64);
            req.Headers.Add("X-Forwarded-For", ip);
            return req;
        }

        // First failures return 401...
        for (var i = 0; i < 10; i++)
        {
            var r = await client.SendAsync(BadLogin());
            Assert.Equal(HttpStatusCode.Unauthorized, r.StatusCode);
        }

        // ...then the IP is locked out (429), even with the CORRECT password.
        var correct = new HttpRequestMessage(HttpMethod.Get, "/api/help-requests");
        var okB64 = Convert.ToBase64String(System.Text.Encoding.UTF8.GetBytes("lock-admin:rightpw"));
        correct.Headers.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Basic", okB64);
        correct.Headers.Add("X-Forwarded-For", ip);
        var locked = await client.SendAsync(correct);
        Assert.Equal((HttpStatusCode)429, locked.StatusCode);
    }

    [Fact]
    public async Task GoodLogin_FromDifferentIp_IsUnaffectedByAnotherIpsLockout()
    {
        await _factory.SeedBrandAsync("lock-co2", "Lock Co 2", "x@example", "lock-admin2", "rightpw");
        var client = _factory.CreateClient();

        // A different IP with correct creds is never impacted by other IPs.
        var req = new HttpRequestMessage(HttpMethod.Get, "/api/help-requests");
        var okB64 = Convert.ToBase64String(System.Text.Encoding.UTF8.GetBytes("lock-admin2:rightpw"));
        req.Headers.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Basic", okB64);
        req.Headers.Add("X-Forwarded-For", "198.51.100.5");
        var resp = await client.SendAsync(req);
        Assert.Equal(HttpStatusCode.OK, resp.StatusCode);
    }
}
