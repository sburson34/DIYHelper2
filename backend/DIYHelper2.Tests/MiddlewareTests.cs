using System.ClientModel;
using System.Text.Json;
using DIYHelper2.Api.Middleware;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Moq;
using Xunit;

namespace DIYHelper2.Tests;

public class CorrelationIdMiddlewareTests
{
    [Fact]
    public async Task SetsCorrelationId_WhenNotInRequest()
    {
        var context = new DefaultHttpContext();
        var loggerMock = new Mock<ILogger<CorrelationIdMiddleware>>();
        string? captured = null;

        var middleware = new CorrelationIdMiddleware(next: async (ctx) =>
        {
            captured = ctx.Items["CorrelationId"] as string;
        });

        await middleware.InvokeAsync(context, loggerMock.Object);

        Assert.NotNull(captured);
        Assert.Equal(12, captured!.Length);
    }

    [Fact]
    public async Task UsesClientCorrelationId_WhenProvided()
    {
        var context = new DefaultHttpContext();
        context.Request.Headers["X-Correlation-ID"] = "client-id-123";
        var loggerMock = new Mock<ILogger<CorrelationIdMiddleware>>();
        string? captured = null;

        var middleware = new CorrelationIdMiddleware(next: async (ctx) =>
        {
            captured = ctx.Items["CorrelationId"] as string;
        });

        await middleware.InvokeAsync(context, loggerMock.Object);

        Assert.Equal("client-id-123", captured);
    }

    [Fact]
    public async Task StoresInContextItems()
    {
        var context = new DefaultHttpContext();
        var loggerMock = new Mock<ILogger<CorrelationIdMiddleware>>();

        var middleware = new CorrelationIdMiddleware(next: async (ctx) =>
        {
            Assert.True(ctx.Items.ContainsKey("CorrelationId"));
        });

        await middleware.InvokeAsync(context, loggerMock.Object);
    }
}

public class RequestLoggingMiddlewareTests
{
    [Fact]
    public async Task CallsNextDelegate()
    {
        var called = false;
        var middleware = new RequestLoggingMiddleware(next: async (ctx) =>
        {
            called = true;
        });

        var context = new DefaultHttpContext();
        context.Request.Path = "/api/test";
        var loggerMock = new Mock<ILogger<RequestLoggingMiddleware>>();

        await middleware.InvokeAsync(context, loggerMock.Object);

        Assert.True(called);
    }

    [Fact]
    public async Task LogsApiRequests()
    {
        var middleware = new RequestLoggingMiddleware(next: async (ctx) =>
        {
            ctx.Response.StatusCode = 200;
        });

        var context = new DefaultHttpContext();
        context.Request.Path = "/api/health";
        context.Request.Method = "GET";
        var loggerMock = new Mock<ILogger<RequestLoggingMiddleware>>();

        await middleware.InvokeAsync(context, loggerMock.Object);

        // Verify logging happened (at least once)
        loggerMock.Verify(
            x => x.Log(
                LogLevel.Information,
                It.IsAny<EventId>(),
                It.IsAny<It.IsAnyType>(),
                It.IsAny<Exception?>(),
                It.IsAny<Func<It.IsAnyType, Exception?, string>>()),
            Times.Once);
    }
}

public class ExceptionHandlerMiddlewareTests
{
    private ExceptionHandlerMiddleware CreateMiddleware(RequestDelegate next, bool isDev = true)
    {
        var envMock = new Mock<IHostEnvironment>();
        envMock.Setup(e => e.EnvironmentName).Returns(isDev ? "Development" : "Production");
        return new ExceptionHandlerMiddleware(next, envMock.Object);
    }

    [Fact]
    public async Task PassesThrough_WhenNoException()
    {
        var middleware = CreateMiddleware(async ctx => { ctx.Response.StatusCode = 200; });
        var context = new DefaultHttpContext();
        context.Items["CorrelationId"] = "test-123";
        var loggerMock = new Mock<ILogger<ExceptionHandlerMiddleware>>();

        await middleware.InvokeAsync(context, loggerMock.Object);

        Assert.Equal(200, context.Response.StatusCode);
    }

    [Fact]
    public async Task Returns400_ForJsonException()
    {
        var middleware = CreateMiddleware(ctx => throw new JsonException("bad json"));
        var context = new DefaultHttpContext();
        context.Items["CorrelationId"] = "test-123";
        context.Response.Body = new MemoryStream();
        var loggerMock = new Mock<ILogger<ExceptionHandlerMiddleware>>();

        await middleware.InvokeAsync(context, loggerMock.Object);

        Assert.Equal(400, context.Response.StatusCode);
        context.Response.Body.Seek(0, SeekOrigin.Begin);
        var body = await new StreamReader(context.Response.Body).ReadToEndAsync();
        Assert.Contains("bad_request", body);
    }

