using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.HttpOverrides;
using Microsoft.EntityFrameworkCore;
using OpenAI.Chat;
using OpenAI;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Linq;
using System.ClientModel;
using System.ClientModel.Primitives;
using Amazon.SecretsManager;
using Amazon.SecretsManager.Model;
using DIYHelper2.Api;
using DIYHelper2.Api.Data;
using DIYHelper2.Api.Models;
using DIYHelper2.Api.Middleware;
using Sburson.Shared.Mobile;
using DIYHelper2.Api.AI;
using DIYHelper2.Api.Integrations;
using DIYHelper2.Api.Validation;
using Sburson.Shared.AI;
using Sburson.Shared.DataDeletion;
using Sburson.Shared.Email;
using Sburson.Shared.FeatureFlags;
using Sburson.Shared.Http;
using Sburson.Shared.Observability;
using Sburson.Shared.Storage;
using Sburson.Shared.Web;
using Microsoft.AspNetCore.RateLimiting;
using System.Threading.RateLimiting;
using OpenTelemetry;
using OpenTelemetry.Metrics;
using OpenTelemetry.Resources;
using OpenTelemetry.Trace;
using DIYHelper2.Api.Endpoints;
using static DIYHelper2.Api.Endpoints.EndpointHelpers;

var builder = WebApplication.CreateBuilder(args);
builder.AddSburonSentry(opts =>
{
    opts.AppSlug = "diyhelper2-api";
    opts.AdditionalSensitiveHeaders.Add("X-Play-Integrity-Token");
});

// Add services to the container.
builder.Services.AddOpenApi();

builder.Logging.ClearProviders();
if (builder.Environment.IsDevelopment())
{
    builder.Logging.AddSimpleConsole(options =>
    {
        options.IncludeScopes = true;
        options.TimestampFormat = "yyyy-MM-dd HH:mm:ss ";
    });
}
else
{
    // Structured JSON — one line per event, CloudWatch-parseable.
    builder.Logging.AddJsonConsole(options =>
    {
        options.IncludeScopes = true;
        options.UseUtcTimestamp = true;
        options.TimestampFormat = "yyyy-MM-ddTHH:mm:ss.fffZ";
        options.JsonWriterOptions = new System.Text.Json.JsonWriterOptions { Indented = false };
    });
}

// ── OpenTelemetry ─────────────────────────────────────────────────────
var otelServiceName = Environment.GetEnvironmentVariable("OTEL_SERVICE_NAME") ?? "diyhelper2-api";
var otelEnvironment = builder.Environment.EnvironmentName; // Development / Staging / Production
var otelServiceVersion = typeof(Program).Assembly.GetName().Version?.ToString() ?? "1.0.0";
var useOtlpExporter = !string.IsNullOrEmpty(Environment.GetEnvironmentVariable("OTEL_EXPORTER_OTLP_ENDPOINT"));

var resourceBuilder = ResourceBuilder.CreateDefault()
    .AddService(serviceName: otelServiceName, serviceVersion: otelServiceVersion)
    .AddAttributes(new Dictionary<string, object>
    {
        ["deployment.environment"] = otelEnvironment,
    });

builder.Services.AddOpenTelemetry()
    .WithTracing(tracing =>
    {
        tracing
            .SetResourceBuilder(resourceBuilder)
            .AddAspNetCoreInstrumentation(opts =>
            {
                // Don't trace static files or health checks.
                opts.Filter = ctx => ctx.Request.Path.StartsWithSegments("/api");
            })
            .AddHttpClientInstrumentation();

        if (useOtlpExporter)
            tracing.AddOtlpExporter();
        else if (builder.Environment.IsDevelopment())
            tracing.AddConsoleExporter();
    })
    .WithMetrics(metrics =>
    {
        metrics
            .SetResourceBuilder(resourceBuilder)
            .AddAspNetCoreInstrumentation()
            .AddHttpClientInstrumentation()
            .AddRuntimeInstrumentation();

        if (useOtlpExporter)
            metrics.AddOtlpExporter();
    });

// Increase max request body size to 50MB (default is 30MB)
builder.WebHost.ConfigureKestrel(serverOptions =>
{
    serverOptions.Limits.MaxRequestBodySize = 50 * 1024 * 1024;
});
builder.Services.Configure<Microsoft.AspNetCore.Http.Features.FormOptions>(options =>
{
    options.MultipartBodyLengthLimit = 50 * 1024 * 1024;
});

// Database — Postgres in production (DATABASE_URL env var, typically loaded
// from Secrets Manager and set by the EB environment config), SQLite locally.
// See Data/DatabaseConfig.cs for the provider decision logic.
builder.Services.AddDbContext<AppDbContext>(DatabaseConfig.Configure);

builder.Services.AddScoped<DIYHelper2.Api.Services.Telemetry.TelemetryIngestService>();
builder.Services.AddScoped<DIYHelper2.Api.Services.Telemetry.UsageDigestService>();

