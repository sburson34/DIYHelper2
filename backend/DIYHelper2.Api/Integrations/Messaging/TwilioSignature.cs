using System.Security.Cryptography;
using System.Text;
using Microsoft.AspNetCore.Http.Extensions;

namespace DIYHelper2.Api.Integrations.Messaging;

/// <summary>
/// Verifies that a request on <c>/api/sms/*</c> really came from Twilio.
///
/// <para><b>Why.</b> Those handlers are necessarily unauthenticated by our own
/// scheme (Twilio cannot send <c>X-App-Key</c>), and they do two things an
/// attacker would want: write an inbound-message row attributed to a brand, and
/// send an outbound SMS to the phone number in the request body. The second is
/// straightforward toll fraud against the operator's Twilio account. The shared
/// <c>?token=</c> guard they used to rely on travels in the URL — logged by every
/// proxy in between — and was absent by default.</para>
///
/// <para><b>How.</b> Twilio signs each webhook: HMAC-SHA1, keyed with the account
/// auth token, over the full request URL followed by every POST parameter
/// concatenated in key order (<c>key1value1key2value2…</c>), base64-encoded into
/// <c>X-Twilio-Signature</c>. See
/// https://www.twilio.com/docs/usage/security#validating-requests.</para>
///
/// <para>The signed URL must match byte-for-byte what Twilio was configured with,
/// which behind a reverse proxy means honouring <c>X-Forwarded-Proto</c>. We
/// reconstruct it from the forwarded request and additionally accept a candidate
/// built from <c>TWILIO_WEBHOOK_BASE_URL</c>, so an operator whose proxy rewrites
/// the host can pin the exact public origin instead of debugging silent 401s.</para>
/// </summary>
public static class TwilioSignature
{
    public const string HeaderName = "X-Twilio-Signature";

    /// <summary>
    /// True when <paramref name="signature"/> is a valid Twilio signature for this
    /// request under <paramref name="authToken"/>. <paramref name="form"/> must be
    /// the already-read form collection (empty for a GET-style webhook).
    /// </summary>
    public static bool IsValid(HttpRequest request, IFormCollection form, string? signature, string authToken)
    {
        if (string.IsNullOrEmpty(signature) || string.IsNullOrEmpty(authToken)) return false;

        // POST params sorted by key, concatenated key-then-value with no separators.
        var sb = new StringBuilder();
        foreach (var key in form.Keys.OrderBy(k => k, StringComparer.Ordinal))
        {
            sb.Append(key);
            sb.Append(form[key].ToString());
        }
        var paramString = sb.ToString();

        foreach (var url in CandidateUrls(request))
        {
            if (Matches(url + paramString, signature, authToken)) return true;
        }
        return false;
    }

    private static IEnumerable<string> CandidateUrls(HttpRequest request)
    {
        // What the (forwarded) request says it is — correct whenever the proxy
        // preserves Host and sets X-Forwarded-Proto, which Caddy does.
        yield return request.GetEncodedUrl();

        // Operator-pinned public origin, for topologies that rewrite the host.
        var configuredBase = Environment.GetEnvironmentVariable("TWILIO_WEBHOOK_BASE_URL");
        if (!string.IsNullOrWhiteSpace(configuredBase))
            yield return configuredBase.TrimEnd('/') + request.Path + request.QueryString;
    }

    private static bool Matches(string signedMaterial, string signature, string authToken)
    {
        using var hmac = new HMACSHA1(Encoding.UTF8.GetBytes(authToken));
        var expected = Convert.ToBase64String(hmac.ComputeHash(Encoding.UTF8.GetBytes(signedMaterial)));
        return CryptographicOperations.FixedTimeEquals(
            Encoding.UTF8.GetBytes(expected), Encoding.UTF8.GetBytes(signature));
    }
}
