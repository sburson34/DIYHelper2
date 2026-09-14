namespace DIYHelper2.Api.Security;

/// <summary>
/// Single source of truth for "who is calling", used as the partition key by
/// every per-IP control: the rate limiter, the admin brute-force lockout, and
/// the data-deletion throttle.
///
/// <para><b>Why this exists.</b> Those controls used to read the raw
/// <c>X-Forwarded-For</c> header and take its <em>first</em> entry. That value is
/// entirely client-supplied: Caddy appends the real peer address to whatever the
/// client sent, so a request carrying <c>X-Forwarded-For: 1.2.3.4</c> arrives as
/// <c>"1.2.3.4, &lt;real ip&gt;"</c> and the first entry is the attacker's own
/// invention. Rotating it per request gave a fresh rate-limit bucket every time
/// and made the admin lockout unreachable.</para>
///
/// <para><b>What we do instead.</b> <c>UseForwardedHeaders</c> (registered in
/// Program.cs with <c>ForwardLimit = 1</c>, i.e. exactly one trusted reverse
/// proxy) already resolves the real peer into
/// <see cref="ConnectionInfo.RemoteIpAddress"/> by walking the header from the
/// <em>right</em>. We read that, and only fall back to the header when there is
/// no connection address at all — which in practice means the in-memory
/// <c>TestServer</c>, where tests set <c>X-Forwarded-For</c> deliberately to pick
/// a bucket. Production always has a socket peer, so the header can never
/// override it.</para>
/// </summary>
public static class ClientIp
{
    /// <summary>Sentinel for "no resolvable caller" — callers should skip
    /// per-IP accounting rather than lump every such request into one bucket.</summary>
    public const string Unknown = "unknown";

    public static string Of(HttpContext context)
    {
        // Real socket peer, already un-proxied by ForwardedHeadersMiddleware.
        var remote = context.Connection.RemoteIpAddress;
        if (remote is not null) return remote.ToString();

        // No connection info (in-memory test host only) → honour the header so
        // tests can still exercise per-IP behaviour deterministically.
        var forwarded = context.Request.Headers["X-Forwarded-For"].FirstOrDefault()
            ?.Split(',').FirstOrDefault()?.Trim();
        return string.IsNullOrEmpty(forwarded) ? Unknown : forwarded;
    }
}
