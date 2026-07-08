namespace DIYHelper2.Api.AI;

public record AIImagePart(byte[] Data, string MimeType);

public record AIChatRequest(
    string System,
    string User,
    IReadOnlyList<AIImagePart> Images,
    TimeSpan? Timeout = null,
    // Hard ceiling on generated tokens. Bounds worst-case output cost and
    // truncates runaway/abusive responses. Providers default to 4096 if null.
    int? MaxOutputTokens = null
);

public interface IAIVisionClient
{
    /// <summary>
    /// Completes a vision chat and returns the raw text body (caller does JSON extraction).
    /// </summary>
    Task<string> CompleteAsync(AIChatRequest request, CancellationToken cancellationToken = default);

    string ProviderName { get; }
}
