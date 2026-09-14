namespace DIYHelper2.Api.Validation;

/// <summary>
/// Validates inbound image/media requests *before* base64 decoding so an
/// abusive client cannot force us to allocate tens of MB or shovel junk into
/// OpenAI/Anthropic and burn quota. Returns null on success, or an IResult to
/// short-circuit the handler with a 400.
/// </summary>
public static class MediaValidation
{
    // Per-image limits. A 10 MB base64 string decodes to ~7.5 MB of raw image,
    // which is already larger than anything a phone camera produces after the
    // mobile-side compression step.
    // Images are the dominant AI cost driver (each one is billed as a chunk of
    // vision tokens). 3 covers virtually every real DIY project (a wide shot +
    // two close-ups) while capping worst-case spend per call. Was 8.
    public const int MaxMediaItems = 3;
    public const int MaxBase64LengthPerItem = 10 * 1024 * 1024;
    public const int MaxDescriptionLength = 8_000;

    private static readonly HashSet<string> AllowedMimeTypes = new(StringComparer.OrdinalIgnoreCase)
    {
        "image/jpeg", "image/jpg", "image/png", "image/webp", "image/heic", "image/heif",
    };

    public static IResult? Validate(string? description, MediaItem[]? media, HttpContext context, bool allowVideo = false)
    {
        if (!string.IsNullOrEmpty(description) && description.Length > MaxDescriptionLength)
            return ApiError.BadRequest(context, $"Description exceeds maximum length of {MaxDescriptionLength} characters.");

        if (media == null || media.Length == 0)
            return null;

        if (media.Length > MaxMediaItems)
            return ApiError.BadRequest(context, $"Too many media items. Maximum is {MaxMediaItems}.");

        foreach (var item in media)
        {
            if (item == null) continue;
            if (string.Equals(item.Type, "video", StringComparison.OrdinalIgnoreCase))
            {
                // Video is gated (FeatureFlags.VideoAnalysis). Vision models can't
                // read video, and video payloads bypass the per-item size cap —
                // reject at the edge rather than accept-and-ignore a large upload.
                if (!allowVideo)
                    return ApiError.Response(context, 400,
                        "Video is not currently supported. Please attach a photo instead.",
                        "video_not_supported");
                // When enabled, skip payload validation (no frame pipeline yet).
                continue;
            }

            if (string.IsNullOrEmpty(item.Base64))
                continue;

            var imageError = ValidateImage(item.Base64, item.MimeType, context);
            if (imageError != null) return imageError;
        }

        return null;
    }

    /// <summary>
    /// Validates one base64 image: size, declared MIME type, that it actually
    /// decodes, and that its bytes are a supported image container.
    ///
    /// <para>The last two checks matter because everything downstream is billed
    /// per call: without them a caller could ship 10 MB of arbitrary
    /// (or unparseable) data with <c>mimeType: "image/jpeg"</c> and we would pay a
    /// vision provider to reject it. Shared by /api/analyze, /api/verify-step,
    /// /api/diagnose and /api/live-diy/analyze so every entry point applies the
    /// same rules.</para>
    /// </summary>
    public static IResult? ValidateImage(string? base64, string? mimeType, HttpContext context)
    {
        if (string.IsNullOrEmpty(base64)) return null;

        if (base64.Length > MaxBase64LengthPerItem)
            return ApiError.BadRequest(context, "An image exceeds the maximum size of 10 MB.");

        if (!string.IsNullOrEmpty(mimeType) && !AllowedMimeTypes.Contains(mimeType))
            return ApiError.BadRequest(context, $"Unsupported image type: {mimeType}. Use JPEG, PNG, WebP, or HEIC.");

        byte[] decoded;
        try
        {
            decoded = Convert.FromBase64String(base64);
        }
        catch (FormatException)
        {
            return ApiError.BadRequest(context, "An image is not valid base64 data.");
        }

        var detected = ImageSniffer.Detect(decoded);
        if (detected is null)
            return ApiError.BadRequest(context,
                "An attachment is not a readable image. Use a JPEG, PNG, WebP, or HEIC photo.");

        if (!ImageSniffer.Matches(detected, mimeType))
            return ApiError.BadRequest(context,
                $"An image's contents ({detected}) don't match its declared type ({mimeType}).");

        return null;
    }
}
