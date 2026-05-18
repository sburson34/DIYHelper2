using System.Data.Common;
using System.Net.Http;
using DIYHelper2.Api.AI;
using DIYHelper2.Api.Data;
using DIYHelper2.Api.Integrations;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;

namespace DIYHelper2.Tests.Infrastructure;

/// <summary>
/// Test host factory for API integration tests. Replaces the file-backed
/// SQLite registration with an in-memory SQLite connection that lives for
/// the lifetime of the factory — this keeps tests isolated and parallelizable
/// while still exercising the real EF Core + SQLite stack (important because
/// Program.cs runs raw <c>CREATE TABLE IF NOT EXISTS</c> statements that the
/// EF InMemory provider would reject).
///
/// <para>
/// Tests that need to stub the AI client can read <see cref="FakeAi"/> and
/// set <see cref="FakeAIVisionClient.Responder"/> to return canned JSON
/// for each call. The default responder returns <c>"{}"</c>.
/// </para>
/// </summary>
public class ApiFactory : WebApplicationFactory<Program>, IAsyncLifetime
{
    // Fake admin credentials for AdminAuthMiddleware. Tests that hit
    // admin-gated surfaces (GET/PUT/DELETE /api/help-requests, GET /api/feedback)
    // should use CreateAdminClient() instead of CreateClient() to get the
    // Authorization header attached. Set via Environment.SetEnvironmentVariable
    // in the static constructor BEFORE Program.cs reads them at host build time.
    public const string AdminUsername = "testadmin";
    public const string AdminPassword = "testpass";

    static ApiFactory()
    {
        Environment.SetEnvironmentVariable("ADMIN_USERNAME", AdminUsername);
        Environment.SetEnvironmentVariable("ADMIN_PASSWORD", AdminPassword);
    }

    /// <summary>
    /// Ensures every fresh ApiFactory starts from a known env-var baseline,
    /// regardless of what a previous test class (e.g. KillSwitchApiFactory)
    /// left in the process. This protects against cross-fixture bleed when
    /// multiple test classes in the SerialEnv collection mutate process env.
    /// Subclasses that intentionally set an env var should do so AFTER
    /// calling the base constructor.
    /// </summary>
    public ApiFactory()
    {
        // FeatureFlags reads AI_KILL_SWITCH at singleton construction. Force
        // it OFF here so a leftover "true" from KillSwitchApiFactory doesn't
        // poison a sibling test class.
        Environment.SetEnvironmentVariable("AI_KILL_SWITCH", null);
    }

    private DbConnection? _connection;

    /// <summary>
    /// Stub AI client shared by every request made through this factory.
    /// Tests set <c>FakeAi.Responder</c> to shape the canned AI response for
    /// their scenario. Also exposes <c>FakeAi.Requests</c> for assertions
    /// on what the handler sent.
    /// </summary>
    public FakeAIVisionClient FakeAi { get; } = new();

    /// <summary>
    /// One fake HTTP handler per typed-HttpClient external service. Every
    /// outbound HTTP call goes through one of these in tests, so nothing
    /// reaches the network. Per-test code sets <c>.Responder</c> on the
    /// handler it cares about (e.g., <c>FakeWeatherHandler.Responder = _ =>
    /// Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK) { Content =
    /// new StringContent(...) });</c>).
    /// </summary>
    public FakeHttpMessageHandler FakeWeatherHandler { get; } = new();
    public FakeHttpMessageHandler FakeRedditHandler { get; } = new();
    public FakeHttpMessageHandler FakePubChemHandler { get; } = new();
    public FakeHttpMessageHandler FakeAttomHandler { get; } = new();
    public FakeHttpMessageHandler FakeReceiptOcrHandler { get; } = new();
    public FakeHttpMessageHandler FakeYouTubeHandler { get; } = new();
    public FakeHttpMessageHandler FakeModerationHandler { get; } = new();
    public FakeHttpMessageHandler FakePlayIntegrityHandler { get; } = new();

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        builder.UseEnvironment(Environments.Development);