// CORS — the mobile app does NOT need CORS (it isn't a browser). CORS only
// matters when a web origin calls the API. Default to an empty allow-list so
// browser origins are rejected. Set ALLOWED_ORIGINS="https://admin.example.com"
// (comma-separated) to whitelist specific origins when a web admin is added.
var allowedOrigins = (Environment.GetEnvironmentVariable("ALLOWED_ORIGINS") ?? "")
    .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
    .ToArray();
builder.Services.AddCors(options =>
{
    options.AddPolicy("MobilePolicy", policy =>
    {
        if (allowedOrigins.Length > 0)
        {
            policy.WithOrigins(allowedOrigins)
                  .WithMethods("GET", "POST", "PUT", "DELETE")
                  .WithHeaders("Content-Type", "X-Correlation-ID", "X-App-Version", "X-App-Key", "X-Device-Id", "X-Play-Integrity-Token");
        }
        // No origins configured → policy matches nothing → browser requests rejected.
    });
});

// External integration clients (typed HttpClients for uniform retry/timeout/logging).
// Every typed client gets the SsrfGuardHandler so DNS rebinding cannot bounce
// an outbound request into the AWS instance metadata service or loopback.
builder.Services.AddTransient<SsrfGuardHandler>();
builder.Services.AddHttpClient<YouTubeClient>().AddHttpMessageHandler<SsrfGuardHandler>();
builder.Services.AddHttpClient<WeatherClient>().AddHttpMessageHandler<SsrfGuardHandler>();
builder.Services.AddHttpClient<RedditClient>().AddHttpMessageHandler<SsrfGuardHandler>();
builder.Services.AddHttpClient<PubChemClient>().AddHttpMessageHandler<SsrfGuardHandler>();
builder.Services.AddHttpClient<AttomClient>().AddHttpMessageHandler<SsrfGuardHandler>();
builder.Services.AddHttpClient<ReceiptOcrClient>().AddHttpMessageHandler<SsrfGuardHandler>();
// Google Geocoding for job service addresses (route view / Navigate button).
// Key comes from RuntimeConfigStore.GoogleApiKey post-Secrets-Manager; the
// client is fail-soft (null) whenever unconfigured or the lookup misses.
builder.Services.AddHttpClient<GeocodingClient>().AddHttpMessageHandler<SsrfGuardHandler>();
builder.Services.AddHttpClient<DIYHelper2.Api.AI.ModerationService>().AddHttpMessageHandler<SsrfGuardHandler>();
// Expo push service — fans promotional broadcasts out to registered devices.
builder.Services.AddHttpClient<DIYHelper2.Api.Integrations.ExpoPushClient>().AddHttpMessageHandler<SsrfGuardHandler>();
// Brand Studio: scrapes a customer's website to seed a white-label brand.
builder.Services.AddHttpClient<DIYHelper2.Api.Integrations.BrandExtractionClient>().AddHttpMessageHandler<SsrfGuardHandler>();
// CRM lead delivery — a second, best-effort channel alongside the brand email.
// The webhook sink covers the long tail (Zapier/Make → the company's own CRM);
// native OAuth providers (Jobber, Housecall Pro) plug in later as additional
// ICrmLeadSink registrations. SsrfGuard matters on the webhook client because
// its destination URL is brand-operator supplied.
builder.Services.AddHttpClient<DIYHelper2.Api.Integrations.Crm.WebhookCrmSink>().AddHttpMessageHandler<SsrfGuardHandler>();
builder.Services.AddScoped<DIYHelper2.Api.Integrations.Crm.ICrmLeadSink>(
    sp => sp.GetRequiredService<DIYHelper2.Api.Integrations.Crm.WebhookCrmSink>());
builder.Services.AddScoped<DIYHelper2.Api.Integrations.Crm.CrmLeadDispatcher>();
// Jobber (getjobber.com) — native OAuth 2.0 + GraphQL CRM integration. Our app
// credentials come from env; per-brand tokens are stored (AES-GCM encrypted) in
// BrandCrmConnection. Both typed clients are SsrfGuard-wrapped like every other
// external client (api.getjobber.com is public, so the guard passes it through).
builder.Services.AddSingleton(_ => new DIYHelper2.Api.Integrations.Crm.JobberOptions
{
    ClientId = Environment.GetEnvironmentVariable("JOBBER_CLIENT_ID"),
    ClientSecret = Environment.GetEnvironmentVariable("JOBBER_CLIENT_SECRET"),
    RedirectUri = Environment.GetEnvironmentVariable("JOBBER_REDIRECT_URI"),
});
builder.Services.AddSingleton<DIYHelper2.Api.Integrations.Crm.CrmTokenProtector>();
// Signs/validates the mobile "tech mode" bearer tokens (HMAC). Key from env.
builder.Services.AddSingleton<DIYHelper2.Api.Services.TechTokenService>();
// Console session auth: the two-tier credential check + brute-force throttle
// shared by AdminAuthMiddleware and POST /admin/session (super-admin creds are
// populated post-Secrets-Manager below), and the HMAC session-cookie tokens
// (key from ADMIN_SESSION_KEY, same posture as TECH_TOKEN_KEY).
builder.Services.AddSingleton<DIYHelper2.Api.Services.AdminCredentialVerifier>();
builder.Services.AddSingleton<DIYHelper2.Api.Services.AdminSessionService>();
builder.Services.AddHttpClient<DIYHelper2.Api.Integrations.Crm.JobberTokenService>().AddHttpMessageHandler<SsrfGuardHandler>();
builder.Services.AddHttpClient<DIYHelper2.Api.Integrations.Crm.JobberCrmSink>().AddHttpMessageHandler<SsrfGuardHandler>();
builder.Services.AddScoped<DIYHelper2.Api.Integrations.Crm.ICrmLeadSink>(
    sp => sp.GetRequiredService<DIYHelper2.Api.Integrations.Crm.JobberCrmSink>());
