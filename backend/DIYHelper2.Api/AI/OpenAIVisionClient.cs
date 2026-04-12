using System.ClientModel;
using OpenAI;
using OpenAI.Chat;

namespace DIYHelper2.Api.AI;

public class OpenAIVisionClient : IAIVisionClient
{
    private readonly string _apiKey;
    private readonly string _model;
    private readonly ILogger<OpenAIVisionClient> _logger;

    public string ProviderName => "openai";

    public OpenAIVisionClient(string apiKey, ILogger<OpenAIVisionClient> logger, string model = "gpt-4o")
    {
        _apiKey = apiKey;
        _model = model;
        _logger = logger;
    }

    public async Task<string> CompleteAsync(AIChatRequest request, CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrEmpty(_apiKey))
            throw new InvalidOperationException("OPENAI_API_KEY is not configured.");

        var clientOptions = new OpenAIClientOptions
        {
            NetworkTimeout = request.Timeout ?? TimeSpan.FromMinutes(2)
        };

        var client = new ChatClient(model: _model, new ApiKeyCredential(_apiKey), clientOptions);
        var options = new ChatCompletionOptions { EndUserId = "diy-helper-app" };

        var parts = new List<ChatMessageContentPart>
        {
            ChatMessageContentPart.CreateTextPart(request.User)
        };
        foreach (var img in request.Images)
        {
            parts.Add(ChatMessageContentPart.CreateImagePart(BinaryData.FromBytes(img.Data), img.MimeType));
        }

        var messages = new List<ChatMessage>
        {
            new SystemChatMessage(request.System),
            new UserChatMessage(parts)
        };

        ChatCompletion completion = await client.CompleteChatAsync(messages, options, cancellationToken);
        return completion.Content[0].Text.Trim();
    }
}
