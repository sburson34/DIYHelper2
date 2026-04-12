using System.Diagnostics;
using System.Text.Json;
using OpenAI.Chat;

namespace DIYHelper2.Api;

/// <summary>
/// Wraps OpenAI ChatCompletion calls with structured logging for diagnosability.
/// Captures: action name, model, duration, correlation ID, image/description
/// metadata, and classified error outcomes. Never logs prompts, API keys,
/// raw user content, or image payloads.
/// </summary>
public static class AiWorkflow
{
    /// <summary>
    /// Execute an OpenAI chat completion with full observability.
    /// Returns the raw text content from the first choice.
    /// </summary>
    public static async Task<string> CompleteAsync(
        ChatClient client,
        IList<ChatMessage> messages,
        ChatCompletionOptions? options,
        AiCallContext ctx,
        ILogger logger)
    {
        var correlationId = ctx.CorrelationId;
        var sw = Stopwatch.StartNew();

        logger.LogInformation(
            "AI call started: {Action} model={Model} descLen={DescriptionLength} images={ImageCount} lang={Language} correlationId={CorrelationId}",
            ctx.Action, ctx.Model, ctx.DescriptionLength, ctx.ImageCount, ctx.Language ?? "en", correlationId);

        try
        {
            var completion = await client.CompleteChatAsync(messages, options);
            sw.Stop();

            var text = completion.Value.Content[0].Text.Trim();

            logger.LogInformation(
                "AI call succeeded: {Action} durationMs={DurationMs} responseLen={ResponseLength} correlationId={CorrelationId}",
                ctx.Action, sw.ElapsedMilliseconds, text.Length, correlationId);

            return text;
        }
        catch (Exception ex)
        {
            sw.Stop();
            var errorCategory = ClassifyError(ex);

            logger.LogError(ex,
                "AI call failed: {Action} error={ErrorCategory} durationMs={DurationMs} exceptionType={ExceptionType} correlationId={CorrelationId}",
                ctx.Action, errorCategory, sw.ElapsedMilliseconds, ex.GetType().Name, correlationId);

            throw;
        }
    }

    /// <summary>
    /// Extract JSON from a raw AI response (handles markdown code fences).
    /// Logs a warning on parse failure with safe metadata only.
    /// </summary>
    public static Dictionary<string, JsonElement>? ParseJsonResponse(
        string raw, AiCallContext ctx, ILogger logger)
    {
        var json = raw;
        int a = raw.IndexOf('{');
        int b = raw.LastIndexOf('}');
        if (a >= 0 && b > a)
            json = raw.Substring(a, b - a + 1);

        try
        {
            return JsonSerializer.Deserialize<Dictionary<string, JsonElement>>(json);
        }
        catch (JsonException ex)
        {
            logger.LogWarning(ex,
                "AI response JSON parse failed: {Action} responseLen={ResponseLength} correlationId={CorrelationId}",
                ctx.Action, raw.Length, ctx.CorrelationId);
            return null;
        }
    }

    private static string ClassifyError(Exception ex) => ex switch
    {
        System.ClientModel.ClientResultException cre when cre.Status == 429 => "rate_limited",
        System.ClientModel.ClientResultException cre when cre.Status == 400 => "bad_request",
        System.ClientModel.ClientResultException => "upstream_error",
        TaskCanceledException => "timeout",
        OperationCanceledException => "cancelled",
        HttpRequestException => "network_error",
        JsonException => "parse_error",
        _ => "unknown",
    };
}

/// <summary>
/// Safe metadata for an AI call. No prompts, no user content, no keys.
/// </summary>
public record AiCallContext(
    string Action,
    string Model,
    int DescriptionLength,
    int ImageCount,
    string? Language,
    string? CorrelationId
);