// Housecall Pro — native partner OAuth 2.0 + REST. Same shape as Jobber; shares
// CrmTokenProtector + BrandCrmConnection. Creates a customer then a Job-Inbox lead.
builder.Services.AddSingleton(_ => new DIYHelper2.Api.Integrations.Crm.HousecallOptions
{
    ClientId = Environment.GetEnvironmentVariable("HOUSECALL_CLIENT_ID"),
    ClientSecret = Environment.GetEnvironmentVariable("HOUSECALL_CLIENT_SECRET"),
    RedirectUri = Environment.GetEnvironmentVariable("HOUSECALL_REDIRECT_URI"),
});
builder.Services.AddHttpClient<DIYHelper2.Api.Integrations.Crm.HousecallTokenService>().AddHttpMessageHandler<SsrfGuardHandler>();
builder.Services.AddHttpClient<DIYHelper2.Api.Integrations.Crm.HousecallCrmSink>().AddHttpMessageHandler<SsrfGuardHandler>();
builder.Services.AddScoped<DIYHelper2.Api.Integrations.Crm.ICrmLeadSink>(
    sp => sp.GetRequiredService<DIYHelper2.Api.Integrations.Crm.HousecallCrmSink>());

// ── Billing seam (Stripe payments, QuickBooks invoicing) ──────────────────
// Provider-agnostic contracts (Integrations/Billing) with fail-soft impls, the
// same shape as the CRM seam above. Credentials come from env; both providers
// stay dormant (IsConfigured=false) until keys are set, so booking and the
// customer app never depend on billing being live. Stripe's typed client is
// SsrfGuard-wrapped like every external client (api.stripe.com passes through).
builder.Services.AddSingleton(_ => new DIYHelper2.Api.Integrations.Billing.StripeOptions
{
    SecretKey = Environment.GetEnvironmentVariable("STRIPE_SECRET_KEY"),
    MembershipPriceId = Environment.GetEnvironmentVariable("STRIPE_MEMBERSHIP_PRICE_ID"),
});
builder.Services.AddSingleton(_ => new DIYHelper2.Api.Integrations.Billing.QuickBooksOptions
{
    ClientId = Environment.GetEnvironmentVariable("QBO_CLIENT_ID"),
    ClientSecret = Environment.GetEnvironmentVariable("QBO_CLIENT_SECRET"),
    RedirectUri = Environment.GetEnvironmentVariable("QBO_REDIRECT_URI"),
    Environment = Environment.GetEnvironmentVariable("QBO_ENVIRONMENT") ?? "sandbox",
    ItemId = Environment.GetEnvironmentVariable("QBO_ITEM_ID") ?? "1",
});
builder.Services
    .AddHttpClient<DIYHelper2.Api.Integrations.Billing.IPaymentProvider,
        DIYHelper2.Api.Integrations.Billing.StripePaymentProvider>()
    .AddHttpMessageHandler<SsrfGuardHandler>();
// QBO token service + invoice provider are typed HttpClients (SSRF-guarded) that
// inject AppDbContext, mirroring the Jobber wiring above.
builder.Services.AddHttpClient<DIYHelper2.Api.Integrations.Billing.QuickBooksTokenService>()
    .AddHttpMessageHandler<SsrfGuardHandler>();
builder.Services
    .AddHttpClient<DIYHelper2.Api.Integrations.Billing.IInvoiceProvider,
        DIYHelper2.Api.Integrations.Billing.QuickBooksInvoiceProvider>()
    .AddHttpMessageHandler<SsrfGuardHandler>();

