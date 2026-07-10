using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using DIYHelper2.Tests.Infrastructure;

namespace DIYHelper2.Tests.Integration;

/// <summary>
/// Console session auth (A3): POST/GET/DELETE /admin/session, the
/// dh_admin_session cookie path through AdminAuthMiddleware, the shared
/// brute-force lockout, the WWW-Authenticate suppression for non-Basic
/// requests, unauthenticated /admin static serving, and the Sec-Fetch-Site
/// CSRF backstop.
///
/// Throttle hygiene: the lockout dictionary is static (process-wide), so every
/// test that registers failures uses its own X-Forwarded-For IP — distinct
/// from AdminHardeningTests' 203.0.113.77 / 198.51.100.5. Logins also carry a
/// unique XFF so the per-IP "submit" rate-limit partitions never collide.
/// </summary>
public class AdminSessionTests : IClassFixture<ApiFactory>
{
    private readonly ApiFactory _factory;

    public AdminSessionTests(ApiFactory factory) => _factory = factory;

    private async Task<HttpResponseMessage> LoginAsync(string username, string password, string ip)
    {
        var req = new HttpRequestMessage(HttpMethod.Post, "/admin/session")
        { Content = JsonContent.Create(new { username, password }) };
        req.Headers.Add("X-Forwarded-For", ip);
        return await _factory.CreateClient().SendAsync(req);
    }

    /// <summary>"dh_admin_session=&lt;token&gt;" (the cookie pair only), or null.</summary>
    private static string? SessionCookieOf(HttpResponseMessage resp)
    {
        if (!resp.Headers.TryGetValues("Set-Cookie", out var values)) return null;
        var raw = values.FirstOrDefault(v => v.StartsWith("dh_admin_session=", StringComparison.OrdinalIgnoreCase));
        return raw?.Split(';')[0];
    }

    private static string? RawSetCookieOf(HttpResponseMessage resp) =>
        resp.Headers.TryGetValues("Set-Cookie", out var values)
            ? values.FirstOrDefault(v => v.StartsWith("dh_admin_session=", StringComparison.OrdinalIgnoreCase))
            : null;

    private HttpRequestMessage CookieRequest(HttpMethod method, string path, string cookie)
    {
        var req = new HttpRequestMessage(method, path);
        req.Headers.Add("Cookie", cookie);
        return req;
    }

