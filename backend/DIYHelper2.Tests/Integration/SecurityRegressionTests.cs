using System.Net;
using System.Net.Http.Json;
using DIYHelper2.Tests.Infrastructure;
using Microsoft.Extensions.DependencyInjection;
using Sburson.Shared.Testing.Assertions;
using Sburson.Shared.Web;

namespace DIYHelper2.Tests.Integration;

/// <summary>
/// Audit-mandated regressions. These pin down the security plumbing landed
/// in the 2026-05-17 audit so a future refactor can't silently turn the
/// gates off:
///
///   - AI_KILL_SWITCH=true returns 503 on every AI route.
///   - Invalid Play Integrity token returns 403 (when project number is set).
///   - Moderation reject returns 400 / content_policy on /api/analyze.
///   - Security headers (X-Frame-Options, CORP) present on every response.
///   - X-Correlation-Id flows through every API request.
///   - AiKeyStore.OpenAiKey and AnthropicKey are independent (no aliasing).
///
/// SSRF guard and PromptSanitizer have their own dedicated test files —
/// these tests don't re-cover them but reference them in TEST-COVERAGE.md.
/// </summary>
public class SecurityRegressionTests
{
    // ── AI_KILL_SWITCH ────────────────────────────────────────────────

    /// <summary>
    /// One factory per kill-switch test class because FeatureFlags is a
    /// singleton and caches AI_KILL_SWITCH in its constructor.
    /// Serialized via the SerialEnv collection so AI_KILL_SWITCH=true can't
    /// bleed into a parallel test that just spun up its own ApiFactory.
    /// </summary>
    [Collection("SerialEnv")]
    public class AiKillSwitch : IClassFixture<KillSwitchApiFactory>
    {
        private readonly KillSwitchApiFactory _factory;
        public AiKillSwitch(KillSwitchApiFactory factory)
        {
            _factory = factory;
            _factory.SetOpenAiKey("test-key"); // proves the kill-switch wins over key presence
        }

        [Theory]
        [InlineData("/api/analyze")]
        [InlineData("/api/ask-helper")]
        [InlineData("/api/verify-step")]
        [InlineData("/api/diagnose")]
        [InlineData("/api/clarify")]
        [InlineData("/api/live-diy/analyze")]
        public async Task EveryAiRoute_Returns503_WhenKillSwitchOn(string path)
        {
            var client = _factory.CreateClient();
            var resp = await client.PostAsJsonAsync(path, new
            {
                description = "anything",
                stepText = "any",
                projectTitle = "any",
                question = "any",
                projectContext = new { },
                taskDescription = "x",
            });
            Assert.Equal(HttpStatusCode.ServiceUnavailable, resp.StatusCode);
            var body = await resp.Content.ReadAsStringAsync();
            Assert.Contains("ai_kill_switch", body);
        }
    }

    // ── PlayIntegrity failure path ────────────────────────────────────

    /// <summary>
    /// When PLAY_INTEGRITY_PROJECT_NUMBER is set, the verifier runs against
    /// the integrity token header. A malformed / decode-fail token returns
    /// IntegrityResult.Skipped (fail-open), but a successful decode whose
    /// claim payload mismatches returns IntegrityResult.Invalid → 403.
    /// We drive the verifier's HttpClient directly with a fake decoder
    /// response that returns a wrong package name.
    /// </summary>
    [Collection("SerialEnv")]
    public class PlayIntegrityFailure : IClassFixture<ApiFactory>, IAsyncLifetime
    {
        private readonly ApiFactory _factory;
        private string? _prevProject;
        private string? _prevToken;

        public PlayIntegrityFailure(ApiFactory factory) => _factory = factory;

        public Task InitializeAsync()
        {
            // Enable verification + supply an override access token so the
            // verifier skips the service-account JWT mint step. Then fake out
            // the upstream Google response.
            _prevProject = Environment.GetEnvironmentVariable("PLAY_INTEGRITY_PROJECT_NUMBER");
            _prevToken = Environment.GetEnvironmentVariable("PLAY_INTEGRITY_ACCESS_TOKEN");
            Environment.SetEnvironmentVariable("PLAY_INTEGRITY_PROJECT_NUMBER", "12345");
            Environment.SetEnvironmentVariable("PLAY_INTEGRITY_ACCESS_TOKEN", "fake-google-oauth-token");
            _factory.SetOpenAiKey("test-key");
            _factory.FakePlayIntegrityHandler.Requests.Clear();
            return Task.CompletedTask;
        }

        public Task DisposeAsync()
        {
            Environment.SetEnvironmentVariable("PLAY_INTEGRITY_PROJECT_NUMBER", _prevProject);
            Environment.SetEnvironmentVariable("PLAY_INTEGRITY_ACCESS_TOKEN", _prevToken);
            return Task.CompletedTask;
        }