// ── SMS / messaging seam (Twilio) ─────────────────────────────────────────
// Provider-agnostic ISmsSender with a fail-soft Twilio impl (SSRF-guarded typed
// client), plus MessagingService which composes + logs customer texts. Dormant
// (IsConfigured=false) until TWILIO_* env is set, so nothing texts until then.
builder.Services.AddSingleton(_ => new DIYHelper2.Api.Integrations.Messaging.TwilioOptions
{
    AccountSid = Environment.GetEnvironmentVariable("TWILIO_ACCOUNT_SID"),
    AuthToken = Environment.GetEnvironmentVariable("TWILIO_AUTH_TOKEN"),
    FromNumber = Environment.GetEnvironmentVariable("TWILIO_FROM_NUMBER"),
});
builder.Services
    .AddHttpClient<DIYHelper2.Api.Integrations.Messaging.ISmsSender,
        DIYHelper2.Api.Integrations.Messaging.TwilioSmsSender>()
    .AddHttpMessageHandler<SsrfGuardHandler>();
builder.Services.AddScoped<DIYHelper2.Api.Services.MessagingService>();

// Mobile abuse-prevention from Sburson.Shared.Mobile. Env vars are read
// lazily inside the Transient factory delegate so test fixtures that
// set PLAY_INTEGRITY_* / DAILY_DEVICE_AI_LIMIT after the host builds
// (e.g. via IAsyncLifetime.InitializeAsync) still take effect — matches
// the prior local-class behavior that read env vars per construction.
builder.Services.AddTransient(_ => new Sburson.Shared.Mobile.PlayIntegrityOptions
{
    ProjectNumber = Environment.GetEnvironmentVariable("PLAY_INTEGRITY_PROJECT_NUMBER"),
    PackageName = Environment.GetEnvironmentVariable("PLAY_INTEGRITY_PACKAGE_NAME") ?? "com.diyhelper2",
    RequireDeviceIntegrity = string.Equals(
        Environment.GetEnvironmentVariable("PLAY_INTEGRITY_REQUIRE_MEETS_DEVICE_INTEGRITY"),
        "true", StringComparison.OrdinalIgnoreCase),
    AccessTokenOverride = Environment.GetEnvironmentVariable("PLAY_INTEGRITY_ACCESS_TOKEN"),
});
builder.Services.AddHttpClient<Sburson.Shared.Mobile.PlayIntegrityVerifier>(c => c.Timeout = TimeSpan.FromSeconds(5))
    .AddHttpMessageHandler<SsrfGuardHandler>();
builder.Services.AddSingleton(_ => new Sburson.Shared.Mobile.DeviceQuotaOptions
{
    // Free-to-customer default: 15 AI calls/device/day bounds worst-case spend
    // per user while covering normal multi-project usage. Raise via env if a
    // deployment needs more headroom. Was 60.
    DailyLimit = int.TryParse(Environment.GetEnvironmentVariable("DAILY_DEVICE_AI_LIMIT"), out var dailyLimit) && dailyLimit > 0 ? dailyLimit : 15,
});
builder.Services.AddSingleton<Sburson.Shared.Mobile.DeviceQuotaService>();
// Process-wide daily backstop on aggregate AI call volume (runaway-spend guard).
builder.Services.AddSingleton<DIYHelper2.Api.Services.AiSpendGuard>();

// Post-build-populated config (secrets bundle values), the translate cache and
// the hazardous-chemicals list — singletons so endpoint handlers inject them
// instead of closing over Program.cs locals (prerequisite for the endpoint-
// group split under Endpoints/).
builder.Services.AddSingleton<DIYHelper2.Api.Services.RuntimeConfigStore>();
builder.Services.AddSingleton<DIYHelper2.Api.Services.TranslationCache>();
builder.Services.AddSingleton<DIYHelper2.Api.Data.HazardousChemicalsProvider>();
builder.Services.AddSburonEmail(builder.Configuration);
// S3 object storage for job media (booking photo, tech before/after photos,
// signature). AddSburonObjectStorage is a no-op unless Storage:S3:Bucket is
// configured, so local/dev keeps writing base64 columns; JobMediaService
// takes IObjectStorage as an optional dependency and fail-softs throughout.
builder.Services.AddSburonObjectStorage(builder.Configuration);
builder.Services.AddSingleton<DIYHelper2.Api.Services.JobMediaService>();
builder.Services.AddSingleton<AmazonPaClient>();
builder.Services.AddSingleton<PaintColorClient>();
builder.Services.AddSingleton<FeatureFlags>();
builder.Services.AddHostedService<DIYHelper2.Api.Services.RetentionService>();
// Job-completion side effects (invoice, report email, maintenance, review SMS)
// + the daily maintenance-reminder sweep.
builder.Services.AddScoped<DIYHelper2.Api.Services.JobCompletionService>();
// Shared status-write path (timestamp stamping + transition side effects) so
// the owner PUT and tech PUT behave identically.
builder.Services.AddScoped<DIYHelper2.Api.Services.HelpRequestWriteService>();
builder.Services.AddHostedService<DIYHelper2.Api.Services.MaintenanceReminderService>();

// Push notifications: the send service is scoped (per-request / per-tick DbContext),
// with two background workers — one to dispatch scheduled campaigns, one to poll
// Expo delivery receipts and prune dead tokens.
builder.Services.AddScoped<DIYHelper2.Api.Services.PushSendService>();
builder.Services.AddHostedService<DIYHelper2.Api.Services.PushDispatchService>();
builder.Services.AddHostedService<DIYHelper2.Api.Services.PushReceiptService>();

