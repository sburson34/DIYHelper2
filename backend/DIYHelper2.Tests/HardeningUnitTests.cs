using System.Security.Cryptography;
using System.Text;
using DIYHelper2.Api.Integrations.Messaging;
using DIYHelper2.Api.Security;
using DIYHelper2.Api.Services;
using DIYHelper2.Api.Validation;
using DIYHelper2.Tests.Infrastructure;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging.Abstractions;

namespace DIYHelper2.Tests;

/// <summary>
/// Unit-level pins for the hardening primitives, kept separate from the
/// integration suite so each rule can be asserted directly rather than inferred
/// from an HTTP status.
/// </summary>
public class ClientIpTests
{
    [Fact]
    public void RemoteIpAddress_WinsOver_ClientSuppliedForwardedHeader()
    {
        // The whole point: a caller cannot pick its own rate-limit bucket. Caddy
        // appends the real peer, so the first X-Forwarded-For entry is attacker
        // input — the trusted value is the connection address that
        // ForwardedHeadersMiddleware already resolved.
        var ctx = new DefaultHttpContext();
        ctx.Connection.RemoteIpAddress = System.Net.IPAddress.Parse("198.51.100.9");
        ctx.Request.Headers["X-Forwarded-For"] = "1.2.3.4, 198.51.100.9";

        Assert.Equal("198.51.100.9", ClientIp.Of(ctx));
    }

    [Fact]
    public void FallsBackToForwardedHeader_WhenNoConnectionAddress()
    {
        // In-memory TestServer has no socket peer; tests pick a bucket by header.
        var ctx = new DefaultHttpContext();
        ctx.Request.Headers["X-Forwarded-For"] = "203.0.113.7";

        Assert.Equal("203.0.113.7", ClientIp.Of(ctx));
    }

    [Fact]
    public void ReturnsUnknown_WhenNeitherIsAvailable()
    {
        Assert.Equal(ClientIp.Unknown, ClientIp.Of(new DefaultHttpContext()));
    }
}

public class ImageSnifferTests
{
    [Theory]
    [InlineData("image/jpeg")]
    [InlineData("image/png")]
    public void DetectsSupportedContainers(string expected)
    {
        var bytes = expected == "image/jpeg" ? TestImages.Jpeg() : TestImages.Png();
        Assert.Equal(expected, ImageSniffer.Detect(bytes));
    }

    [Fact]
    public void DetectsWebp()
    {
        var bytes = Encoding.ASCII.GetBytes("RIFF").Concat(new byte[] { 0, 0, 0, 0 })
            .Concat(Encoding.ASCII.GetBytes("WEBP")).ToArray();
        Assert.Equal("image/webp", ImageSniffer.Detect(bytes));
    }

    [Fact]
    public void DetectsHeic()
    {
        var bytes = new byte[] { 0, 0, 0, 0x18 }
            .Concat(Encoding.ASCII.GetBytes("ftyp"))
            .Concat(Encoding.ASCII.GetBytes("heic"))
            .ToArray();
        Assert.Equal("image/heic", ImageSniffer.Detect(bytes));
    }

    [Fact]
    public void ReturnsNull_ForNonImageBytes()
    {
        // The case that used to be billed as vision tokens: arbitrary data behind
        // an "image/jpeg" label.
        Assert.Null(ImageSniffer.Detect(Encoding.UTF8.GetBytes("<html>not an image at all</html>")));
    }

    [Fact]
    public void ReturnsNull_ForTruncatedInput()
    {
        Assert.Null(ImageSniffer.Detect(new byte[] { 0xFF, 0xD8, 0xFF }));
    }

    [Theory]
    [InlineData("image/jpeg", "image/jpg")]      // phones use both spellings
    [InlineData("image/heic", "image/heif")]
    [InlineData("image/png", null)]              // no declared type → accept
    public void Matches_TreatsEquivalentLabelsAsCompatible(string detected, string? declared)
    {
        Assert.True(ImageSniffer.Matches(detected, declared));
    }

    [Fact]
    public void Matches_RejectsMismatchedLabel()
    {
        Assert.False(ImageSniffer.Matches("image/png", "image/jpeg"));
    }
}

public class TwilioSignatureTests
{
    private const string AuthToken = "test-auth-token";

    private static (HttpRequest request, IFormCollection form) BuildRequest()
    {
        var ctx = new DefaultHttpContext();
        ctx.Request.Scheme = "https";
        ctx.Request.Host = new HostString("api.example.com");
        ctx.Request.Path = "/api/sms/incoming";
        ctx.Request.Method = "POST";
        var form = new FormCollection(new Dictionary<string, Microsoft.Extensions.Primitives.StringValues>
        {
            ["From"] = "+15551110000",
            ["To"] = "+15552220000",
            ["Body"] = "hello there",
        });
        ctx.Request.Form = form;
        return (ctx.Request, form);
    }

