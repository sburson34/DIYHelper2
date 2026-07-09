using System.Security.Cryptography;
using System.Text;

namespace DIYHelper2.Api.Integrations.Crm;

/// <summary>
/// Symmetric encryption for stored OAuth tokens (and the OAuth <c>state</c>
/// parameter). AES-256-GCM with a key from the <c>CRM_TOKEN_ENC_KEY</c> env var
/// (base64, 32 bytes).
///
/// <para>
/// Chosen over ASP.NET Data Protection because the key must survive container
/// redeploys and be identical across instances on the shared host — an env
/// secret is portable and matches the portfolio's "secrets via env vars only"
/// rule. Output format is base64(nonce[12] | tag[16] | ciphertext); GCM's tag
/// makes tampering a decrypt failure rather than silent corruption.
/// </para>
///
/// <para>
/// If <c>CRM_TOKEN_ENC_KEY</c> is unset a random per-process key is generated and
/// a warning logged: tokens still round-trip in-process (so dev + tests work) but
/// won't survive a restart. Production MUST set the env var.
/// </para>
/// </summary>
public class CrmTokenProtector
{
    private const int NonceSize = 12;   // AES-GCM standard nonce
    private const int TagSize = 16;     // 128-bit auth tag
    private const int KeySize = 32;     // AES-256

    private readonly byte[] _key;

    public CrmTokenProtector(ILogger<CrmTokenProtector> logger)
    {
        var raw = Environment.GetEnvironmentVariable("CRM_TOKEN_ENC_KEY");
        if (!string.IsNullOrWhiteSpace(raw))
        {
            try { _key = Convert.FromBase64String(raw); }
            catch (FormatException) { throw new InvalidOperationException("CRM_TOKEN_ENC_KEY must be base64-encoded."); }
            if (_key.Length != KeySize)
                throw new InvalidOperationException($"CRM_TOKEN_ENC_KEY must decode to {KeySize} bytes (got {_key.Length}).");
        }
        else
        {
            _key = RandomNumberGenerator.GetBytes(KeySize);
            logger.LogWarning(
                "CRM_TOKEN_ENC_KEY not set — using an ephemeral in-process key. Stored CRM tokens will not survive a restart; set CRM_TOKEN_ENC_KEY in production.");
        }
    }

    public string Protect(string plaintext)
    {
        var plain = Encoding.UTF8.GetBytes(plaintext);
        var nonce = RandomNumberGenerator.GetBytes(NonceSize);
        var cipher = new byte[plain.Length];
        var tag = new byte[TagSize];

        using var aes = new AesGcm(_key, TagSize);
        aes.Encrypt(nonce, plain, cipher, tag);

        var packed = new byte[NonceSize + TagSize + cipher.Length];
        Buffer.BlockCopy(nonce, 0, packed, 0, NonceSize);
        Buffer.BlockCopy(tag, 0, packed, NonceSize, TagSize);
        Buffer.BlockCopy(cipher, 0, packed, NonceSize + TagSize, cipher.Length);
        return Convert.ToBase64String(packed);
    }

    /// <summary>Reverses <see cref="Protect"/>. Throws
    /// <see cref="CryptographicException"/> if the data was tampered with, and
    /// <see cref="FormatException"/> if it isn't valid base64.</summary>
    public string Unprotect(string packedBase64)
    {
        var packed = Convert.FromBase64String(packedBase64);
        if (packed.Length < NonceSize + TagSize)
            throw new CryptographicException("Ciphertext is too short.");

        var nonce = packed.AsSpan(0, NonceSize);
        var tag = packed.AsSpan(NonceSize, TagSize);
        var cipher = packed.AsSpan(NonceSize + TagSize);
        var plain = new byte[cipher.Length];

        using var aes = new AesGcm(_key, TagSize);
        aes.Decrypt(nonce, cipher, tag, plain);
        return Encoding.UTF8.GetString(plain);
    }
}
