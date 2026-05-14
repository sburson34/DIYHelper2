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
    public const int MaxMediaItems = 8;
    public const int MaxBase64LengthPerItem = 10 * 1024 * 1024;
    public const int MaxDescriptionLength = 8_000;

    private static readonly HashSet<string> AllowedMimeTypes = new(StringComparer.OrdinalIgnoreCase)
    {
        "image/jpeg", "image/jpg", "image/png", "image/webp", "image/heic", "image/heif",
    };

    public static IResult? Validate(string? description, MediaItem[]? media, HttpContext context)
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
            // Video items are skipped downstream; no need to validate their payload.
            if (string.Equals(item.Type, "video", StringComparison.OrdinalIgnoreCase))
                continue;

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