    /// <summary>Reference implementation of Twilio's scheme: HMAC-SHA1 over the
    /// full URL plus each POST param in key order.</summary>
    private static string Sign(string url, IFormCollection form, string token)
    {
        var sb = new StringBuilder(url);
        foreach (var key in form.Keys.OrderBy(k => k, StringComparer.Ordinal))
        {
            sb.Append(key);
            sb.Append(form[key].ToString());
        }
        using var hmac = new HMACSHA1(Encoding.UTF8.GetBytes(token));
        return Convert.ToBase64String(hmac.ComputeHash(Encoding.UTF8.GetBytes(sb.ToString())));
    }

    [Fact]
    public void AcceptsAGenuineSignature()
    {
        var (request, form) = BuildRequest();
        var signature = Sign("https://api.example.com/api/sms/incoming", form, AuthToken);

        Assert.True(TwilioSignature.IsValid(request, form, signature, AuthToken));
    }

    [Fact]
    public void RejectsATamperedBody()
    {
        var (request, form) = BuildRequest();
        var signature = Sign("https://api.example.com/api/sms/incoming", form, AuthToken);

        // Same signature, different POST params — this is the forged-inbound-SMS case.
        var tampered = new FormCollection(new Dictionary<string, Microsoft.Extensions.Primitives.StringValues>
        {
            ["From"] = "+15559999999",
            ["To"] = "+15552220000",
            ["Body"] = "hello there",
        });
        request.Form = tampered;

        Assert.False(TwilioSignature.IsValid(request, tampered, signature, AuthToken));
    }

    [Fact]
    public void RejectsAWrongKey()
    {
        var (request, form) = BuildRequest();
        var signature = Sign("https://api.example.com/api/sms/incoming", form, "some-other-token");

        Assert.False(TwilioSignature.IsValid(request, form, signature, AuthToken));
    }

    [Fact]
    public void RejectsMissingSignature()
    {
        var (request, form) = BuildRequest();
        Assert.False(TwilioSignature.IsValid(request, form, null, AuthToken));
        Assert.False(TwilioSignature.IsValid(request, form, "", AuthToken));
    }
}

public class TechTokenRevocationTests
{
    private static TechTokenService NewService()
    {
        Environment.SetEnvironmentVariable("TECH_TOKEN_KEY", "unit-test-key");
        return new TechTokenService(NullLogger<TechTokenService>.Instance);
    }

    [Fact]
    public void TokenCarriesTheCredentialGeneration()
    {
        var svc = NewService();
        var token = svc.Issue(7, "brand-a", "$2a$11$examplehashvalue");

        var who = svc.Validate(token);
        Assert.NotNull(who);
        Assert.Equal(7, who!.TechId);
        Assert.Equal("brand-a", who.Brand);
        Assert.Equal(TechTokenService.VersionOf("$2a$11$examplehashvalue"), who.Version);
    }

    [Fact]
    public void VersionChanges_WhenTheLoginCodeIsRotated()
    {
        // This is what makes revocation work: the endpoint compares the token's
        // version against the live row, so re-issuing a code orphans old tokens.
        Assert.NotEqual(
            TechTokenService.VersionOf("$2a$11$firsthash"),
            TechTokenService.VersionOf("$2a$11$secondhash"));
    }

    [Fact]
    public void VersionDoesNotLeakTheHash()
    {
        const string hash = "$2a$11$examplehashvalue";
        var version = TechTokenService.VersionOf(hash);
        Assert.DoesNotContain(version, hash);
        Assert.Equal(16, version.Length);   // 8 bytes of SHA-256, hex
    }
}

public class SecurityPreflightTests
{
    private sealed class FakeEnvironment : IHostEnvironment
    {
        public string EnvironmentName { get; set; } = "Production";
        public string ApplicationName { get; set; } = "DIYHelper2.Api";
        public string ContentRootPath { get; set; } = ".";
        public Microsoft.Extensions.FileProviders.IFileProvider ContentRootFileProvider { get; set; } =
            new Microsoft.Extensions.FileProviders.NullFileProvider();
    }

    /// <summary>Env vars are process-wide; snapshot and restore around each case.</summary>
    private static void WithEnv(Action body, params (string name, string? value)[] values)
    {
        var previous = values.Select(v => (v.name, old: Environment.GetEnvironmentVariable(v.name))).ToList();
        foreach (var (name, value) in values) Environment.SetEnvironmentVariable(name, value);
        try { body(); }
        finally { foreach (var (name, old) in previous) Environment.SetEnvironmentVariable(name, old); }
    }

    [Fact]
    public void Throws_InStrictMode_WhenStripeIsLiveButWebhooksCannotBeVerified()
    {
        WithEnv(() =>
        {
            var ex = Assert.Throws<InvalidOperationException>(() =>
                SecurityPreflight.Run(new FakeEnvironment(), NullLogger.Instance, _ => "set"));
            Assert.Contains("STRIPE_WEBHOOK_SECRET", ex.Message);
        },
        ("SECURITY_PREFLIGHT_STRICT", "true"),
        ("STRIPE_SECRET_KEY", "sk_live_example"),
        ("STRIPE_WEBHOOK_SECRET", null));
    }

