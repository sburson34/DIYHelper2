namespace DIYHelper2.Api.AI;

/// <summary>
/// Resolves which AI provider to use based on the AI_PROVIDER env var.
/// Supports "openai" (default), "anthropic", and "openai-with-anthropic-fallback".
/// </summary>
public class AIClientFactory
{
    private readonly IAIVisionClient _openAi;
    private readonly IAIVisionClient? _anthropic;
    private readonly string _mode;
    private readonly ILogger<AIClientFactory> _logger;

    public AIClientFactory(IAIVisionClient openAi, IAIVisionClient? anthropic, string mode, ILogger<AIClientFactory> logger)
    {
        _openAi = openAi;
        _anthropic = anthropic;
        _mode = mode;
        _logger = logger;
    }

    public async Task<string> CompleteAsync(AIChatRequest request, CancellationToken ct = default)
    {
        switch (_mode)
        {
            case "anthropic":
                if (_anthropic is null) throw new InvalidOperationException("ANTHROPIC_API_KEY not configured.");
                return await _anthropic.CompleteAsync(request, ct);

            case "openai-with-anthropic-fallback":
                try { return await _openAi.CompleteAsync(request, ct); }
                catch (Exception ex) when (_anthropic is not null)
                {
                    _logger.LogWarning(ex, "OpenAI call failed, falling back to Anthropic.");
                    return await _anthropic.CompleteAsync(request, ct);
                }

            default:
                return await _openAi.CompleteAsync(request, ct);
        }
    }
}