// Shared web pipeline (CorrelationId / Exception / RequestLogging / SecurityHeaders).
// DIYHelper2 also classifies OpenAI ClientResultException to friendly statuses —
// register that as an app-specific classifier; the package stays SDK-free.
builder.Services.AddSburonWeb(classifiers =>
{
    classifiers.Add(ex =>
    {
        if (ex is ClientResultException cre)
        {
            var status = cre.Status;
            if (status == 429)
                return (429, "The service is temporarily busy. Please wait a moment and try again.", "rate_limited");
            if (status == 400 || ex.Message.Contains("content_filter", StringComparison.OrdinalIgnoreCase))
                return (422, "The AI could not process this request. Try a shorter description or different photo.", "ai_rejected");
            return (502, "The AI service returned an error. Please try again.", "ai_error");
        }
        return null;
    });
});

// ── AI vision client DI wiring ─────────────────────────────────────
// AiKeyStore is a mutable holder populated after AWS Secrets Manager
// resolution (below). IAIVisionClient is registered as a singleton that
// reads from the store on first access — this lets us keep the existing
// post-build key-fetch pattern while still exposing a stubbable seam for
// integration tests (ApiFactory can replace the IAIVisionClient registration).
builder.Services.AddSingleton<AiKeyStore>();
builder.Services.AddSingleton<IAIVisionClient>(sp =>
{
    var store = sp.GetRequiredService<AiKeyStore>();
    var provider = Environment.GetEnvironmentVariable("AI_PROVIDER")?.ToLowerInvariant() ?? "openai";

    var openAi = new OpenAIVisionClient(
        apiKey: store.OpenAiKey ?? string.Empty,
        logger: sp.GetRequiredService<ILogger<OpenAIVisionClient>>(),
        model: store.OpenAiModel);

    IAIVisionClient? anthropic = null;
    if (!string.IsNullOrEmpty(store.AnthropicKey))
    {
        anthropic = new AnthropicVisionClient(
            http: new HttpClient { Timeout = TimeSpan.FromMinutes(2) },
            apiKey: store.AnthropicKey,
            logger: sp.GetRequiredService<ILogger<AnthropicVisionClient>>(),
            model: store.AnthropicModel);
    }

    return new AIClientFactory(
        openAi: openAi,
        anthropic: anthropic,
        mode: provider,
        logger: sp.GetRequiredService<ILogger<AIClientFactory>>());
});

// Per-IP rate limiting protects the OpenAI key from a single abusive client
// burning through quota. "ai" is applied to the GPT-4o-backed endpoints
// (analyze / ask-helper / verify-step / diagnose / clarify). "translate"
// gets its own bucket because batched translations are legitimately chatty.
builder.Services.AddRateLimiter(options =>
{
    options.RejectionStatusCode = StatusCodes.Status429TooManyRequests;

    static string IpKey(HttpContext ctx) =>
        ctx.Request.Headers["X-Forwarded-For"].FirstOrDefault()?.Split(',').FirstOrDefault()?.Trim()
        ?? ctx.Connection.RemoteIpAddress?.ToString()
        ?? "unknown";

    options.AddPolicy("ai", httpContext =>
        RateLimitPartition.GetFixedWindowLimiter(IpKey(httpContext), _ => new FixedWindowRateLimiterOptions
        {
            PermitLimit = 20,
            Window = TimeSpan.FromMinutes(1),
            QueueLimit = 0,
            AutoReplenishment = true,
        }));

    options.AddPolicy("translate", httpContext =>
        RateLimitPartition.GetFixedWindowLimiter(IpKey(httpContext), _ => new FixedWindowRateLimiterOptions
        {
            PermitLimit = 120,
            Window = TimeSpan.FromMinutes(1),
            QueueLimit = 0,
            AutoReplenishment = true,
        }));

    // "submit" covers write endpoints that persist user-generated content
    // (help requests, community posts, beta feedback). Keep it generous for
    // real humans but block bots flooding the DB / in-memory list.
    options.AddPolicy("submit", httpContext =>
        RateLimitPartition.GetFixedWindowLimiter(IpKey(httpContext), _ => new FixedWindowRateLimiterOptions
        {
            PermitLimit = 10,
            Window = TimeSpan.FromMinutes(1),
            QueueLimit = 0,
            AutoReplenishment = true,
        }));
});

// Give in-flight requests time to drain on shutdown/redeploy instead of the
// ASP.NET Core default 5s, which would abort AI calls mid-flight on every
// deploy. 30s covers the vast majority of analyze/live-DIY calls without making
// a rolling deploy wait on the 2-minute worst-case ceiling. Override with
// SHUTDOWN_TIMEOUT_SECONDS if needed.
builder.Services.Configure<HostOptions>(o =>
    o.ShutdownTimeout = TimeSpan.FromSeconds(
        int.TryParse(Environment.GetEnvironmentVariable("SHUTDOWN_TIMEOUT_SECONDS"), out var s) && s > 0 ? s : 30));

