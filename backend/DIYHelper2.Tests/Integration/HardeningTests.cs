using System.Net;
using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using DIYHelper2.Tests.Infrastructure;

namespace DIYHelper2.Tests.Integration;

/// <summary>
/// End-to-end pins for the 2026-07-29 hardening pass. Each test corresponds to a
/// gap that was open before it: an image that was never really an image, a
/// technician who kept access after being fired, a webhook anyone could forge, an
/// admin surface that wasn't behind the admin gate, and unbounded anonymous
/// writes. They exist so a future refactor can't quietly undo any of it.
///
/// <para>Serialized via SerialEnv because the analyze-path tests here assert a
/// 400 from the image sniffer, and <c>FeatureFlags</c> caches
/// <c>AI_KILL_SWITCH</c> in its constructor from process-wide env. Running in
/// parallel with <c>SecurityRegressionTests.AiKillSwitch</c> — which sets that
/// variable to "true" — meant this fixture could build its FeatureFlags
/// singleton during the window it was set and every analyze call came back 503
/// instead. It reproduced roughly one run in six. Same guard the kill-switch
/// class and TwilioWebhookHardeningTests already use.</para>
/// </summary>
[Collection("SerialEnv")]
public class HardeningTests : IClassFixture<ApiFactory>
{
    private readonly ApiFactory _factory;

    public HardeningTests(ApiFactory factory) => _factory = factory;

    // ── Image content validation ──────────────────────────────────────

    [Fact]
    public async Task Analyze_Rejects_NonImageBytesLabelledAsAnImage()
    {
        _factory.SetOpenAiKey("test-key");
        var junk = Convert.ToBase64String(Encoding.UTF8.GetBytes("PK this is a zip, not a photo"));

        var resp = await _factory.CreateClient().PostAsJsonAsync("/api/analyze", new
        {
            description = "look at this",
            media = new[] { new { type = "image", mimeType = "image/jpeg", base64 = junk } },
        });

        Assert.Equal(HttpStatusCode.BadRequest, resp.StatusCode);
        // Crucially, rejected at our edge — no AI call was paid for.
        Assert.Empty(_factory.FakeAi.Requests);
    }

    [Fact]
    public async Task Analyze_Rejects_WhenBytesContradictTheDeclaredMimeType()
    {
        _factory.SetOpenAiKey("test-key");

        var resp = await _factory.CreateClient().PostAsJsonAsync("/api/analyze", new
        {
            description = "mismatch",
            media = new[]
            {
                new { type = "image", mimeType = "image/jpeg", base64 = Convert.ToBase64String(TestImages.Png()) },
            },
        });

        Assert.Equal(HttpStatusCode.BadRequest, resp.StatusCode);
    }

    [Fact]
    public async Task HelpRequest_Rejects_AnImagePayloadThatIsNotAnImage()
    {
        // The lead photo is rendered into the owner dashboard as a data: URI.
        var req = new HttpRequestMessage(HttpMethod.Post, "/api/help-requests")
        {
            Content = JsonContent.Create(new
            {
                customerName = "C", customerEmail = "c@x.example", customerPhone = "5550001111",
                projectTitle = "Bad photo", userDescription = "d", projectData = "{}",
                imageBase64 = Convert.ToBase64String(Encoding.UTF8.GetBytes("<svg onload=alert(1)>")),
            }),
        };
        req.Headers.Add("X-Brand", "hard-co");

        var resp = await _factory.CreateClient().SendAsync(req);
        Assert.Equal(HttpStatusCode.BadRequest, resp.StatusCode);
    }

    // ── Tech token revocation ─────────────────────────────────────────

    private async Task<(int techId, string token, HttpClient admin)> LoginNewTechAsync(string brand)
    {
        await _factory.SeedBrandAsync(brand, "Revoke Co", "leads@revoke.example");
        var admin = _factory.CreateAdminClient();

        var created = await (await admin.PostAsJsonAsync("/api/technicians", new { name = "Sam Tech", brand }))
            .Content.ReadFromJsonAsync<JsonElement>();
        var techId = created.GetProperty("id").GetInt32();
        var code = created.GetProperty("loginCode").GetString()!;

        var loginReq = new HttpRequestMessage(HttpMethod.Post, "/api/tech/login")
        {
            Content = JsonContent.Create(new { code }),
        };
        loginReq.Headers.Add("X-Brand", brand);
        var login = await (await _factory.CreateClient().SendAsync(loginReq)).Content.ReadFromJsonAsync<JsonElement>();
        return (techId, login.GetProperty("token").GetString()!, admin);
    }

