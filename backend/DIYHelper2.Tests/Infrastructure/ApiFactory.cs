using DIYHelper2.Api.AI;
using DIYHelper2.Api.Data;
using DIYHelper2.Api.Integrations;
using Sburson.Shared.Mobile;
using Microsoft.AspNetCore.Hosting;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Sburson.Shared.Testing;

namespace DIYHelper2.Tests.Infrastructure;

/// <summary>
/// Per-app test host factory. Inherits the heavy lifting from
/// <see cref="BaseApiFactory{TProgram}"/> (Testcontainers Postgres in CI,
/// SQLite-in-memory fallback on developer machines without Docker, per-fixture
/// schema isolation, in-memory <c>ConfigOverrides</c>) and only overrides the
/// app-specific DbContext registration plus DIY-domain Fake adapters.
///
/// <para>
/// Tests that need to stub the AI client read <see cref="FakeAi"/> and set
/// <see cref="FakeAIVisionClient.Responder"/> to return canned JSON. Tests that
/// need to shape an external HTTP call (Weather, Reddit, PubChem, Attom,
/// ReceiptOcr, YouTube, Moderation, PlayIntegrity) set <c>.Responder</c> on the
/// matching <c>Fake*Handler</c> field.
/// </para>
/// </summary>
public class ApiFactory : BaseApiFactory<Program>
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

        // CRM/Jobber test config. A fixed 32-byte base64 key makes CrmTokenProtector
        // deterministic across the fixture, so tokens seeded into a connection
        // decrypt correctly in the sink. Jobber app creds make JobberOptions
        // "configured" so the connect/callback endpoints are exercisable.
        Environment.SetEnvironmentVariable("CRM_TOKEN_ENC_KEY",
            Convert.ToBase64String(System.Text.Encoding.ASCII.GetBytes("0123456789abcdef0123456789abcdef")));
        Environment.SetEnvironmentVariable("JOBBER_CLIENT_ID", "test-jobber-client");
        Environment.SetEnvironmentVariable("JOBBER_CLIENT_SECRET", "test-jobber-secret");
        Environment.SetEnvironmentVariable("JOBBER_REDIRECT_URI", "https://example.com/api/crm/jobber/callback");
        Environment.SetEnvironmentVariable("HOUSECALL_CLIENT_ID", "test-hcp-client");
        Environment.SetEnvironmentVariable("HOUSECALL_CLIENT_SECRET", "test-hcp-secret");
        Environment.SetEnvironmentVariable("HOUSECALL_REDIRECT_URI", "https://example.com/api/crm/housecall/callback");
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

        // Same defense for APP_KEY: AppKeyApiFactory sets it before its host
        // builds; make sure a plain ApiFactory never inherits it.
        Environment.SetEnvironmentVariable("APP_KEY", null);

        // And for Twilio: SmsConfiguredApiFactory (TechModeTests) sets these
        // before its host builds; a plain ApiFactory must stay unconfigured so
        // the fail-soft "SMS off" contract tests keep meaning something.
        Environment.SetEnvironmentVariable("TWILIO_ACCOUNT_SID", null);
        Environment.SetEnvironmentVariable("TWILIO_AUTH_TOKEN", null);
        Environment.SetEnvironmentVariable("TWILIO_FROM_NUMBER", null);
    }

    /// <summary>
    /// Stub AI client shared by every request made through this factory.
    /// Tests set <c>FakeAi.Responder</c> to shape the canned AI response for
    /// their scenario. Also exposes <c>FakeAi.Requests</c> for assertions
    /// on what the handler sent.
    /// </summary>
    public FakeAIVisionClient FakeAi { get; } = new();

    // One FakeHttpMessageHandler per typed-HttpClient external service. Every
    // outbound HTTP call goes through one of these in tests, so nothing reaches
    // the network. Per-test code sets `.Responder` on the handler it cares
    // about. These now come from Sburson.Shared.Testing — same shape, single
    // implementation across the portfolio.
    public FakeHttpMessageHandler FakeWeatherHandler { get; } = new();
    public FakeHttpMessageHandler FakeRedditHandler { get; } = new();
    public FakeHttpMessageHandler FakePubChemHandler { get; } = new();
    public FakeHttpMessageHandler FakeAttomHandler { get; } = new();
    public FakeHttpMessageHandler FakeReceiptOcrHandler { get; } = new();
    public FakeHttpMessageHandler FakeYouTubeHandler { get; } = new();
    /// <summary>Stubs the Google Geocoding API (job service addresses). Tests
    /// also set <see cref="SetGoogleApiKey"/> so the client is "configured".</summary>
    public FakeHttpMessageHandler FakeGeocodeHandler { get; } = new();
    public FakeHttpMessageHandler FakeModerationHandler { get; } = new();
    public FakeHttpMessageHandler FakePlayIntegrityHandler { get; } = new();
    public FakeHttpMessageHandler FakeExpoHandler { get; } = new();
    public FakeHttpMessageHandler FakeBrandExtractHandler { get; } = new();
    /// <summary>Intercepts the outbound CRM lead webhook (WebhookCrmSink) so a
    /// brand's LeadWebhookUrl push is asserted on instead of hitting the network.</summary>
    public FakeHttpMessageHandler FakeCrmWebhookHandler { get; } = new();
    /// <summary>Stubs Jobber's OAuth token endpoint (code exchange + refresh).</summary>
    public FakeHttpMessageHandler FakeJobberTokenHandler { get; } = new();
    /// <summary>Stubs Jobber's GraphQL endpoint (clientCreate).</summary>
    public FakeHttpMessageHandler FakeJobberGraphQlHandler { get; } = new();
    /// <summary>Stubs Housecall Pro's OAuth token endpoint (code exchange + refresh).</summary>
    public FakeHttpMessageHandler FakeHousecallTokenHandler { get; } = new();
    /// <summary>Stubs Housecall Pro's REST API (POST /customers, /leads).</summary>
    public FakeHttpMessageHandler FakeHousecallApiHandler { get; } = new();
    /// <summary>Stubs Twilio's REST API so tests that configure SMS (via
    /// <c>SmsConfiguredApiFactory</c>) never hit the network.</summary>
    public FakeHttpMessageHandler FakeTwilioHandler { get; } = new();

    /// <summary>Captures lead-routing emails instead of hitting SES. Tests read
    /// <c>FakeEmail.SentMessages</c> and can set <c>FakeEmail.OnSend</c> to throw.</summary>
    public FakeEmailService FakeEmail { get; } = new();

    /// <summary>In-memory S3 stand-in for the job-media offload. Registered as
    /// the app's IObjectStorage so booking/tech photo writes store here; tests
    /// read <c>Storage.Objects</c> and can set <c>ThrowOnEverything</c> to
    /// exercise the fail-soft base64 fallback.</summary>
    public FakeObjectStorage Storage { get; } = new();

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        // Lets BaseApiFactory layer ConfigOverrides + the per-fixture connection
        // string on top of appsettings before our own service tweaks run.
        base.ConfigureWebHost(builder);

        builder.UseEnvironment("Development");

        // Makes AddSburonObjectStorage register a (real) IObjectStorage, which
        // we then replace with the in-memory fake below — so JobMediaService
        // sees storage as configured and the offload write paths run in tests.
        builder.UseSetting("Storage:S3:Bucket", "fake-test-bucket");

        builder.ConfigureServices(services =>
        {
            // Replace the production DbContext registration with one bound to
            // BaseApiFactory's per-fixture backend (Postgres-via-Testcontainers
            // in CI, SQLite-in-memory on dev machines without Docker).
            //
            // RemoveAllDatabaseProviders (Sburson.Shared.Testing 0.1.2) strips
            // every EF Core + Npgsql service the production AddDbContext
            // registered. Without it EF Core sees two providers on the
            // SQLite-fallback path (which CI uses) and throws on first
            // request. Same fix that landed in ArgumentRef + LandscapeHelper.
            services.RemoveAllDatabaseProviders();
            services.RemoveAll<DbContextOptions<AppDbContext>>();
            services.RemoveAll<AppDbContext>();

            services.AddDbContext<AppDbContext>(options =>
            {
                if (UseSqliteFallback)
                    options.UseSqlite(ConnectionString);
                else
                    options.UseNpgsql(ConnectionString);
            });

            // Replace the production IAIVisionClient with the test stub. Last
            // registration wins for GetRequiredService, so this shadows the
            // production factory registered in Program.cs.
            services.RemoveAll<IAIVisionClient>();
            services.AddSingleton<IAIVisionClient>(FakeAi);

            // Capture lead-routing emails instead of sending via SES (which
            // AddSburonEmail would register as a Noop here anyway since Email:From
            // is unset — the fake lets tests assert on what would have been sent).
            services.RemoveAll<Sburson.Shared.Email.IEmailService>();
            services.AddSingleton<Sburson.Shared.Email.IEmailService>(FakeEmail);

            // Replace the S3 client AddSburonObjectStorage registered (because
            // Storage:S3:Bucket is set above) with the in-memory fake.
            services.RemoveAll<Sburson.Shared.Storage.IObjectStorage>();
            services.AddSingleton<Sburson.Shared.Storage.IObjectStorage>(Storage);

            // AiKeyStore stays empty by default — keeps the "not configured"
            // 503 tests working. Tests that want to reach the AI path call
            // SetOpenAiKey() after Services is built.

            // Replace primary HTTP handlers for every typed HttpClient that
            // hits an external API. Each test gets a deterministic stub it can
            // shape via the exposed Fake*Handler fields. The SsrfGuardHandler
            // delegating registration in Program.cs wraps these, so SSRF tests
            // continue to assert blocking against the real guard.
            services.AddHttpClient<WeatherClient>().ConfigurePrimaryHttpMessageHandler(() => FakeWeatherHandler);
            services.AddHttpClient<RedditClient>().ConfigurePrimaryHttpMessageHandler(() => FakeRedditHandler);
            services.AddHttpClient<PubChemClient>().ConfigurePrimaryHttpMessageHandler(() => FakePubChemHandler);
            services.AddHttpClient<AttomClient>().ConfigurePrimaryHttpMessageHandler(() => FakeAttomHandler);
            services.AddHttpClient<ReceiptOcrClient>().ConfigurePrimaryHttpMessageHandler(() => FakeReceiptOcrHandler);
            services.AddHttpClient<YouTubeClient>().ConfigurePrimaryHttpMessageHandler(() => FakeYouTubeHandler);
            services.AddHttpClient<GeocodingClient>().ConfigurePrimaryHttpMessageHandler(() => FakeGeocodeHandler);
            services.AddHttpClient<DIYHelper2.Api.AI.ModerationService>().ConfigurePrimaryHttpMessageHandler(() => FakeModerationHandler);
            services.AddHttpClient<PlayIntegrityVerifier>().ConfigurePrimaryHttpMessageHandler(() => FakePlayIntegrityHandler);
            services.AddHttpClient<DIYHelper2.Api.Integrations.ExpoPushClient>().ConfigurePrimaryHttpMessageHandler(() => FakeExpoHandler);
            services.AddHttpClient<DIYHelper2.Api.Integrations.BrandExtractionClient>().ConfigurePrimaryHttpMessageHandler(() => FakeBrandExtractHandler);
            services.AddHttpClient<DIYHelper2.Api.Integrations.Crm.WebhookCrmSink>().ConfigurePrimaryHttpMessageHandler(() => FakeCrmWebhookHandler);
            services.AddHttpClient<DIYHelper2.Api.Integrations.Crm.JobberTokenService>().ConfigurePrimaryHttpMessageHandler(() => FakeJobberTokenHandler);
            services.AddHttpClient<DIYHelper2.Api.Integrations.Crm.JobberCrmSink>().ConfigurePrimaryHttpMessageHandler(() => FakeJobberGraphQlHandler);
            services.AddHttpClient<DIYHelper2.Api.Integrations.Crm.HousecallTokenService>().ConfigurePrimaryHttpMessageHandler(() => FakeHousecallTokenHandler);
            services.AddHttpClient<DIYHelper2.Api.Integrations.Crm.HousecallCrmSink>().ConfigurePrimaryHttpMessageHandler(() => FakeHousecallApiHandler);
            services.AddHttpClient<DIYHelper2.Api.Integrations.Messaging.ISmsSender,
                DIYHelper2.Api.Integrations.Messaging.TwilioSmsSender>()
                .ConfigurePrimaryHttpMessageHandler(() => FakeTwilioHandler);
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
    /// Insert-or-update a white-label brand row. Idempotent by slug so tests in
    /// the same fixture can call it repeatedly. Pass username+password to make it
    /// a dashboard-capable tenant (the password is BCrypt-hashed).
    /// </summary>
    public async Task SeedBrandAsync(
        string slug, string companyName, string leadEmail,
        string? username = null, string? password = null, bool isActive = true,
        string? leadWebhookUrl = null,
        string? serviceTypesJson = null, string? featuresJson = null,
        bool membershipEnabled = false, string? phone = null, string? reviewUrl = null,
        // Self-scheduling knobs (A6). Null → leave the model defaults / the
        // existing row's values untouched.
        string? businessHoursJson = null, int? slotMinutes = null,
        int? slotCapacity = null, string? timeZoneId = null)
    {
        using var scope = Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var hash = password is null ? null : Sburson.Shared.Auth.PasswordHasher.Hash(password);
        var existing = await db.Brands.FirstOrDefaultAsync(b => b.Slug == slug);
        if (existing is null)
        {
            existing = new DIYHelper2.Api.Models.Brand { Slug = slug };
            db.Brands.Add(existing);
        }
        existing.CompanyName = companyName;
        existing.LeadEmail = leadEmail;
        existing.DashboardUsername = username;
        existing.DashboardPasswordHash = hash;
        existing.IsActive = isActive;
        existing.LeadWebhookUrl = leadWebhookUrl;
        existing.ServiceTypesJson = serviceTypesJson;
        existing.FeaturesJson = featuresJson;
        existing.MembershipEnabled = membershipEnabled;
        existing.Phone = phone;
        existing.ReviewUrl = reviewUrl;
        if (businessHoursJson is not null) existing.BusinessHoursJson = businessHoursJson;
        if (slotMinutes is not null) existing.SlotMinutes = slotMinutes.Value;
        if (slotCapacity is not null) existing.SlotCapacity = slotCapacity;
        if (timeZoneId is not null) existing.TimeZoneId = timeZoneId;
        await db.SaveChangesAsync();
    }

    /// <summary>
    /// Seed an active Jobber CRM connection for a brand, with tokens encrypted by
    /// the same <c>CrmTokenProtector</c> the app uses (resolved from DI) so the
    /// sink can decrypt them. Defaults to a valid (unexpired) access token; pass
    /// a past <paramref name="expiresAt"/> to exercise the refresh path.
    /// </summary>
    public async Task SeedJobberConnectionAsync(
        string brandSlug, string accessToken = "access-tok",
        string? refreshToken = "refresh-tok", DateTime? expiresAt = null)
    {
        using var scope = Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var protector = scope.ServiceProvider.GetRequiredService<DIYHelper2.Api.Integrations.Crm.CrmTokenProtector>();

        var existing = await db.BrandCrmConnections.FirstOrDefaultAsync(c => c.BrandSlug == brandSlug);
        var conn = existing ?? new DIYHelper2.Api.Models.BrandCrmConnection { BrandSlug = brandSlug };
        conn.Provider = (int)DIYHelper2.Api.Integrations.Crm.CrmProvider.Jobber;
        conn.IsActive = true;
        conn.AccessTokenEnc = protector.Protect(accessToken);
        conn.RefreshTokenEnc = refreshToken is null ? null : protector.Protect(refreshToken);
        conn.AccessTokenExpiresAt = expiresAt ?? DateTime.UtcNow.AddHours(1);
        if (existing is null) db.BrandCrmConnections.Add(conn);
        await db.SaveChangesAsync();
    }

    /// <summary>Seed an active Housecall Pro CRM connection for a brand (see
    /// <see cref="SeedJobberConnectionAsync"/>). Pass a past <paramref name="expiresAt"/>
    /// to exercise the refresh path.</summary>
    public async Task SeedHousecallConnectionAsync(
        string brandSlug, string accessToken = "access-tok",
        string? refreshToken = "refresh-tok", DateTime? expiresAt = null)
    {
        using var scope = Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var protector = scope.ServiceProvider.GetRequiredService<DIYHelper2.Api.Integrations.Crm.CrmTokenProtector>();

        var existing = await db.BrandCrmConnections.FirstOrDefaultAsync(c => c.BrandSlug == brandSlug);
        var conn = existing ?? new DIYHelper2.Api.Models.BrandCrmConnection { BrandSlug = brandSlug };
        conn.Provider = (int)DIYHelper2.Api.Integrations.Crm.CrmProvider.HousecallPro;
        conn.IsActive = true;
        conn.AccessTokenEnc = protector.Protect(accessToken);
        conn.RefreshTokenEnc = refreshToken is null ? null : protector.Protect(refreshToken);
        conn.AccessTokenExpiresAt = expiresAt ?? DateTime.UtcNow.AddHours(1);
        if (existing is null) db.BrandCrmConnections.Add(conn);
        await db.SaveChangesAsync();
    }

    /// <summary>
    /// Insert a push-token row directly (bypasses the /api/push/register HTTP
    /// path so bulk seeding doesn't trip the per-IP "submit" rate limiter).
    /// Returns the Expo token so a test can reference it.
    /// </summary>
    public async Task<string> SeedPushTokenAsync(
        string brand, string platform = "ios", bool marketingOptIn = true, bool isActive = true, string? token = null)
    {
        token ??= $"ExponentPushToken[{Guid.NewGuid():N}]";
        using var scope = Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        db.Add(new DIYHelper2.Api.Models.PushToken
        {
            Brand = brand,
            Token = token,
            Platform = platform,
            MarketingOptIn = marketingOptIn,
            IsActive = isActive,
        });
        await db.SaveChangesAsync();
        return token;
    }

    /// <summary>HttpClient with Basic auth for a per-brand dashboard login.</summary>
    public HttpClient CreateBrandClient(string username, string password)
    {
        var client = CreateClient();
        var b64 = Convert.ToBase64String(System.Text.Encoding.UTF8.GetBytes($"{username}:{password}"));
        client.DefaultRequestHeaders.Authorization =
            new System.Net.Http.Headers.AuthenticationHeaderValue("Basic", b64);
        return client;
    }

    /// <summary>
    /// Populate the DI-resolved <see cref="AiKeyStore"/> with a non-empty key
    /// so AI-backed endpoints can reach the (stubbed) AI client. Call this
    /// from tests that want to exercise the full analyze pipeline.
    /// </summary>
    public void SetOpenAiKey(string key)
    {
        using var scope = Services.CreateScope();
        var store = scope.ServiceProvider.GetRequiredService<AiKeyStore>();
        store.OpenAiKey = key;
    }

    /// <summary>
    /// Populate RuntimeConfigStore.GoogleApiKey so GeocodingClient (and the
    /// translate endpoint) consider themselves configured. Pair with
    /// <see cref="FakeGeocodeHandler"/> to shape the geocode response.
    /// </summary>
    public void SetGoogleApiKey(string key)
    {
        Services.GetRequiredService<DIYHelper2.Api.Services.RuntimeConfigStore>().GoogleApiKey = key;
    }

    public new Task InitializeAsync()
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
}