    [Fact]
    public async Task SuperLogin_SetsCookie_AndCookieAuthenticatesAdminApi()
    {
        var login = await LoginAsync(ApiFactory.AdminUsername, ApiFactory.AdminPassword, "203.0.113.140");
        Assert.Equal(HttpStatusCode.OK, login.StatusCode);

        var body = await login.Content.ReadFromJsonAsync<JsonElement>();
        Assert.True(body.GetProperty("isSuperAdmin").GetBoolean());
        Assert.Equal(JsonValueKind.Null, body.GetProperty("brand").ValueKind);

        var raw = RawSetCookieOf(login);
        Assert.NotNull(raw);
        Assert.Contains("httponly", raw!, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("samesite=strict", raw, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("path=/", raw, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("max-age=", raw, StringComparison.OrdinalIgnoreCase);

        // The cookie alone (no Basic header) authenticates the admin API.
        var cookie = SessionCookieOf(login)!;
        var list = await _factory.CreateClient().SendAsync(CookieRequest(HttpMethod.Get, "/api/help-requests", cookie));
        Assert.Equal(HttpStatusCode.OK, list.StatusCode);
    }

    [Fact]
    public async Task BrandLogin_IsScoped_CrossTenantIdIs404()
    {
        await _factory.SeedBrandAsync("sess-a", "Sess A", "a@sess.example", "sess-a-admin", "pw-a");
        await _factory.SeedBrandAsync("sess-b", "Sess B", "b@sess.example");

        // A lead that belongs to the OTHER brand.
        var bookReq = new HttpRequestMessage(HttpMethod.Post, "/api/help-requests")
        {
            Content = JsonContent.Create(new
            {
                customerName = "C", customerEmail = "c@x.example", customerPhone = "5550002222",
                projectTitle = "Sess B job", userDescription = "d", projectData = "{}", imageBase64 = (string?)null,
            }),
        };
        bookReq.Headers.Add("X-Brand", "sess-b");
        var bookResp = await _factory.CreateClient().SendAsync(bookReq);
        var otherId = (await bookResp.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetInt32();

        var login = await LoginAsync("sess-a-admin", "pw-a", "203.0.113.141");
        Assert.Equal(HttpStatusCode.OK, login.StatusCode);
        var body = await login.Content.ReadFromJsonAsync<JsonElement>();
        Assert.False(body.GetProperty("isSuperAdmin").GetBoolean());
        Assert.Equal("sess-a", body.GetProperty("brand").GetString());

        // Cross-tenant probe with the scoped session → 404 (not 403).
        var cookie = SessionCookieOf(login)!;
        var probe = await _factory.CreateClient().SendAsync(
            CookieRequest(HttpMethod.Get, $"/api/help-requests/{otherId}", cookie));
        Assert.Equal(HttpStatusCode.NotFound, probe.StatusCode);
    }

    [Fact]
    public async Task WrongPassword_Is401_WithJsonError()
    {
        var login = await LoginAsync(ApiFactory.AdminUsername, "definitely-wrong", "203.0.113.142");
        Assert.Equal(HttpStatusCode.Unauthorized, login.StatusCode);
        var body = await login.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("admin_unauthorized", body.GetProperty("code").GetString());
        // A form login failure must NOT trigger the browser's Basic popup.
        Assert.False(login.Headers.Contains("WWW-Authenticate"));
    }

    [Fact]
    public async Task RepeatedLoginFailures_LockOutTheIp_ForBasicToo()
    {
        const string ip = "203.0.113.150";

        // 10 failed console logins lock the IP (exactly the "submit" budget)…
        for (var i = 0; i < 10; i++)
        {
            var r = await LoginAsync("nobody", "wrongpw", ip);
            Assert.Equal(HttpStatusCode.Unauthorized, r.StatusCode);
        }

        // …and the SAME lockout blocks the middleware's Basic path, even with
        // the CORRECT password (shared AdminCredentialVerifier state).
        var basic = new HttpRequestMessage(HttpMethod.Get, "/api/help-requests");
        var okB64 = Convert.ToBase64String(
            System.Text.Encoding.UTF8.GetBytes($"{ApiFactory.AdminUsername}:{ApiFactory.AdminPassword}"));
        basic.Headers.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Basic", okB64);
        basic.Headers.Add("X-Forwarded-For", ip);
        var locked = await _factory.CreateClient().SendAsync(basic);
        Assert.Equal((HttpStatusCode)429, locked.StatusCode);
    }

    [Fact]
    public async Task RepeatedBasicFailures_LockOutTheLoginEndpoint()
    {
        const string ip = "203.0.113.151";
        var client = _factory.CreateClient();

        // 10 failed Basic attempts (not rate-limited) lock the IP…
        var badB64 = Convert.ToBase64String(System.Text.Encoding.UTF8.GetBytes("someone:wrongpw"));
        for (var i = 0; i < 10; i++)
        {
            var req = new HttpRequestMessage(HttpMethod.Get, "/api/help-requests");
            req.Headers.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Basic", badB64);
            req.Headers.Add("X-Forwarded-For", ip);
            var r = await client.SendAsync(req);
            Assert.Equal(HttpStatusCode.Unauthorized, r.StatusCode);
        }

        // …and the console login refuses even CORRECT credentials with 429.
        var login = await LoginAsync(ApiFactory.AdminUsername, ApiFactory.AdminPassword, ip);
        Assert.Equal((HttpStatusCode)429, login.StatusCode);
        var body = await login.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("admin_locked_out", body.GetProperty("code").GetString());
    }

    [Fact]
    public async Task Logout_ExpiresCookie_EvenWithoutASession()
    {
        var resp = await _factory.CreateClient().DeleteAsync("/admin/session");
        Assert.Equal(HttpStatusCode.NoContent, resp.StatusCode);

        var raw = RawSetCookieOf(resp);
        Assert.NotNull(raw);
        Assert.StartsWith("dh_admin_session=;", raw!, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("max-age=0", raw!, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task Whoami_ReflectsScope_And401sWithoutASession()
    {
        // Super session.
        var superLogin = await LoginAsync(ApiFactory.AdminUsername, ApiFactory.AdminPassword, "203.0.113.143");
        var superCookie = SessionCookieOf(superLogin)!;
        var superWho = await _factory.CreateClient().SendAsync(CookieRequest(HttpMethod.Get, "/admin/session", superCookie));
        Assert.Equal(HttpStatusCode.OK, superWho.StatusCode);
        var superBody = await superWho.Content.ReadFromJsonAsync<JsonElement>();
        Assert.True(superBody.GetProperty("isSuperAdmin").GetBoolean());
        Assert.Equal(JsonValueKind.Null, superBody.GetProperty("brand").ValueKind);

        // Brand-scoped session.
        await _factory.SeedBrandAsync("sess-w", "Sess W", "w@sess.example", "sess-w-admin", "pw-w");
        var brandLogin = await LoginAsync("sess-w-admin", "pw-w", "203.0.113.144");
        var brandCookie = SessionCookieOf(brandLogin)!;
        var brandWho = await _factory.CreateClient().SendAsync(CookieRequest(HttpMethod.Get, "/admin/session", brandCookie));
        Assert.Equal(HttpStatusCode.OK, brandWho.StatusCode);
        var brandBody = await brandWho.Content.ReadFromJsonAsync<JsonElement>();
        Assert.False(brandBody.GetProperty("isSuperAdmin").GetBoolean());
        Assert.Equal("sess-w", brandBody.GetProperty("brand").GetString());

        // No session at all → 401, and no Basic challenge.
        var anon = await _factory.CreateClient().GetAsync("/admin/session");
        Assert.Equal(HttpStatusCode.Unauthorized, anon.StatusCode);
        Assert.False(anon.Headers.Contains("WWW-Authenticate"));
    }

    [Fact]
    public async Task BasicAuth_StillWorks_ForAdminApi()
    {
        var admin = _factory.CreateAdminClient();
        var resp = await admin.GetAsync("/api/help-requests");
        Assert.Equal(HttpStatusCode.OK, resp.StatusCode);
    }

    [Fact]
    public async Task Unauthorized401_ChallengesOnlyBasicAttempts()
    {
        // No credentials at all → 401 WITHOUT WWW-Authenticate (a challenge
        // would pop the browser's native dialog over the console login form).
        var bare = await _factory.CreateClient().GetAsync("/api/help-requests");
        Assert.Equal(HttpStatusCode.Unauthorized, bare.StatusCode);
        Assert.False(bare.Headers.Contains("WWW-Authenticate"));

        // An actual Basic attempt with bad creds → 401 WITH the challenge, so
        // curl/scripts keep their retry semantics. (No X-Forwarded-For → the
        // "unknown" bucket, which the throttle deliberately ignores.)
        var basicReq = new HttpRequestMessage(HttpMethod.Get, "/api/help-requests");
        var b64 = Convert.ToBase64String(System.Text.Encoding.UTF8.GetBytes("nope:nope"));
        basicReq.Headers.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Basic", b64);
        var basic = await _factory.CreateClient().SendAsync(basicReq);
        Assert.Equal(HttpStatusCode.Unauthorized, basic.StatusCode);
        Assert.True(basic.Headers.Contains("WWW-Authenticate"));
    }

    [Fact]
    public async Task AdminStaticFiles_AreServedWithoutCredentials()
    {
        var resp = await _factory.CreateClient().GetAsync("/admin/index.html");
        Assert.Equal(HttpStatusCode.OK, resp.StatusCode);
        // The strict admin CSP still lands on the unauthenticated shell.
        Assert.True(resp.Headers.Contains("Content-Security-Policy"));
    }

    [Fact]
    public async Task CookieAuthedWrite_WithCrossSiteFetch_Is403()
    {
        var login = await LoginAsync(ApiFactory.AdminUsername, ApiFactory.AdminPassword, "203.0.113.145");
        var cookie = SessionCookieOf(login)!;

        // Sanity: a same-origin cookie-authed write reaches the handler
        // (404 — the id doesn't exist, so auth demonstrably passed).
        var ok = CookieRequest(HttpMethod.Put, "/api/help-requests/999999", cookie);
        ok.Content = JsonContent.Create(new { status = "scheduled" });
        var okResp = await _factory.CreateClient().SendAsync(ok);
        Assert.Equal(HttpStatusCode.NotFound, okResp.StatusCode);

        // A browser-labelled cross-site write is rejected before routing.
        var forged = CookieRequest(HttpMethod.Put, "/api/help-requests/999999", cookie);
        forged.Content = JsonContent.Create(new { status = "scheduled" });
        forged.Headers.Add("Sec-Fetch-Site", "cross-site");
        var forgedResp = await _factory.CreateClient().SendAsync(forged);
        Assert.Equal(HttpStatusCode.Forbidden, forgedResp.StatusCode);
    }
}
