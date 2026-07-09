using System.Security.Cryptography;
using DIYHelper2.Api.Integrations.Crm;
using Microsoft.Extensions.Logging.Abstractions;
using Xunit;

namespace DIYHelper2.Tests;

/// <summary>
/// AES-GCM token encryption used for stored OAuth tokens + the OAuth state param.
/// The key comes from CRM_TOKEN_ENC_KEY; when unset (as in a bare unit test) the
/// protector falls back to a random in-process key, which still round-trips.
/// </summary>
public class CrmTokenProtectorTests
{
    private static CrmTokenProtector NewProtector() =>
        new(NullLogger<CrmTokenProtector>.Instance);

    [Fact]
    public void ProtectThenUnprotect_RoundTrips()
    {
        var p = NewProtector();
        const string secret = "jobber-refresh-token-abc123|with|pipes";

        var packed = p.Protect(secret);

        Assert.NotEqual(secret, packed);               // actually encrypted
        Assert.Equal(secret, p.Unprotect(packed));     // and reversible
    }

    [Fact]
    public void Protect_ProducesDistinctCiphertexts_ForSameInput()
    {
        var p = NewProtector();
        // Random nonce per call → identical plaintext must not yield identical output.
        Assert.NotEqual(p.Protect("same"), p.Protect("same"));
    }

    [Fact]
    public void Unprotect_ThrowsOnTamperedCiphertext()
    {
        var p = NewProtector();
        var packed = p.Protect("sensitive");
        var bytes = Convert.FromBase64String(packed);
        bytes[^1] ^= 0xFF;                              // flip a bit in the ciphertext
        var tampered = Convert.ToBase64String(bytes);

        // AesGcm throws AuthenticationTagMismatchException, a CryptographicException subclass.
        Assert.ThrowsAny<CryptographicException>(() => p.Unprotect(tampered));
    }
}