var app = builder.Build();

// One-shot pull of the AWS Secrets Manager bundle so we only open a client
// once at startup. The bundle is a flat JSON object; individual fields are
// promoted into env vars / config below.
Dictionary<string, string> secretBundle;
{
    var startupLogger = app.Services.GetRequiredService<ILogger<Program>>();
    secretBundle = new Dictionary<string, string>(StringComparer.Ordinal);
    var secretArn = Environment.GetEnvironmentVariable("SECRET_ARN");
    if (!string.IsNullOrEmpty(secretArn))
    {
        try
        {
            using var smClient = new AmazonSecretsManagerClient(Amazon.RegionEndpoint.USEast1);
            var response = await smClient.GetSecretValueAsync(new GetSecretValueRequest { SecretId = secretArn });
            try
            {
                var parsed = JsonSerializer.Deserialize<JsonElement>(response.SecretString);
                if (parsed.ValueKind == JsonValueKind.Object)
                {
                    foreach (var prop in parsed.EnumerateObject())
                    {
                        if (prop.Value.ValueKind == JsonValueKind.String)
                        {
                            var v = prop.Value.GetString();
                            if (!string.IsNullOrEmpty(v)) secretBundle[prop.Name] = v;
                        }
                    }
                }
            }
            catch (JsonException)
            {
                // Bare string secret (legacy single-key format) — treat as OPENAI_API_KEY.
                if (!string.IsNullOrEmpty(response.SecretString))
                    secretBundle["OPENAI_API_KEY"] = response.SecretString;
            }
            startupLogger.LogInformation("Secrets Manager bundle loaded ({Count} keys).", secretBundle.Count);
        }
        catch (Exception ex)
        {
            startupLogger.LogError(ex, "Failed to fetch secret from Secrets Manager (ARN: {Arn}).", secretArn);
        }
    }
}

// Resolve a value preferring the Secrets Manager bundle, falling back to env vars.
string? SecretOrEnv(params string[] names)
{
    foreach (var n in names)
    {
        if (secretBundle.TryGetValue(n, out var v) && !string.IsNullOrEmpty(v)) return v;
    }
    foreach (var n in names)
    {
        var v = Environment.GetEnvironmentVariable(n);
        if (!string.IsNullOrEmpty(v)) return v;
    }
    return null;
}

string? openAiKey = SecretOrEnv("OPENAI_API_KEY");
{
    var startupLogger = app.Services.GetRequiredService<ILogger<Program>>();
    if (string.IsNullOrEmpty(openAiKey))
        startupLogger.LogWarning("OPENAI_API_KEY is not configured. Set SECRET_ARN or OPENAI_API_KEY env var.");
    else
        startupLogger.LogInformation("Backend starting up. Listening for requests...");

    // Propagate keys into the DI-registered AiKeyStore so IAIVisionClient
    // (registered in builder.Services) resolves with a usable credential.
    var aiKeys = app.Services.GetRequiredService<AiKeyStore>();
    aiKeys.OpenAiKey = openAiKey;
    aiKeys.AnthropicKey = SecretOrEnv("ANTHROPIC_API_KEY");
    // Model selection is env-overridable; falls back to the cheap defaults
    // baked into AiKeyStore. Set OPENAI_MODEL / ANTHROPIC_MODEL to change the
    // whole app's model in one place without a redeploy of new code.
    var openAiModelOverride = SecretOrEnv("OPENAI_MODEL");
    if (!string.IsNullOrWhiteSpace(openAiModelOverride)) aiKeys.OpenAiModel = openAiModelOverride;
    var anthropicModelOverride = SecretOrEnv("ANTHROPIC_MODEL");
    if (!string.IsNullOrWhiteSpace(anthropicModelOverride)) aiKeys.AnthropicModel = anthropicModelOverride;
    startupLogger.LogInformation("AI models: openai={OpenAiModel} anthropic={AnthropicModel}", aiKeys.OpenAiModel, aiKeys.AnthropicModel);
}

// Shared-secret app key. If configured, AppKeyMiddleware rejects any API
// request that doesn't send a matching X-App-Key header.
string? appKey = SecretOrEnv("APP_KEY");

// Admin Basic-Auth credentials for /admin/* and the admin-only /api/help-requests
// and /api/feedback (GET) surfaces. Missing credentials cause AdminAuthMiddleware
// to return 401 (fail-closed) so a misconfigured production never accidentally
// exposes the admin endpoints.
string? adminUsername = SecretOrEnv("ADMIN_USERNAME");
string? adminPassword = SecretOrEnv("ADMIN_PASSWORD");

