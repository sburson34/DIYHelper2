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

    /// <summary>
    /// Guard a single base64-encoded image field (booking photo, tech
    /// before/after/signature): size cap first — before any decode — so an
    /// abusive payload can't force a huge allocation, then a real base64
    /// decode check so junk never lands in the database. Null/empty is fine
    /// (the field is optional everywhere it's used). Returns null on success
    /// or a 400 IResult to short-circuit the handler.
    /// </summary>
    public static IResult? ValidateBase64Image(string? b64, HttpContext ctx, string fieldName)
    {
        if (string.IsNullOrEmpty(b64)) return null;

        if (b64.Length > MaxBase64LengthPerItem)
            return ApiError.BadRequest(ctx, $"{fieldName} exceeds the maximum size of 10 MB.");

        try { _ = Convert.FromBase64String(b64); }
        catch { return ApiError.BadRequest(ctx, $"{fieldName} is not valid base64."); }

        return null;
    }

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

            if (item.Base64.Length > MaxBase64LengthPerItem)
                return ApiError.BadRequest(context, "An image exceeds the maximum size of 10 MB.");

            if (!string.IsNullOrEmpty(item.MimeType) && !AllowedMimeTypes.Contains(item.MimeType))
                return ApiError.BadRequest(context, $"Unsupported image type: {item.MimeType}. Use JPEG, PNG, WebP, or HEIC.");
        }

        return null;
    }
}