    [Fact]
    public void DoesNotThrow_ByDefault_ForACriticalFinding()
    {
        // Default is a loud LogCritical, not an outage: nothing here risks data
        // loss, and the payment case self-heals once the secret is set.
        WithEnv(() =>
            SecurityPreflight.Run(new FakeEnvironment(), NullLogger.Instance, _ => "set"),
        ("SECURITY_PREFLIGHT_STRICT", null),
        ("STRIPE_SECRET_KEY", "sk_live_example"),
        ("STRIPE_WEBHOOK_SECRET", null));
    }

    [Fact]
    public void Passes_WhenStripeIsLiveAndSigned()
    {
        WithEnv(() =>
            SecurityPreflight.Run(new FakeEnvironment(), NullLogger.Instance, _ => "set"),
        ("SECURITY_PREFLIGHT_STRICT", "true"),
        ("STRIPE_SECRET_KEY", "sk_live_example"),
        ("STRIPE_WEBHOOK_SECRET", "whsec_example"));
    }

    [Fact]
    public void MissingOptionalSecrets_AreWarningsNotFailures()
    {
        // APP_KEY / TECH_TOKEN_KEY / admin creds absent: degraded but fail-closed,
        // so the app must still boot even under strict mode.
        WithEnv(() =>
            SecurityPreflight.Run(new FakeEnvironment(), NullLogger.Instance, _ => null),
        ("SECURITY_PREFLIGHT_STRICT", "true"),
        ("STRIPE_SECRET_KEY", null),
        ("TWILIO_ACCOUNT_SID", null));
    }

    [Fact]
    public void IsANoOp_InDevelopment()
    {
        WithEnv(() =>
            SecurityPreflight.Run(
                new FakeEnvironment { EnvironmentName = "Development" }, NullLogger.Instance, _ => null),
        ("SECURITY_PREFLIGHT_STRICT", "true"),
        ("STRIPE_SECRET_KEY", "sk_test_example"),
        ("STRIPE_WEBHOOK_SECRET", null));
    }
}

/// <summary>
/// The aggregate daily AI-spend ceiling. The counter lives in memory for speed
/// and is mirrored to the database by <c>AiSpendPersistenceService</c>; these pin
/// the seed/snapshot contract that mirror depends on.
/// </summary>
public class AiSpendGuardTests
{
    private static AiSpendGuard GuardWithCap(int cap)
    {
        var previous = Environment.GetEnvironmentVariable("AI_GLOBAL_DAILY_CAP");
        Environment.SetEnvironmentVariable("AI_GLOBAL_DAILY_CAP", cap.ToString());
        try { return new AiSpendGuard(); }
        finally { Environment.SetEnvironmentVariable("AI_GLOBAL_DAILY_CAP", previous); }
    }

    [Fact]
    public void Consumes_UpToTheCap_ThenRefuses()
    {
        var guard = GuardWithCap(3);
        Assert.True(guard.TryConsume(out var afterFirst));
        Assert.Equal(2, afterFirst);
        Assert.True(guard.TryConsume(out _));
        Assert.True(guard.TryConsume(out var afterLast));
        Assert.Equal(0, afterLast);

        Assert.False(guard.TryConsume(out var exhausted));
        Assert.Equal(0, exhausted);
    }

    [Fact]
    public void Seed_ResumesADaysTally_SoARedeployDoesNotHandBackBudget()
    {
        // The whole point of persisting: a restart mid-day must not reset the
        // ceiling, which previously turned "N per day" into "N per deploy".
        var guard = GuardWithCap(10);
        var (today, _) = guard.Snapshot();

        guard.Seed(today, 9);
        Assert.True(guard.TryConsume(out var remaining));
        Assert.Equal(0, remaining);
        Assert.False(guard.TryConsume(out _));
    }

    [Fact]
    public void Seed_NeverGivesBackAlreadySpentBudget()
    {
        // A late or duplicated seed (slow DB read racing live traffic) must not
        // lower the count that calls already consumed.
        var guard = GuardWithCap(10);
        var (today, _) = guard.Snapshot();

        for (var i = 0; i < 6; i++) Assert.True(guard.TryConsume(out _));
        guard.Seed(today, 2);                      // stale, lower value

        Assert.Equal(6, guard.Snapshot().Count);
    }

    [Fact]
    public void Seed_ForAnotherDay_IsIgnored()
    {
        // Crossing UTC midnight between the read and the seed must not import
        // yesterday's tally into today's fresh budget.
        var guard = GuardWithCap(10);
        var (today, _) = guard.Snapshot();

        guard.Seed(today.AddDays(-1), 9);
        Assert.Equal(0, guard.Snapshot().Count);
    }

    [Fact]
    public void DayKey_IsAStableIsoDate()
    {
        Assert.Equal("2026-07-30", AiSpendGuard.DayKey(new DateOnly(2026, 7, 30)));
    }
}
