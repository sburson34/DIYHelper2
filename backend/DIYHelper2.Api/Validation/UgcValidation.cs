namespace DIYHelper2.Api.Validation;

/// <summary>
/// Size limits for the two endpoints that accept free-form user content with no
/// account behind it: the community project feed and beta feedback.
///
/// <para><b>Why.</b> Both accepted arbitrarily large fields, bounded only by the
/// 50 MB Kestrel body limit. The community feed keeps its last 500 posts in
/// process memory, so 500 posts × tens of MB is a straightforward
/// memory-exhaustion path that needs no authentication; feedback goes straight to
/// Postgres, where the same trick is a disk-fill instead. The per-IP "submit"
/// limiter caps how *often* a client posts, never how *big* each post is — so the
/// size ceiling has to live here.</para>
///
/// <para>Limits are far above any genuine submission (a long bug report is a few
/// thousand characters) so nothing real gets turned away.</para>
/// </summary>
public static class UgcValidation
{
    public const int MaxTitleLength = 200;
    public const int MaxFreeTextLength = 8_000;
    public const int MaxShortFieldLength = 100;
    public const int MaxMetadataFieldLength = 200;

    /// <summary>Serialized ceiling for the opaque JSON blobs on a community post
    /// (steps, tools) — they're client-shaped, so cap the whole thing by size.</summary>
    public const int MaxStructuredJsonLength = 32_000;

    /// <summary>A community post's photo is a URI or small data: URL, not a
    /// full-resolution upload. Anything larger belongs in the analyze flow.</summary>
    public const int MaxPhotoUriLength = 512_000;

    public static IResult? ValidateCommunityProject(CommunityProjectDto dto, HttpContext context)
    {
        var tooLong =
            Over(dto.Title, MaxTitleLength) ? $"title (max {MaxTitleLength} characters)" :
            Over(dto.Description, MaxFreeTextLength) ? $"description (max {MaxFreeTextLength} characters)" :
            Over(dto.Difficulty, MaxShortFieldLength) ? "difficulty" :
            Over(dto.EstimatedTime, MaxShortFieldLength) ? "estimated_time" :
            Over(dto.EstimatedCost, MaxShortFieldLength) ? "estimated_cost" :
            Over(dto.PhotoUri, MaxPhotoUriLength) ? "photoUri" :
            null;
        if (tooLong != null)
            return ApiError.BadRequest(context, $"This project's {tooLong} is too long to share.");

        if (SerializedLength(dto.Steps) > MaxStructuredJsonLength)
            return ApiError.BadRequest(context, "This project has too many steps to share.");
        if (SerializedLength(dto.ToolsAndMaterials) > MaxStructuredJsonLength)
            return ApiError.BadRequest(context, "This project has too many tools and materials to share.");

        return null;
    }

    public static IResult? ValidateFeedback(CreateFeedbackDto dto, HttpContext context)
    {
        var tooLong =
            Over(dto.Description, MaxFreeTextLength) ? "description" :
            Over(dto.WhatYouWereDoing, MaxFreeTextLength) ? "what you were doing" :
            Over(dto.ReproSteps, MaxFreeTextLength) ? "steps to reproduce" :
            Over(dto.Id, MaxShortFieldLength) ? "id" :
            null;
        if (tooLong != null)
            return ApiError.BadRequest(context,
                $"Your {tooLong} is too long — please keep it under {MaxFreeTextLength} characters.");

        return null;
    }

    /// <summary>Clamp a machine-generated metadata value (app version, OS, screen
    /// name…). These are never worth rejecting a bug report over, so they're
    /// truncated rather than validated.</summary>
    public static string? ClampMetadata(string? value) =>
        value is not null && value.Length > MaxMetadataFieldLength
            ? value.Substring(0, MaxMetadataFieldLength)
            : value;

    private static bool Over(string? value, int max) => value is not null && value.Length > max;

    private static int SerializedLength(object? value)
    {
        if (value is null) return 0;
        try
        {
            return System.Text.Json.JsonSerializer.Serialize(value).Length;
        }
        catch
        {
            // Unserializable → treat as over-limit rather than letting it through.
            return int.MaxValue;
        }
    }
}