        builder.ConfigureServices(services =>
        {
            // Remove the production DbContext registration.
            var dbDescriptors = services
                .Where(d => d.ServiceType == typeof(DbContextOptions<AppDbContext>)
                         || d.ServiceType == typeof(AppDbContext))
                .ToList();
            foreach (var d in dbDescriptors) services.Remove(d);

            // Shared open SQLite connection so every scope reuses the same
            // in-memory database for the duration of the factory.
            _connection = new SqliteConnection("DataSource=:memory:");
            _connection.Open();

            services.AddDbContext<AppDbContext>(options =>
            {
                options.UseSqlite(_connection);
            });

            // Replace the production IAIVisionClient with the test stub.
            // Last registration wins for GetRequiredService, so this shadows
            // the production factory registered in Program.cs.
            var aiDescriptors = services
                .Where(d => d.ServiceType == typeof(IAIVisionClient))
                .ToList();
            foreach (var d in aiDescriptors) services.Remove(d);
            services.AddSingleton<IAIVisionClient>(FakeAi);

            // AiKeyStore stays empty by default — keeps the "not configured"
            // 503 tests working. Tests that want to reach the AI path call
            // SetOpenAiKey() after Services is built.

            // Replace primary HTTP handlers for every typed HttpClient that
            // hits an external API. Each test gets a deterministic stub it can
            // shape via the exposed Fake*Handler fields. The SsrfGuardHandler
            // delegating registration in Program.cs wraps these, so SSRF tests
            // continue to assert blocking against the real guard.
            services.ConfigureHttpClientDefaults(b => { /* shared defaults stay */ });
            services.AddHttpClient<WeatherClient>().ConfigurePrimaryHttpMessageHandler(() => FakeWeatherHandler);
            services.AddHttpClient<RedditClient>().ConfigurePrimaryHttpMessageHandler(() => FakeRedditHandler);
            services.AddHttpClient<PubChemClient>().ConfigurePrimaryHttpMessageHandler(() => FakePubChemHandler);
            services.AddHttpClient<AttomClient>().ConfigurePrimaryHttpMessageHandler(() => FakeAttomHandler);
            services.AddHttpClient<ReceiptOcrClient>().ConfigurePrimaryHttpMessageHandler(() => FakeReceiptOcrHandler);
            services.AddHttpClient<YouTubeClient>().ConfigurePrimaryHttpMessageHandler(() => FakeYouTubeHandler);
            services.AddHttpClient<DIYHelper2.Api.AI.ModerationService>().ConfigurePrimaryHttpMessageHandler(() => FakeModerationHandler);
            services.AddHttpClient<DIYHelper2.Api.AI.PlayIntegrityVerifier>().ConfigurePrimaryHttpMessageHandler(() => FakePlayIntegrityHandler);
        });
    }

    /// <summary>
    /// HttpClient pre-loaded with the Basic auth header that AdminAuthMiddleware
    /// expects. Use this in tests that hit /admin/* or any GET/PUT/DELETE on
    /// /api/help-requests / GET on /api/feedback. The Basic credentials match
    /// what the static constructor pushed into ADMIN_USERNAME / ADMIN_PASSWORD.
    /// </summary>
    public HttpClient CreateAdminClient()
    {
        var client = CreateClient();
        var b64 = Convert.ToBase64String(
            System.Text.Encoding.UTF8.GetBytes($"{AdminUsername}:{AdminPassword}"));
        client.DefaultRequestHeaders.Authorization =
            new System.Net.Http.Headers.AuthenticationHeaderValue("Basic", b64);
        return client;
    }

    /// <summary>
    /// Populate the DI-resolved <see cref="AiKeyStore"/> with a non-empty
    /// key so AI-backed endpoints can reach the (stubbed) AI client. Call
    /// this from tests that want to exercise the full analyze pipeline.
    /// </summary>
    public void SetOpenAiKey(string key)
    {
        using var scope = Services.CreateScope();
        var store = scope.ServiceProvider.GetRequiredService<AiKeyStore>();
        store.OpenAiKey = key;
    }

    public Task InitializeAsync()
    {
        // Explicitly null out any AI keys Program.cs may have pulled from
        // ambient env vars at startup. Integration tests must be hermetic:
        // whether a developer happens to have OPENAI_API_KEY exported locally
        // should not change test behavior. Tests that need the key set call
        // SetOpenAiKey() explicitly.
        using var scope = Services.CreateScope();
        var store = scope.ServiceProvider.GetRequiredService<AiKeyStore>();
        store.OpenAiKey = null;
        store.AnthropicKey = null;
        return Task.CompletedTask;
    }

    public new async Task DisposeAsync()
    {
        if (_connection is not null)
        {
            await _connection.DisposeAsync();
            _connection = null;
        }
        await base.DisposeAsync();
    }
}