    private HttpClient TechClient(string brand, string token)
    {
        var c = _factory.CreateClient();
        c.DefaultRequestHeaders.Add("X-Brand", brand);
        c.DefaultRequestHeaders.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", token);
        return c;
    }

    [Fact]
    public async Task TechToken_StopsWorking_WhenTheTechnicianIsDeactivated()
    {
        var (techId, token, admin) = await LoginNewTechAsync("revoke-a");
        var tech = TechClient("revoke-a", token);

        Assert.Equal(HttpStatusCode.OK, (await tech.GetAsync("/api/tech/jobs")).StatusCode);

        // Owner deactivates them in the console. The 30-day token used to keep
        // returning customer names, phones, emails and job photos regardless.
        var deactivate = await admin.PutAsJsonAsync($"/api/technicians/{techId}", new { isActive = false });
        Assert.Equal(HttpStatusCode.OK, deactivate.StatusCode);

        Assert.Equal(HttpStatusCode.Unauthorized, (await tech.GetAsync("/api/tech/jobs")).StatusCode);
    }

    [Fact]
    public async Task TechToken_StopsWorking_WhenTheTechnicianIsDeleted()
    {
        var (techId, token, admin) = await LoginNewTechAsync("revoke-b");
        var tech = TechClient("revoke-b", token);

        Assert.Equal(HttpStatusCode.NoContent, (await admin.DeleteAsync($"/api/technicians/{techId}")).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await tech.GetAsync("/api/tech/jobs")).StatusCode);
    }

    [Fact]
    public async Task TechToken_StopsWorking_WhenTheLoginCodeIsRotated()
    {
        var (techId, token, admin) = await LoginNewTechAsync("revoke-c");
        var tech = TechClient("revoke-c", token);

        Assert.Equal(HttpStatusCode.OK, (await tech.GetAsync("/api/tech/jobs")).StatusCode);

        // "Their phone was stolen, issue a new code" must invalidate the old session.
        var rotated = await admin.PostAsJsonAsync($"/api/technicians/{techId}/code", new { });
        Assert.Equal(HttpStatusCode.OK, rotated.StatusCode);

        Assert.Equal(HttpStatusCode.Unauthorized, (await tech.GetAsync("/api/tech/jobs")).StatusCode);
    }

    [Fact]
    public async Task TechToken_KeepsWorking_ForAnUntouchedTechnician()
    {
        // Guard against over-revoking: unrelated console activity must not sign
        // a working technician out.
        var (_, token, admin) = await LoginNewTechAsync("revoke-d");
        var tech = TechClient("revoke-d", token);

        var other = await (await admin.PostAsJsonAsync("/api/technicians", new { name = "Other", brand = "revoke-d" }))
            .Content.ReadFromJsonAsync<JsonElement>();
        await admin.PostAsJsonAsync($"/api/technicians/{other.GetProperty("id").GetInt32()}/code", new { });

        Assert.Equal(HttpStatusCode.OK, (await tech.GetAsync("/api/tech/jobs")).StatusCode);
    }

    // ── Admin gate coverage ───────────────────────────────────────────

    [Theory]
    [InlineData("/api/admin/usage-digest")]
    [InlineData("/api/admin/brand-mau")]
    public async Task AdminTelemetrySurfaces_RequireBasicAuth(string path)
    {
        // "/api/admin/..." does not start with "/admin", so these were outside the
        // Basic Auth gate entirely and relied solely on the telemetry token gate.
        var resp = await _factory.CreateClient().GetAsync(path);
        Assert.Equal(HttpStatusCode.Unauthorized, resp.StatusCode);

        var authed = await _factory.CreateAdminClient().GetAsync(path);
        Assert.Equal(HttpStatusCode.OK, authed.StatusCode);
    }

    // ── Bounded anonymous writes ──────────────────────────────────────

    [Fact]
    public async Task CommunityProjects_RejectAnOversizedPost()
    {
        // The feed holds its last 500 posts in process memory.
        var resp = await _factory.CreateClient().PostAsJsonAsync("/api/community-projects", new
        {
            title = "Big",
            description = new string('x', 20_000),
        });

        Assert.Equal(HttpStatusCode.BadRequest, resp.StatusCode);
    }

    [Fact]
    public async Task CommunityProjects_RejectAnOversizedPhoto()
    {
        var resp = await _factory.CreateClient().PostAsJsonAsync("/api/community-projects", new
        {
            title = "Big photo",
            photoUri = "data:image/jpeg;base64," + new string('A', 600_000),
        });

        Assert.Equal(HttpStatusCode.BadRequest, resp.StatusCode);
    }

    [Fact]
    public async Task CommunityProjects_AcceptANormalPost()
    {
        var resp = await _factory.CreateClient().PostAsJsonAsync("/api/community-projects", new
        {
            title = "Fixed a leaky faucet",
            description = "Replaced the cartridge. Took about an hour.",
            difficulty = "easy",
        });

        Assert.Equal(HttpStatusCode.Created, resp.StatusCode);
    }

    [Fact]
    public async Task Feedback_RejectsAnOversizedReport()
    {
        var resp = await _factory.CreateClient().PostAsJsonAsync("/api/feedback", new
        {
            id = "client-1",
            description = new string('x', 20_000),
        });

        Assert.Equal(HttpStatusCode.BadRequest, resp.StatusCode);
    }

    [Fact]
    public async Task Feedback_ClampsOversizedMetadata_RatherThanRejectingTheReport()
    {
        // Machine-generated diagnostics must never cost a user their bug report.
        var resp = await _factory.CreateClient().PostAsJsonAsync("/api/feedback", new
        {
            id = "client-2",
            description = "Crashed when I tapped Analyze.",
            metadata = new { appVersion = new string('v', 5_000), platform = "android" },
        });

        Assert.Equal(HttpStatusCode.Created, resp.StatusCode);

        var listed = await _factory.CreateAdminClient().GetFromJsonAsync<JsonElement>("/api/feedback");
        var mine = listed.EnumerateArray().First(f => f.GetProperty("clientId").GetString() == "client-2");
        Assert.True(mine.GetProperty("appVersion").GetString()!.Length <= 200);
    }

    // ── Stripe webhook ────────────────────────────────────────────────

    private static string StripeSignatureHeader(string payload, string secret, DateTimeOffset timestamp)
    {
        var t = timestamp.ToUnixTimeSeconds();
        using var h = new HMACSHA256(Encoding.UTF8.GetBytes(secret));
        var v1 = Convert.ToHexString(h.ComputeHash(Encoding.UTF8.GetBytes($"{t}.{payload}"))).ToLowerInvariant();
        return $"t={t},v1={v1}";
    }

    [Fact]
    public async Task StripeWebhook_RejectsAReplayedEvent()
    {
        const string secret = "whsec_hardening_test";
        var prev = Environment.GetEnvironmentVariable("STRIPE_WEBHOOK_SECRET");
        Environment.SetEnvironmentVariable("STRIPE_WEBHOOK_SECRET", secret);
        try
        {
            var payload = """{"type":"checkout.session.completed","data":{"object":{"metadata":{"jobId":"1"}}}}""";

            // Correctly signed, but captured an hour ago: outside Stripe's
            // five-minute tolerance, so it must not be honoured a second time.
            var stale = new HttpRequestMessage(HttpMethod.Post, "/api/stripe/webhook")
            {
                Content = new StringContent(payload, Encoding.UTF8, "application/json"),
            };
            stale.Headers.Add("Stripe-Signature",
                StripeSignatureHeader(payload, secret, DateTimeOffset.UtcNow.AddHours(-1)));
            Assert.Equal(HttpStatusCode.Unauthorized, (await _factory.CreateClient().SendAsync(stale)).StatusCode);

            // The same event, freshly signed, is accepted.
            var fresh = new HttpRequestMessage(HttpMethod.Post, "/api/stripe/webhook")
            {
                Content = new StringContent(payload, Encoding.UTF8, "application/json"),
            };
            fresh.Headers.Add("Stripe-Signature",
                StripeSignatureHeader(payload, secret, DateTimeOffset.UtcNow));
            Assert.Equal(HttpStatusCode.OK, (await _factory.CreateClient().SendAsync(fresh)).StatusCode);
        }
        finally
        {
            Environment.SetEnvironmentVariable("STRIPE_WEBHOOK_SECRET", prev);
        }
    }

    [Fact]
    public async Task StripeWebhook_RejectsAForgedSignature()
    {
        var prev = Environment.GetEnvironmentVariable("STRIPE_WEBHOOK_SECRET");
        Environment.SetEnvironmentVariable("STRIPE_WEBHOOK_SECRET", "whsec_hardening_test");
        try
        {
            var payload = """{"type":"checkout.session.completed","data":{"object":{"metadata":{"jobId":"1"}}}}""";
            var req = new HttpRequestMessage(HttpMethod.Post, "/api/stripe/webhook")
            {
                Content = new StringContent(payload, Encoding.UTF8, "application/json"),
            };
            req.Headers.Add("Stripe-Signature",
                StripeSignatureHeader(payload, "the-wrong-secret", DateTimeOffset.UtcNow));

            Assert.Equal(HttpStatusCode.Unauthorized, (await _factory.CreateClient().SendAsync(req)).StatusCode);
        }
        finally
        {
            Environment.SetEnvironmentVariable("STRIPE_WEBHOOK_SECRET", prev);
        }
    }
}

