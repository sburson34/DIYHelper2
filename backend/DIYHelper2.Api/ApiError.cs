namespace DIYHelper2.Api;

/// <summary>
/// Standardized error response helper. Use for explicit error returns inside
/// endpoint handlers (validation failures, missing config, etc.). Unhandled
/// exceptions should NOT use this — let them propagate to ExceptionHandlerMiddleware.
/// </summary>
public static class ApiError
{
    public static IResult Response(HttpContext context, int statusCode, string message, string code)
    {
        var correlationId = context.Items["CorrelationId"] as string;
        return Results.Json(new { error = message, code, correlationId }, statusCode: statusCode);
    }

    public static IResult BadRequest(HttpContext context, string message)
        => Response(context, 400, message, "bad_request");

    public static IResult NotConfigured(HttpContext context, string what)
        => Response(context, 503, $"{what} is not configured. The service is temporarily unavailable.", "not_configured");
}