// Postgres connection string. Promoted into the process env var so
// DatabaseConfig.Configure — which runs lazily on first DbContext resolution —
// picks it up. Absent → the app falls back to SQLite for local dev.
if (string.IsNullOrEmpty(Environment.GetEnvironmentVariable("DATABASE_URL"))
    && secretBundle.TryGetValue("DATABASE_URL", out var dbUrlFromBundle))
{
    Environment.SetEnvironmentVariable("DATABASE_URL", dbUrlFromBundle);
}

// Affiliate + Google API config lands in RuntimeConfigStore so handlers can
// inject it. Env vars override the defaults; empty value disables the URL
// param so shopping links stay valid search links. The Google key ("GOOGLE_API_KEY",
// legacy "GOOGLE_TRANSLATE_API_KEY") may come from the Secrets Manager bundle,
// which is only available here — after host build.
var runtimeConfig = app.Services.GetRequiredService<DIYHelper2.Api.Services.RuntimeConfigStore>();
runtimeConfig.AmazonAssociateTag = Environment.GetEnvironmentVariable("AMAZON_ASSOCIATE_TAG") ?? "diyhelper20-20";
runtimeConfig.HomeDepotImpactId = Environment.GetEnvironmentVariable("HOMEDEPOT_IMPACT_ID") ?? "";
runtimeConfig.GoogleApiKey = SecretOrEnv("GOOGLE_API_KEY", "GOOGLE_TRANSLATE_API_KEY");

// Database schema setup.
//  - Postgres: apply EF migrations (versioned, checked in under Migrations/).
//    Safe to run on every startup — already-applied migrations are a no-op.
//  - SQLite: use EnsureCreated() so dev/test envs don't need the migration
//    tool. The schema is defined by the models; migrations are only tracked
//    for the production dialect.
using (var scope = app.Services.CreateScope())
{
    var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
    var startupLogger = app.Services.GetRequiredService<ILogger<Program>>();
    var provider = DatabaseConfig.ResolveProvider();

    // Fail-fast guard against silent SQLite fallback in production.
    // Provider selection is purely "is DATABASE_URL set?" — so if Secrets
    // Manager was slow/unreachable at boot (its failure is swallowed above),
    // DATABASE_URL never gets populated and the app would otherwise start on an
    // ephemeral local SQLite file, report healthy, and write customer data to a
    // disk that vanishes on the next restart. Crash loudly instead: a
    // non-Development environment MUST have Postgres configured.
    if (provider != DatabaseConfig.Provider.Postgres && !app.Environment.IsDevelopment())
    {
        startupLogger.LogCritical(
            "DATABASE_URL is not configured in environment '{Env}'. Refusing to start on ephemeral SQLite — " +
            "check SECRET_ARN / Secrets Manager connectivity and the DATABASE_URL secret.",
            app.Environment.EnvironmentName);
        throw new InvalidOperationException(
            $"Postgres is required in '{app.Environment.EnvironmentName}' but DATABASE_URL is not set. " +
            "Aborting startup rather than silently using ephemeral SQLite.");
    }

    if (provider == DatabaseConfig.Provider.Postgres)
    {
        // Retry-with-backoff around the boot-time migration. On a rolling deploy
        // the DB can briefly be unreachable (failover, cold RDS); without this a
        // transient blip throws out of Main → the container exits non-zero →
        // crash-loop. Retrying a handful of times rides out the blip; if the DB
        // is genuinely down we still fail fast rather than hang forever.
        const int maxAttempts = 5;
        for (var attempt = 1; ; attempt++)
        {
            try
            {
                db.Database.Migrate();
                break;
            }
            catch (Exception ex) when (attempt < maxAttempts)
            {
                var delay = TimeSpan.FromSeconds(Math.Min(30, Math.Pow(2, attempt)));
                startupLogger.LogWarning(ex,
                    "Database migration attempt {Attempt}/{Max} failed; retrying in {Delay}s.",
                    attempt, maxAttempts, delay.TotalSeconds);
                await Task.Delay(delay);
            }
        }
    }
    else
    {
        db.Database.EnsureCreated();
    }

    // Seed white-label brands on first boot. Idempotent — skips if any exist,
    // so editing a brand later (dashboard/DB) is never clobbered by a restart.
    if (!db.Brands.Any())
    {
        var seedLogger = app.Services.GetRequiredService<ILogger<Program>>();
        var now = DateTime.UtcNow;

        // Flagship brand — routes leads to your own ops inbox and signs into the
        // dashboard via the super-admin config creds, so it has no dashboard row.
        db.Brands.Add(new Brand
        {
            Slug = "diyhelper",
            CompanyName = "DIY Helper",
            LeadEmail = SecretOrEnv("SEED_DIYHELPER_LEAD_EMAIL") ?? "",
            IsActive = true,
            ServiceTypesJson = "[\"General repair\",\"Plumbing\",\"Electrical\",\"Painting\",\"Other\"]",
            CreatedAt = now,
            UpdatedAt = now,
        });

        // Demo client brand. Gets its own scoped dashboard login only when a seed
        // password is configured; otherwise seeded inactive (fail-closed) so the
        // account can't be logged into with a blank credential.
        var acmePassword = SecretOrEnv("SEED_ACME_ADMIN_PASSWORD");
        db.Brands.Add(new Brand
        {
            Slug = "acme-home",
            CompanyName = "Acme Home Helper",
            LeadEmail = SecretOrEnv("SEED_ACME_LEAD_EMAIL") ?? "",
            DashboardUsername = "acme-admin",
            DashboardPasswordHash = string.IsNullOrEmpty(acmePassword)
                ? null
                : Sburson.Shared.Auth.PasswordHasher.Hash(acmePassword),
            IsActive = !string.IsNullOrEmpty(acmePassword),
            ServiceTypesJson = "[\"Plumbing\",\"Drain cleaning\",\"Water heaters\",\"HVAC\",\"Other\"]",
            CreatedAt = now,
            UpdatedAt = now,
        });

        db.SaveChanges();
        seedLogger.LogInformation("Seeded white-label brands (diyhelper, acme-home).");
    }
}

