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
}
