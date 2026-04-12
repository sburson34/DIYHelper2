namespace DIYHelper2.Api.Middleware;

/// <summary>
/// Reads X-Correlation-ID from the inbound request (sent by the mobile app),
/// generates one if missing, pushes it into the logging scope so every log
/// line includes it, and echoes it back in the response headers.
/// </summary>
public class CorrelationIdMiddleware
{
    private const string Header = "X-Correlation-ID";
    private readonly RequestDelegate _next;

    public CorrelationIdMiddleware(RequestDelegate next) => _next = next;

    public async Task InvokeAsync(HttpContext context, ILogger<CorrelationIdMiddleware> logger)
    {
        var correlationId = context.Request.Headers[Header].FirstOrDefault()
                            ?? Guid.NewGuid().ToString("N")[..12];

        // Make it available to downstream middleware / handlers.
        context.Items["CorrelationId"] = correlationId;

        // Echo back so the mobile app can match its client-side ID to our logs.
        context.Response.OnStarting(() =>
        {
            context.Response.Headers[Header] = correlationId;
            return Task.CompletedTask;
        });

        // Push into the log scope — every ILogger call inside this request
        // will automatically include CorrelationId.
        using (logger.BeginScope(new Dictionary<string, object>
        {
            ["CorrelationId"] = correlationId
        }))
        {
            await _next(context);
        }
    }
}