/// <summary>
/// Twilio webhook origin checks. Separated because they mutate process-wide env
/// vars that other fixtures read.
/// </summary>
[Collection("SerialEnv")]
public class TwilioWebhookHardeningTests : IClassFixture<ApiFactory>
{
    private readonly ApiFactory _factory;

    public TwilioWebhookHardeningTests(ApiFactory factory) => _factory = factory;

    private static FormUrlEncodedContent InboundSms() => new(new Dictionary<string, string>
    {
        ["From"] = "+15551110000",
        ["To"] = "+15552220000",
        ["Body"] = "hi",
    });

    [Fact]
    public async Task InboundSms_IsRejected_WhenTheSignatureDoesNotVerify()
    {
        var prev = Environment.GetEnvironmentVariable("TWILIO_AUTH_TOKEN");
        Environment.SetEnvironmentVariable("TWILIO_AUTH_TOKEN", "twilio-test-token");
        try
        {
            var req = new HttpRequestMessage(HttpMethod.Post, "/api/sms/incoming") { Content = InboundSms() };
            req.Headers.Add("X-Twilio-Signature", "Zm9yZ2VkIHNpZ25hdHVyZQ==");

            var resp = await _factory.CreateClient().SendAsync(req);
            Assert.Equal(HttpStatusCode.Unauthorized, resp.StatusCode);
        }
        finally
        {
            Environment.SetEnvironmentVariable("TWILIO_AUTH_TOKEN", prev);
        }
    }