    [Fact]
    public async Task Returns504_ForTaskCanceledException()
    {
        var middleware = CreateMiddleware(ctx => throw new TaskCanceledException("timed out"));
        var context = new DefaultHttpContext();
        context.Items["CorrelationId"] = "test-123";
        context.Response.Body = new MemoryStream();
        var loggerMock = new Mock<ILogger<ExceptionHandlerMiddleware>>();

        await middleware.InvokeAsync(context, loggerMock.Object);

        Assert.Equal(504, context.Response.StatusCode);
        context.Response.Body.Seek(0, SeekOrigin.Begin);
        var body = await new StreamReader(context.Response.Body).ReadToEndAsync();
        Assert.Contains("timeout", body);
    }

    [Fact]
    public async Task Returns502_ForHttpRequestException()
    {
        var middleware = CreateMiddleware(ctx => throw new HttpRequestException("network fail"));
        var context = new DefaultHttpContext();
        context.Items["CorrelationId"] = "test-123";
        context.Response.Body = new MemoryStream();
        var loggerMock = new Mock<ILogger<ExceptionHandlerMiddleware>>();

        await middleware.InvokeAsync(context, loggerMock.Object);

        Assert.Equal(502, context.Response.StatusCode);
        context.Response.Body.Seek(0, SeekOrigin.Begin);
        var body = await new StreamReader(context.Response.Body).ReadToEndAsync();
        Assert.Contains("upstream_unreachable", body);
    }

    [Fact]
    public async Task Returns500_ForGenericException()
    {
        var middleware = CreateMiddleware(ctx => throw new Exception("unknown"));
        var context = new DefaultHttpContext();
        context.Items["CorrelationId"] = "test-123";
        context.Response.Body = new MemoryStream();
        var loggerMock = new Mock<ILogger<ExceptionHandlerMiddleware>>();

        await middleware.InvokeAsync(context, loggerMock.Object);

        Assert.Equal(500, context.Response.StatusCode);
        context.Response.Body.Seek(0, SeekOrigin.Begin);
        var body = await new StreamReader(context.Response.Body).ReadToEndAsync();
        Assert.Contains("internal_error", body);
    }

    [Fact]
    public async Task IncludesDebugInfo_InDevelopment()
    {
        var middleware = CreateMiddleware(ctx => throw new Exception("debug test"), isDev: true);
        var context = new DefaultHttpContext();
        context.Items["CorrelationId"] = "test-123";
        context.Response.Body = new MemoryStream();
        var loggerMock = new Mock<ILogger<ExceptionHandlerMiddleware>>();

        await middleware.InvokeAsync(context, loggerMock.Object);

        context.Response.Body.Seek(0, SeekOrigin.Begin);
        var body = await new StreamReader(context.Response.Body).ReadToEndAsync();
        Assert.Contains("debug", body);
        Assert.Contains("debug test", body);
    }

    [Fact]
    public async Task ExcludesDebugInfo_InProduction()
    {
        var middleware = CreateMiddleware(ctx => throw new Exception("secret error"), isDev: false);
        var context = new DefaultHttpContext();
        context.Items["CorrelationId"] = "test-123";
        context.Response.Body = new MemoryStream();
        var loggerMock = new Mock<ILogger<ExceptionHandlerMiddleware>>();

        await middleware.InvokeAsync(context, loggerMock.Object);

        context.Response.Body.Seek(0, SeekOrigin.Begin);
        var body = await new StreamReader(context.Response.Body).ReadToEndAsync();
        Assert.DoesNotContain("secret error", body);
    }

    [Fact]
    public async Task IncludesCorrelationId_InResponse()
    {
        var middleware = CreateMiddleware(ctx => throw new Exception("test"));
        var context = new DefaultHttpContext();
        context.Items["CorrelationId"] = "corr-456";
        context.Response.Body = new MemoryStream();
        var loggerMock = new Mock<ILogger<ExceptionHandlerMiddleware>>();

        await middleware.InvokeAsync(context, loggerMock.Object);

        context.Response.Body.Seek(0, SeekOrigin.Begin);
        var body = await new StreamReader(context.Response.Body).ReadToEndAsync();
        Assert.Contains("corr-456", body);
    }
}
