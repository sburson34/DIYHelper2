namespace DIYHelper2.Tests.Infrastructure;

/// <summary>
/// Minimal but genuine image payloads for tests.
///
/// <para>The API sniffs the leading bytes of every uploaded image
/// (<c>Validation/ImageSniffer</c>) instead of trusting the declared MIME type, so
/// a four-byte stub no longer passes validation. These are the smallest byte
/// sequences that a real decoder would recognise as the given container — enough
/// to get through the edge, still tiny enough to inline.</para>
/// </summary>
public static class TestImages
{
    /// <summary>JPEG SOI + JFIF APP0 header.</summary>
    public static byte[] Jpeg() => new byte[]
    {
        0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46,
        0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01,
    };

    /// <summary>PNG signature + start of the IHDR chunk (4x4, truecolor).</summary>
    public static byte[] Png() => new byte[]
    {
        0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A,
        0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52,
        0x00, 0x00, 0x00, 0x04, 0x00, 0x00, 0x00, 0x04,
        0x08, 0x02, 0x00, 0x00, 0x00, 0x26, 0x93, 0x09,
        0x29,
    };

    /// <summary>Base64 of <see cref="Jpeg"/> — the common form in request bodies.</summary>
    public static string JpegBase64() => Convert.ToBase64String(Jpeg());
}