// Configure the HTTP request pipeline.
if (app.Environment.IsDevelopment())
{
    app.MapOpenApi();
}

// Trust X-Forwarded-* headers only when we are running behind the ALB so the
// rate limiter sees the real client IP and HTTPS redirects work correctly.
// In production EB puts us behind an AWS ALB which strips and rewrites these
// headers for us; we just need to consume them. KnownNetworks/Proxies are
// left empty because .NET's default is to trust localhost (where nginx
// forwards from) which matches the Elastic Beanstalk proxy topology.
if (!app.Environment.IsDevelopment())
{
    var fhOptions = new ForwardedHeadersOptions
    {
        ForwardedHeaders = ForwardedHeaders.XForwardedFor | ForwardedHeaders.XForwardedProto,
        ForwardLimit = 2,
    };
    // Clear defaults so we don't restrict to loopback only. EB's nginx proxy
    // forwards from the instance, and the ALB forwards from its private subnet.
    fhOptions.KnownIPNetworks.Clear();
    fhOptions.KnownProxies.Clear();
    app.UseForwardedHeaders(fhOptions);
}

// Correlation ID must run before anything that wants to log with it.
app.UseMiddleware<CorrelationIdMiddleware>();
app.UseSburonSentry();
app.UseMiddleware<SecurityHeadersMiddleware>();

// Admin auth gate (session cookie OR Basic) BEFORE static files, gating the
// admin-only API surfaces. /admin/* static files themselves are served without
// auth (UI shell only — the console renders its own login form); the
// credentials live in AdminCredentialVerifier, shared with POST /admin/session.
app.Services.GetRequiredService<DIYHelper2.Api.Services.AdminCredentialVerifier>()
    .Configure(adminUsername, adminPassword);
app.UseMiddleware<AdminAuthMiddleware>();

app.UseDefaultFiles();
app.UseStaticFiles();

app.UseCors("MobilePolicy");

app.UseRateLimiter();

// Remaining observability middleware — order matters:
// - AppKey: rejects requests missing the shared secret (no-op if unset)
// - ExceptionHandler: catches unhandled throws, logs them, returns safe JSON
// - RequestLogging: logs method/path/status/duration for every API request
app.UseMiddleware<AppKeyMiddleware>(new AppKeyOptions
{
    ExpectedKey = appKey,
    // Defaults + external webhook paths that can't carry X-App-Key. Twilio calls
    // /api/sms/* directly; a shared webhook token (TWILIO_WEBHOOK_TOKEN) guards
    // those handlers instead. OAuth callbacks are exact-match entries (no trailing
    // slash): providers redirect the browser there without our headers; the signed
    // 10-minute state parameter is what authenticates those requests.
    PublicPathPrefixes = new[]
    {
        "/", "/healthz", "/api/health", "/openapi", "/openapi/", "/.well-known/",
        "/api/sms/",       // Twilio webhooks
        "/api/stripe/",    // Stripe payment webhooks
        "/api/crm/jobber/callback",
        "/api/crm/housecall/callback",
        "/api/accounting/qbo/callback",
    },
});
app.UseMiddleware<ExceptionHandlerMiddleware>();
app.UseMiddleware<RequestLoggingMiddleware>();

app.MapHealth(app.Environment);

app.MapAi();

app.MapCustomerApp();

app.MapHelpRequests();

app.MapTechnicians();

app.MapTechPortal();

app.MapCatalog();

app.MapAccounting();

app.MapWebhooks();

app.MapAdminOps();

app.MapAdminSession();

app.MapBrands();

app.MapCrm();

app.MapPush();

app.MapCompliance();

app.MapContent();

app.MapTelemetry();


app.Run();

// Expose the implicit Program type for WebApplicationFactory<Program> in tests.
// Top-level statements generate an internal Program class by default; the
// partial declaration promotes it to public without changing runtime behavior.
public partial class Program { }
