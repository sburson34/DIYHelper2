using DIYHelper2.Api.AI;

namespace DIYHelper2.Tests.Infrastructure;

/// <summary>
/// Test double for <see cref="IAIVisionClient"/>. Returns canned JSON so
/// integration tests can exercise the full <c>/api/analyze</c> pipeline —
/// request decoding, AI call, JSON extraction, affiliate-link rewriting,
/// PubChem and YouTube enrichment — without hitting a real LLM provider.
/// Records every request so tests can assert on what the handler sent.
/// </summary>
public class FakeAIVisionClient : IAIVisionClient
{
    public string ProviderName => "fake";

    public List<AIChatRequest> Requests { get; } = new();
    public Func<AIChatRequest, Task<string>> Responder { get; set; } =
        _ => Task.FromResult("{}");

    public async Task<string> CompleteAsync(AIChatRequest request, CancellationToken cancellationToken = default)
    {
        Requests.Add(request);
        return await Responder(request);
    }
}
