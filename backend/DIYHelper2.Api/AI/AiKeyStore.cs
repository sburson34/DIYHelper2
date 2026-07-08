namespace DIYHelper2.Api.AI;

/// <summary>
/// Holds the resolved OpenAI API key as a DI-injectable service. Lets us
/// register <see cref="IAIVisionClient"/> at <c>builder.Services</c> time
/// (before the key is fetched from AWS Secrets Manager) and have the factory
/// read the key lazily when the first request arrives.
///
/// <para>
/// The key is set once at startup (after the secrets fetch) and never mutated
/// afterward, so thread-safety isn't a concern in practice. The simple
/// mutable-string API is intentional — a richer provider pattern would buy
/// nothing here.
/// </para>
/// </summary>
public class AiKeyStore
{
    public string? OpenAiKey { get; set; }
    public string? AnthropicKey { get; set; }

    /// <summary>
    /// Model IDs used for every AI call. Overridable at deploy time via the
    /// <c>OPENAI_MODEL</c> / <c>ANTHROPIC_MODEL</c> env vars (see Program.cs).
    /// Defaults are the cheapest vision-capable model in each provider's
    /// lineup — the DIY workloads (photo → structured repair guide, quality
    /// checks, clarifying questions) don't need a flagship model, and cost is
    /// the priority. Bump these to a stronger tier if answer quality regresses:
    ///   OpenAI:    gpt-4o-mini ($0.15/$0.60) → gpt-4o ($2.50/$10)
    ///   Anthropic: claude-haiku-4-5 ($1/$5)  → claude-sonnet-5 / claude-opus-4-8
    /// </summary>
    public string OpenAiModel { get; set; } = "gpt-4o-mini";
    public string AnthropicModel { get; set; } = "claude-haiku-4-5";
}
