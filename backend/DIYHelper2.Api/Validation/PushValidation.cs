namespace DIYHelper2.Api.Validation;

/// <summary>
/// Validates push-notification inputs before they persist or reach Expo.
/// Returns null on success, or an IResult to short-circuit the handler with a
/// 400 (same convention as <see cref="MediaValidation"/>).
/// </summary>
public static class PushValidation
{
    // Notification text limits. Titles/bodies far shorter than these still get
    // truncated by the OS on the lock screen, but we cap generously so a
    // composer can't shove an essay (or an abusive payload) through.
    public const int MaxTitleLength = 100;
    public const int MaxBodyLength = 500;
    public const int MaxSubtitleLength = 100;
    public const int MaxDataJsonLength = 4_000;
    public const int MaxTokenLength = 256;

    private static readonly string[] AllowedPlatforms = { "ios", "android" };

    /// <summary>True for a well-formed Expo push token
    /// (<c>ExponentPushToken[...]</c> or <c>ExpoPushToken[...]</c>).</summary>
    public static bool IsExpoToken(string? token) =>
        !string.IsNullOrWhiteSpace(token)
        && token.Length <= MaxTokenLength
        && (token.StartsWith("ExponentPushToken[", StringComparison.Ordinal)
            || token.StartsWith("ExpoPushToken[", StringComparison.Ordinal))
        && token.EndsWith("]", StringComparison.Ordinal);

    /// <summary>Normalizes a platform hint to "ios"/"android", or "" if unknown.</summary>
    public static string NormalizePlatform(string? platform)
    {
        var p = (platform ?? "").Trim().ToLowerInvariant();
        return AllowedPlatforms.Contains(p) ? p : "";
    }

    /// <summary>Validates a device token-registration payload.</summary>
    public static IResult? ValidateRegister(string? token, HttpContext context)
    {
        if (!IsExpoToken(token))
            return ApiError.BadRequest(context, "A valid Expo push token is required.");
        return null;
    }

    /// <summary>Validates a compose/send payload from the owner portal.</summary>
    public static IResult? ValidateSend(
        string? title, string? body, string? subtitle, string? imageUrl,
        string? dataJson, string? platform, HttpContext context)
    {
        if (string.IsNullOrWhiteSpace(title))
            return ApiError.BadRequest(context, "Title is required.");
        if (title.Length > MaxTitleLength)
            return ApiError.BadRequest(context, $"Title exceeds {MaxTitleLength} characters.");

        if (string.IsNullOrWhiteSpace(body))
            return ApiError.BadRequest(context, "Message body is required.");
        if (body.Length > MaxBodyLength)
            return ApiError.BadRequest(context, $"Message body exceeds {MaxBodyLength} characters.");

        if (!string.IsNullOrEmpty(subtitle) && subtitle.Length > MaxSubtitleLength)
            return ApiError.BadRequest(context, $"Subtitle exceeds {MaxSubtitleLength} characters.");

        if (!string.IsNullOrWhiteSpace(imageUrl) && !IsHttpsUrl(imageUrl))
            return ApiError.BadRequest(context, "Image URL must be an https:// link.");

        if (!string.IsNullOrEmpty(dataJson))
        {
            if (dataJson.Length > MaxDataJsonLength)
                return ApiError.BadRequest(context, $"Data payload exceeds {MaxDataJsonLength} characters.");
            try { using var _ = System.Text.Json.JsonDocument.Parse(dataJson); }
            catch { return ApiError.BadRequest(context, "Data payload must be valid JSON."); }
        }

        var normalizedPlatform = (platform ?? "").Trim().ToLowerInvariant();
        if (!string.IsNullOrEmpty(normalizedPlatform) && !AllowedPlatforms.Contains(normalizedPlatform))
            return ApiError.BadRequest(context, "Platform filter must be 'ios', 'android', or empty for all.");

        return null;
    }

    private static bool IsHttpsUrl(string url) =>
        Uri.TryCreate(url, UriKind.Absolute, out var uri) && uri.Scheme == Uri.UriSchemeHttps;
}
