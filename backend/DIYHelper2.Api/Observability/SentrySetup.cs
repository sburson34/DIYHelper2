using System.Reflection;
using System.Text.RegularExpressions;
using Sentry.AspNetCore;
using Sentry.Extensibility;

namespace DIYHelper2.Api.Observability;

/// <summary>
/// Centralised Sentry wiring for the DIYHelper2 API. Reads the DSN from the
/// <c>Sentry__Dsn</c> environment variable (or the <c>Sentry:Dsn</c>
/// configuration key, which ASP.NET maps to the same env var on bind).
///
/// When no DSN is configured the SDK is never initialised so local dev and
/// CI runs stay quiet by default. Sentry runs alongside the existing
/// OpenTelemetry pipeline — OTel handles structured traces/metrics, Sentry
/// owns user-facing error reporting. The two pipelines are intentionally
/// independent: Sentry does not consume OTel spans here, and OTel does not
/// route exceptions to Sentry. This avoids duplicate events when the
/// <c>ExceptionHandlerMiddleware</c> logs + the SDK auto-captures the same
/// throw.
/// </summary>
public static class SentrySetup
{
    private const string DsnEnvVar = "Sentry__Dsn";
    private const string Redacted = "[redacted]";

    private static readonly HashSet<string> SensitiveHeaders = new(StringComparer.OrdinalIgnoreCase)
    {
        "Authorization",
        "Cookie",
        "Set-Cookie",
        "X-Api-Key",
        "X-Admin-Token",
        "X-App-Key",
        "X-Play-Integrity-Token",
    };

    // Catches anything that looks like a bearer/JWT/OpenAI-style key in
    // breadcrumb messages so a stray log line can't leak a secret. The
    // pattern is deliberately broad — false positives are fine in a
    // breadcrumb message; a leaked key is not.
    private static readonly Regex KeyLikeToken = new(
        @"(sk-[A-Za-z0-9_\-]{16,}|Bearer\s+[A-Za-z0-9_\-\.]{16,}|eyJ[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,})",
        RegexOptions.Compiled);

    /// <summary>
    /// Registers Sentry on the host. Safe to call unconditionally — when no
    /// DSN is configured the call returns the builder unchanged so the rest
    /// of the pipeline behaves exactly as before.
    /// </summary>
    public static WebApplicationBuilder AddSentryObservability(this WebApplicationBuilder builder)
    {
        var dsn = builder.Configuration["Sentry:Dsn"]
                  ?? Environment.GetEnvironmentVariable(DsnEnvVar)
                  ?? Environment.GetEnvironmentVariable("SENTRY_DSN");

        if (string.IsNullOrWhiteSpace(dsn))
            return builder;

        var release = Environment.GetEnvironmentVariable("Sentry__Release")
                      ?? Environment.GetEnvironmentVariable("GitSha")
                      ?? typeof(SentrySetup).Assembly
                          .GetCustomAttribute<AssemblyInformationalVersionAttribute>()?.InformationalVersion
                      ?? typeof(SentrySetup).Assembly.GetName().Version?.ToString()
                      ?? "0.0.0";

        builder.WebHost.UseSentry((WebHostBuilderContext _, SentryAspNetCoreOptions options) =>
        {
            options.Dsn = dsn;
            options.Environment = builder.Configuration["Sentry:Environment"]
                                  ?? builder.Environment.EnvironmentName;
            options.Release = $"diyhelper2-api@{release}";

            options.SendDefaultPii = false;
            options.AttachStacktrace = true;
            options.MaxBreadcrumbs = 100;

            // Bodies frequently contain base64 photos and free-text user
            // descriptions — never ship them to Sentry.
            options.MaxRequestBodySize = RequestSize.None;

            options.TracesSampleRate = builder.Environment.IsProduction() ? 0.1 : 1.0;

            // Framework cancellations are noise — the user navigated away or
            // the upstream timeout already produced a structured error.
            options.AddExceptionFilterForType<OperationCanceledException>();
            options.AddExceptionFilterForType<TaskCanceledException>();

            options.SetBeforeSend((sentryEvent, _) => ScrubEvent(sentryEvent));
            options.SetBeforeBreadcrumb((breadcrumb, _) => ScrubBreadcrumb(breadcrumb));
        });

        return builder;
    }

    /// <summary>
    /// Stamps the per-request correlation ID (set by
    /// <c>CorrelationIdMiddleware</c>) onto the current Sentry scope so it
    /// shows up on every event captured for that request. Should run after
    /// <c>UseMiddleware&lt;CorrelationIdMiddleware&gt;()</c>.
    /// </summary>
    public static WebApplication UseSentryObservability(this WebApplication app)
    {
        app.Use(async (context, next) =>
        {
            if (context.Items["CorrelationId"] is string cid && !string.IsNullOrEmpty(cid))
            {
                SentrySdk.ConfigureScope(scope => scope.SetTag("correlation_id", cid));
            }
            await next();
        });
        return app;
    }

    private static SentryEvent ScrubEvent(SentryEvent evt)
    {
        try
        {
            if (evt.Request?.Headers is { } headers)
            {
                foreach (var key in headers.Keys.ToList())
                {
                    if (SensitiveHeaders.Contains(key))
                        headers[key] = Redacted;
                }
            }
            if (evt.Request != null && !string.IsNullOrEmpty(evt.Request.Cookies))
                evt.Request.Cookies = Redacted;

            if (evt.Message?.Message is { Length: > 0 } msg)
                evt.Message.Message = KeyLikeToken.Replace(msg, Redacted);
            if (evt.Message?.Formatted is { Length: > 0 } fmt)
                evt.Message.Formatted = KeyLikeToken.Replace(fmt, Redacted);
        }
        catch
        {
            // Telemetry must never crash the request.
        }
        return evt;
    }

    private static Breadcrumb? ScrubBreadcrumb(Breadcrumb breadcrumb)
    {
        if (breadcrumb.Data is { Count: > 0 } data)
        {
            foreach (var key in data.Keys)
            {
                if (key.Contains("authorization", StringComparison.OrdinalIgnoreCase)
                    || key.Contains("api-key", StringComparison.OrdinalIgnoreCase)
                    || key.Contains("apikey", StringComparison.OrdinalIgnoreCase)
                    || key.Contains("token", StringComparison.OrdinalIgnoreCase)
                    || key.Contains("password", StringComparison.OrdinalIgnoreCase)
                    || key.Contains("secret", StringComparison.OrdinalIgnoreCase)
                    || key.Contains("cookie", StringComparison.OrdinalIgnoreCase))
                {
                    // Breadcrumb.Data is read-only — drop the whole breadcrumb
                    // rather than risk shipping the secret.
                    return null;
                }
            }
        }

        if (!string.IsNullOrEmpty(breadcrumb.Message) && KeyLikeToken.IsMatch(breadcrumb.Message))
            return null;

        return breadcrumb;
    }
}
