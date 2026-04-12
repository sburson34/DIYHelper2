using System.ClientModel;
using System.Text.Json;

namespace DIYHelper2.Api.Middleware;

/// <summary>
/// Global exception handler. Classifies exceptions, logs structured details,
/// and returns a standardized safe JSON response. In Development, the response
/// includes the exception type and message for debugging; in beta/prod only a
/// correlation ID is returned so the developer can look it up in server logs.
/// </summary>
public class ExceptionHandlerMiddleware
{
    private readonly RequestDelegate _next;
    private readonly bool _isDevelopment;

    public ExceptionHandlerMiddleware(RequestDelegate next, IHostEnvironment env)
    {
        _next = next;
        _isDevelopment = env.IsDevelopment();
    }

    public async Task InvokeAsync(HttpContext context, ILogger<ExceptionHandlerMiddleware> logger)
    {
        try
        {
            await _next(context);
        }
        catch (Exception ex)
        {
            if (context.Response.HasStarted)
                throw;

            var correlationId = context.Items["CorrelationId"] as string;
            var (statusCode, userMessage, errorCode) = Classify(ex);

            logger.LogError(ex,
                "Unhandled {ErrorCode} on {Method} {Path} — {ExceptionType}: {ExceptionMessage}",
                errorCode,
                context.Request.Method,
                context.Request.Path.Value,
                ex.GetType().Name,
                ex.Message);

            context.Response.StatusCode = statusCode;
            context.Response.ContentType = "application/json";

            var body = new Dictionary<string, object?>
            {
                ["error"] = userMessage,
                ["code"] = errorCode,
                ["correlationId"] = correlationId,
            };

            if (_isDevelopment)
            {
                body["debug"] = new
                {
                    exception = ex.GetType().FullName,
                    message = ex.Message,
                    stackTrace = ex.StackTrace,
                    inner = ex.InnerException?.Message,
                };
            }

            await context.Response.WriteAsync(JsonSerializer.Serialize(body));
        }
    }

    /// <summary>
    /// Maps known exception types to HTTP status codes, user-safe messages, and
    /// a machine-readable error code the mobile app can match on.
    /// </summary>
    private static (int Status, string Message, string Code) Classify(Exception ex)
    {
        // JSON body deserialization failures (bad request from client).
        if (ex is JsonException or BadHttpRequestException)
            return (400, "The request was malformed. Please check the input and try again.", "bad_request");

        // OpenAI content policy / rate limit / bad-request errors.
        // The OpenAI SDK wraps these in ClientResultException.
        if (ex is ClientResultException cre)
        {
            var status = cre.Status;

            if (status == 429)
                return (429, "The service is temporarily busy. Please wait a moment and try again.", "rate_limited");

            if (status == 400 || ex.Message.Contains("content_filter", StringComparison.OrdinalIgnoreCase))
                return (422, "The AI could not process this request. Try a shorter description or different photo.", "ai_rejected");

            return (502, "The AI service returned an error. Please try again.", "ai_error");
        }

        // Network-level timeouts to OpenAI.
        if (ex is TaskCanceledException or OperationCanceledException)
            return (504, "The request timed out. Please try again with a simpler description or fewer photos.", "timeout");

        if (ex is HttpRequestException)
            return (502, "Could not reach an upstream service. Please try again shortly.", "upstream_unreachable");

        // Catch-all.
        return (500, "An internal error occurred. Please try again.", "internal_error");
    }
}
