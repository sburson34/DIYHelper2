namespace DIYHelper2.Api.Validation;

/// <summary>
/// Identifies an image by its leading bytes rather than by the MIME type the
/// client claims.
///
/// <para><b>Why.</b> Every image on the AI paths arrives as a base64 blob with a
/// caller-supplied <c>mimeType</c>. Validating the label only proves the caller
/// can spell "image/jpeg"; the bytes behind it were never inspected, so any 10 MB
/// of arbitrary data — random bytes, a zip, an HTML page — got base64-decoded and
/// billed to us as vision tokens before the provider rejected it. Sniffing the
/// real container costs a handful of byte comparisons and moves that rejection to
/// our edge.</para>
///
/// <para>Signatures cover exactly the formats <see cref="MediaValidation"/> allows;
/// anything unrecognised is rejected rather than assumed good.</para>
/// </summary>
public static class ImageSniffer
{
    /// <summary>Bytes needed to identify the longest signature we check (HEIC's
    /// ftyp box sits at offset 4..12).</summary>
    public const int MinimumBytes = 12;

    /// <summary>
    /// The canonical MIME type for <paramref name="data"/>, or null when the bytes
    /// are not one of the supported image containers.
    /// </summary>
    public static string? Detect(ReadOnlySpan<byte> data)
    {
        if (data.Length < MinimumBytes) return null;

        // JPEG: FF D8 FF
        if (data[0] == 0xFF && data[1] == 0xD8 && data[2] == 0xFF) return "image/jpeg";

        // PNG: 89 50 4E 47 0D 0A 1A 0A
        if (data[0] == 0x89 && data[1] == 0x50 && data[2] == 0x4E && data[3] == 0x47
            && data[4] == 0x0D && data[5] == 0x0A && data[6] == 0x1A && data[7] == 0x0A) return "image/png";

        // WebP: "RIFF" .... "WEBP"
        if (Ascii(data, 0, "RIFF") && Ascii(data, 8, "WEBP")) return "image/webp";

        // HEIC/HEIF: ISO-BMFF "ftyp" box at offset 4, brand at offset 8.
        if (Ascii(data, 4, "ftyp"))
        {
            var brand = System.Text.Encoding.ASCII.GetString(data.Slice(8, 4));
            // heic/heix/hevc/hevx = HEIC; mif1/msf1 = generic HEIF.
            if (brand is "heic" or "heix" or "hevc" or "hevx") return "image/heic";
            if (brand is "mif1" or "msf1") return "image/heif";
        }

        return null;
    }

    /// <summary>True when the detected container is compatible with the MIME type
    /// the client declared. HEIC/HEIF and the jpeg/jpg spellings are treated as
    /// interchangeable, since phones label them inconsistently.</summary>
    public static bool Matches(string detected, string? declared)
    {
        if (string.IsNullOrEmpty(declared)) return true;
        if (string.Equals(detected, declared, StringComparison.OrdinalIgnoreCase)) return true;

        static string Family(string mime) => mime.ToLowerInvariant() switch
        {
            "image/jpeg" or "image/jpg" => "jpeg",
            "image/heic" or "image/heif" => "heic",
            var other => other,
        };
        return Family(detected) == Family(declared);
    }

    private static bool Ascii(ReadOnlySpan<byte> data, int offset, string expected)
    {
        if (data.Length < offset + expected.Length) return false;
        for (var i = 0; i < expected.Length; i++)
            if (data[offset + i] != (byte)expected[i]) return false;
        return true;
    }
}