        [Fact]
        public async Task Analyze_Returns403_WhenIntegrityTokenDecodesToWrongPackage()
        {
            // Google decode returns a payload whose appIntegrity.packageName
            // does NOT match com.diyhelper2 (the expected). The verifier
            // surfaces this as IntegrityResult.Invalid → 403 integrity_failed.
            _factory.FakePlayIntegrityHandler.Responder = _ =>
                Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK)
                {
                    Content = new StringContent("""
                        {
                          "tokenPayloadExternal": {
                            "appIntegrity": { "packageName": "com.attacker.fake" },
                            "deviceIntegrity": { "deviceRecognitionVerdict": ["MEETS_BASIC_INTEGRITY"] }
                          }
                        }
                        """, System.Text.Encoding.UTF8, "application/json"),
                });

            var client = _factory.CreateClient();
            using var req = new HttpRequestMessage(HttpMethod.Post, "/api/analyze")
            {
                Content = JsonContent.Create(new
                {
                    description = "a thing",
                    media = Array.Empty<object>(),
                }),
            };
            req.Headers.Add("X-Play-Integrity-Token", "fake-integrity-token-from-android-client");
            var resp = await client.SendAsync(req);
            Assert.Equal(HttpStatusCode.Forbidden, resp.StatusCode);
            var body = await resp.Content.ReadAsStringAsync();
            Assert.Contains("integrity_failed", body);
        }
    }

    // ── Moderation reject ─────────────────────────────────────────────

    // All nested classes in this file join the SerialEnv collection so they
    // run sequentially with AiKillSwitch / PlayIntegrityFailure. Those two
    // mutate process-level env vars (AI_KILL_SWITCH, PLAY_INTEGRITY_*) that
    // the shared FeatureFlags singleton + PlayIntegrityOptions factory read
    // on resolution. Without serial-env serialization, a parallel test can
    // observe a transient env-var state and fail intermittently with the
    // wrong status code (e.g. expecting 503 from kill-switch but getting
    // 502 from a misfiring PlayIntegrity check).
    [Collection("SerialEnv")]
    public class ModerationReject : IClassFixture<ApiFactory>, IAsyncLifetime
    {
        private readonly ApiFactory _factory;
        public ModerationReject(ApiFactory factory) => _factory = factory;

        public Task InitializeAsync()
        {
            _factory.SetOpenAiKey("test-key");
            _factory.FakeModerationHandler.Requests.Clear();
            // Moderation upstream flags the input → handler returns 400 / content_policy.
            _factory.FakeModerationHandler.Responder = _ =>
                Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK)
                {
                    Content = new StringContent("""
                        {
                          "results": [{
                            "flagged": true,
                            "categories": { "violence": true }
                          }]
                        }
                        """, System.Text.Encoding.UTF8, "application/json"),
                });
            return Task.CompletedTask;
        }

        public Task DisposeAsync() => Task.CompletedTask;

        [Fact]
        public async Task Analyze_Returns400_WhenModerationFlagsInput()
        {
            var client = _factory.CreateClient();
            var resp = await client.PostAsJsonAsync("/api/analyze", new
            {
                description = "How do I hurt my neighbour's pet?",
            });
            Assert.Equal(HttpStatusCode.BadRequest, resp.StatusCode);
            var body = await resp.Content.ReadAsStringAsync();
            Assert.Contains("content_policy", body);
        }
    }

    // ── Security headers ──────────────────────────────────────────────

    [Collection("SerialEnv")]
    public class HeadersOnEveryResponse : IClassFixture<ApiFactory>
    {
        private readonly ApiFactory _factory;
        public HeadersOnEveryResponse(ApiFactory factory) => _factory = factory;

        /// <summary>
        /// Cross-Origin-Resource-Policy is DIY-specific (added during the
        /// 2026-05-17 audit). The X-Content-Type-Options / X-Frame-Options /
        /// Referrer-Policy + correlation-ID trio is covered by
        /// <see cref="SburonMiddlewarePipelinePin"/> below, which delegates to
        /// the shared assertion.
        /// </summary>
        [Theory]
        [InlineData("/api/health")]
        [InlineData("/api/features")]
        [InlineData("/api/emergency")]
        [InlineData("/privacy-policy.html")]
        public async Task Endpoint_IncludesAuditedSecurityHeaders(string path)
        {
            var client = _factory.CreateClient();
            var resp = await client.GetAsync(path);
            var headers = resp.Headers.Concat(resp.Content.Headers)
                .Select(h => h.Key)
                .ToHashSet(StringComparer.OrdinalIgnoreCase);

            // DIY adds CORP on top of the shared trio — pin it explicitly so a
            // refactor that removes the dedicated middleware fails loudly.
            Assert.Contains("Cross-Origin-Resource-Policy", headers);
        }
    }

    // ── AI key independence ───────────────────────────────────────────

    [Collection("SerialEnv")]
    public class AiKeyStoreIndependence : IClassFixture<ApiFactory>
    {
        private readonly ApiFactory _factory;
        public AiKeyStoreIndependence(ApiFactory factory) => _factory = factory;

        [Fact]
        public void OpenAiKey_AndAnthropicKey_AreIndependentProperties()
        {
            // A previous accidental aliasing (writing AnthropicKey == OpenAiKey)
            // would mean a misconfigured Anthropic env var silently used the
            // OpenAI key. This test pins them as independent.
            using var scope = _factory.Services.CreateScope();
            var store = scope.ServiceProvider.GetRequiredService<DIYHelper2.Api.AI.AiKeyStore>();
            store.OpenAiKey = "openai-secret-1";
            store.AnthropicKey = "anthropic-secret-2";
            Assert.Equal("openai-secret-1", store.OpenAiKey);
            Assert.Equal("anthropic-secret-2", store.AnthropicKey);
            Assert.NotEqual(store.OpenAiKey, store.AnthropicKey);
        }
    }

    // ── Shared middleware integration ─────────────────────────────────

    /// <summary>
    /// Delegates the audit-pinned middleware-pipeline check (correlation ID
    /// in/out + X-Content-Type-Options / X-Frame-Options / Referrer-Policy)
    /// to <see cref="MiddlewareAssertions.AssertSburonMiddlewareWiredAsync"/>
    /// in the shared package. A future tweak (e.g. a new audited header)
    /// lands in one place instead of every per-app copy.
    /// </summary>
    [Collection("SerialEnv")]
    public class SburonMiddlewarePipelinePin : IClassFixture<ApiFactory>
    {
        private readonly ApiFactory _factory;
        public SburonMiddlewarePipelinePin(ApiFactory factory) => _factory = factory;

        [Fact]
        public Task Sburson_Middleware_Pipeline_Wires_CorrelationId_And_Security_Headers()
        {
            // Compile-time reference into Sburson.Shared.Web so a silent
            // downgrade that dropped the middleware class would fail to build
            // rather than silently regress the pipeline check.
            _ = typeof(CorrelationIdMiddleware);
            return MiddlewareAssertions.AssertSburonMiddlewareWiredAsync(_factory, "/api/health");
        }
    }

    // ── Non-AI 4xx paths for the remaining AI endpoints ──────────────

    [Collection("SerialEnv")]
    public class AskHelperBadInput : IClassFixture<ApiFactory>
    {
        private readonly ApiFactory _factory;
        public AskHelperBadInput(ApiFactory factory) => _factory = factory;

        [Fact]
        public async Task AskHelper_Returns400_WhenQuestionTooLong()
        {
            _factory.SetOpenAiKey("test-key");
            var client = _factory.CreateClient();
            var resp = await client.PostAsJsonAsync("/api/ask-helper", new
            {
                question = new string('x', 10000), // exceeds MaxDescriptionLength
                projectContext = new { },
            });
            Assert.Equal(HttpStatusCode.BadRequest, resp.StatusCode);
        }
    }

    [Collection("SerialEnv")]
    public class LiveDiyBadInput : IClassFixture<ApiFactory>
    {
        private readonly ApiFactory _factory;
        public LiveDiyBadInput(ApiFactory factory) => _factory = factory;

        [Fact]
        public async Task LiveDiyAnalyze_Returns400_WhenNoInputProvided()
        {
            _factory.SetOpenAiKey("test-key");
            var client = _factory.CreateClient();
            var resp = await client.PostAsJsonAsync("/api/live-diy/analyze", new
            {
                taskDescription = (string?)null,
                userQuestion = (string?)null,
                imageBase64 = (string?)null,
            });
            Assert.Equal(HttpStatusCode.BadRequest, resp.StatusCode);
        }

        [Fact]
        public async Task LiveDiyAnalyze_Returns400_WhenImageBase64Invalid()
        {
            _factory.SetOpenAiKey("test-key");
            var client = _factory.CreateClient();
            var resp = await client.PostAsJsonAsync("/api/live-diy/analyze", new
            {
                taskDescription = "tile a backsplash",
                imageBase64 = "not-base64-content-here",
                mimeType = "image/jpeg",
            });
            Assert.Equal(HttpStatusCode.BadRequest, resp.StatusCode);
        }
    }
}
