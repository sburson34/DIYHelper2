using Microsoft.AspNetCore.Builder;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;
using Sburson.Shared.Observability;
using Sentry;
using Sentry.AspNetCore;
using Sentry.Extensibility;

namespace DIYHelper2.Tests;

[Collection("Sentry")]
public class SentrySetupTests : IDisposable
{
    private readonly string? _origDsnEnv;
    private readonly string? _origSentryDsnEnv;

    public SentrySetupTests()
    {
        _origDsnEnv = Environment.GetEnvironmentVariable("Sentry__Dsn");
        _origSentryDsnEnv = Environment.GetEnvironmentVariable("SENTRY_DSN");
        Environment.SetEnvironmentVariable("Sentry__Dsn", null);
        Environment.SetEnvironmentVariable("SENTRY_DSN", null);
    }

    public void Dispose()
    {
        Environment.SetEnvironmentVariable("Sentry__Dsn", _origDsnEnv);
        Environment.SetEnvironmentVariable("SENTRY_DSN", _origSentryDsnEnv);
        if (SentrySdk.IsEnabled)
            SentrySdk.Close();
    }

    [Fact]
    public void Register_IsNoOp_WhenDsnIsEmpty()
    {
        var builder = WebApplication.CreateBuilder();
        builder.Configuration.AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["Sentry:Dsn"] = ""
        });

        builder.AddSburonSentry(o => o.AppSlug = "diyhelper2-api");
        using var app = builder.Build();

        Assert.False(SentrySdk.IsEnabled);
    }

    [Fact]
    public void Register_AppliesExpectedOptions_WhenDsnProvided()
    {
        var builder = WebApplication.CreateBuilder();
        builder.Configuration.AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["Sentry:Dsn"] = "https://abc@o0.ingest.sentry.io/0"
        });

        builder.AddSburonSentry(o => o.AppSlug = "diyhelper2-api");
        using var app = builder.Build();

        var options = app.Services.GetRequiredService<IOptions<SentryAspNetCoreOptions>>().Value;

        Assert.False(options.SendDefaultPii);
        Assert.True(options.AttachStacktrace);
        Assert.Equal(RequestSize.None, options.MaxRequestBodySize);
        Assert.Equal(100, options.MaxBreadcrumbs);
    }
}

[CollectionDefinition("Sentry", DisableParallelization = true)]
public class SentryTestCollection { }
