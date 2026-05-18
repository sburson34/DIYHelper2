using System.Net;
using System.Net.Http;

namespace DIYHelper2.Tests.Infrastructure;

/// <summary>
/// Replays canned HTTP responses based on a per-test responder lambda. Used by
/// integration tests that need to inject a fake handler into a typed
/// <c>HttpClient</c> registration (e.g., WeatherClient, RedditClient,
/// PubChemClient, ModerationService, PlayIntegrityVerifier).
///
/// Records every outgoing request so tests can assert on URL / method /
/// body shape without coupling to a real upstream.
/// </summary>
public class FakeHttpMessageHandler : HttpMessageHandler
{
    public List<HttpRequestMessage> Requests { get; } = new();
    public Func<HttpRequestMessage, Task<HttpResponseMessage>> Responder { get; set; } =
        _ => Task.FromResult(new HttpResponseMessage(HttpStatusCode.NotImplemented));

    public static FakeHttpMessageHandler ReturnsJson(HttpStatusCode status, string json)
    {
        return new FakeHttpMessageHandler
        {
            Responder = _ => Task.FromResult(new HttpResponseMessage(status)
            {
                Content = new StringContent(json, System.Text.Encoding.UTF8, "application/json"),
            }),
        };
    }

    public static FakeHttpMessageHandler ReturnsText(HttpStatusCode status, string body, string contentType = "text/plain")
    {
        return new FakeHttpMessageHandler
        {
            Responder = _ => Task.FromResult(new HttpResponseMessage(status)
            {
                Content = new StringContent(body, System.Text.Encoding.UTF8, contentType),
            }),
        };
    }

    protected override async Task<HttpResponseMessage> SendAsync(
        HttpRequestMessage request, CancellationToken cancellationToken)
    {
        // Capture the request URI + method before the body is consumed by the
        // responder, so assertions never see a half-read stream.
        Requests.Add(request);
        return await Responder(request);
    }
}