    [Fact]
    public async Task VoiceWebhook_IsRejected_WhenTheSharedTokenIsWrong()
    {
        // The voice webhook texts back whatever number the body claims — an open
        // one is a toll-fraud amplifier on the operator's Twilio account.
        var prevAuth = Environment.GetEnvironmentVariable("TWILIO_AUTH_TOKEN");
        var prevToken = Environment.GetEnvironmentVariable("TWILIO_WEBHOOK_TOKEN");
        Environment.SetEnvironmentVariable("TWILIO_AUTH_TOKEN", null);
        Environment.SetEnvironmentVariable("TWILIO_WEBHOOK_TOKEN", "shared-secret");
        try
        {
            var client = _factory.CreateClient();

            var wrong = await client.PostAsync("/api/sms/voice?token=guess", InboundSms());
            Assert.Equal(HttpStatusCode.Unauthorized, wrong.StatusCode);

            var missing = await client.PostAsync("/api/sms/voice", InboundSms());
            Assert.Equal(HttpStatusCode.Unauthorized, missing.StatusCode);

            var right = await client.PostAsync("/api/sms/voice?token=shared-secret", InboundSms());
            Assert.Equal(HttpStatusCode.OK, right.StatusCode);
        }
        finally
        {
            Environment.SetEnvironmentVariable("TWILIO_AUTH_TOKEN", prevAuth);
            Environment.SetEnvironmentVariable("TWILIO_WEBHOOK_TOKEN", prevToken);
        }
    }
}
