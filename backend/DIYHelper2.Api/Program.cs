using Microsoft.AspNetCore.Mvc;
using OpenAI.Chat;
using OpenAI;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Linq;
using System.ClientModel;
using System.ClientModel.Primitives;

var builder = WebApplication.CreateBuilder(args);

// Add services to the container.
builder.Services.AddControllers();
builder.Services.AddOpenApi();

builder.Logging.AddConsole();
builder.Logging.AddDebug();

// Increase max request body size to 50MB (default is 30MB)
builder.WebHost.ConfigureKestrel(serverOptions =>
{
    serverOptions.Limits.MaxRequestBodySize = 50 * 1024 * 1024;
});
builder.Services.Configure<Microsoft.AspNetCore.Http.Features.FormOptions>(options =>
{
    options.MultipartBodyLengthLimit = 50 * 1024 * 1024;
});

// Add CORS
builder.Services.AddCors(options =>
{
    options.AddPolicy("MobilePolicy",
        policy =>
        {
            policy.AllowAnyOrigin()
                  .AllowAnyHeader()
                  .AllowAnyMethod();
        });
});

var app = builder.Build();

// Configure the HTTP request pipeline.
if (app.Environment.IsDevelopment())
{
    app.MapOpenApi();
}

app.UseCors("MobilePolicy");

app.MapControllers();

var logger = app.Services.GetRequiredService<ILogger<Program>>();
logger.LogInformation("Backend starting up. Listening for requests...");

app.MapGet("/", () => "DIYHelper2 API is running on " + DateTime.Now);

app.MapPost("/api/analyze", async ([FromBody] AnalyzeProjectRequest request, IConfiguration config, ILogger<Program> logger) =>
{
    try
    {
        string requestSizeStr = request.Media != null ? $"{request.Media.Length} media items, total base64 chars: {request.Media.Sum(m => (long)(m.Base64?.Length ?? 0))}" : "no media";
        logger.LogInformation("Analysis request received. Description: {DescLength} chars, {RequestSize}", request.Description?.Length ?? 0, requestSizeStr);

        string? openAiKey = config["OPENAI_API_KEY"] ?? Environment.GetEnvironmentVariable("OPENAI_API_KEY");

        if (string.IsNullOrEmpty(openAiKey))
        {
            logger.LogError("OPENAI_API_KEY is not configured.");
            return Results.Json(new { error = "OPENAI_API_KEY is not configured." }, statusCode: 500);
        }

        OpenAIClientOptions clientOptions = new();
        clientOptions.NetworkTimeout = TimeSpan.FromMinutes(2); // Wait up to 2 minutes for long uploads/analysis

        ChatClient client = new(model: "gpt-4o", new ApiKeyCredential(openAiKey), clientOptions);

        ChatCompletionOptions options = new()
        {
            EndUserId = "diy-helper-app"
        };

        // Increase timeout for large image uploads
        // The SDK doesn't expose a direct timeout on ChatClient easily without custom Pipeline
        // but we can try to set it via OpenAIClient if we used that,
        // however ChatClient is what we have here.

        string textContent = $"I want to do a DIY project. {(string.IsNullOrEmpty(request.Description) ? "Please analyze the media." : $"Description: \"{request.Description}\"")}\n\nReturn a JSON object with exactly these fields:\n{{\n  \"title\": \"Project Title\",\n  \"steps\": [\"Step 1\", \"Step 2\"],\n  \"tools_and_materials\": [\"item 1\", \"item 2\"],\n  \"difficulty\": \"easy/medium/hard\",\n  \"estimated_time\": \"e.g. 2 hours\",\n  \"estimated_cost\": \"e.g. $50-$100\",\n  \"youtube_links\": [\"https://youtube.com/watch?v=...\", \"https://youtube.com/watch?v=...\"],\n  \"shopping_links\": [\n    {{ \"item\": \"item name\", \"url\": \"https://...\" }},\n    {{ \"item\": \"item name\", \"url\": \"https://...\" }}\n  ],\n  \"safety_tips\": [\"Tip 1\", \"Tip 2\"],\n  \"when_to_call_pro\": [\"Warning 1\", \"Warning 2\"]\n}}";

        var messages = new List<ChatMessage>
        {
            new SystemChatMessage("You are a helpful DIY project assistant. Provide a detailed step-by-step guide with relevant links in valid JSON format.")
        };

        var userMessageParts = new List<ChatMessageContentPart>
        {
            ChatMessageContentPart.CreateTextPart(textContent)
        };

        bool hasValidImages = false;
        if (request.Media != null)
        {
            foreach (var item in request.Media)
            {
                if (item.Type == "video")
                {
                    logger.LogInformation("Skipping video item as OpenAI Chat Completion SDK for images doesn't support direct video parts yet.");
                    continue;
                }

                if (!string.IsNullOrEmpty(item.Base64))
                {
                    try
                    {
                        byte[] data = Convert.FromBase64String(item.Base64);
                        logger.LogInformation("Processing image part. Size: {Size} bytes, Mime: {Mime}", data.Length, item.MimeType ?? "image/jpeg");
                        userMessageParts.Add(ChatMessageContentPart.CreateImagePart(BinaryData.FromBytes(data), item.MimeType ?? "image/jpeg"));
                        hasValidImages = true;
                    }
                    catch (Exception ex)
                    {
                        logger.LogWarning(ex, "Failed to decode base64 image.");
                    }
                }
                else if (!string.IsNullOrEmpty(item.Url))
                {
                    if (Uri.TryCreate(item.Url, UriKind.Absolute, out var uri))
                    {
                        if (uri.Scheme == "http" || uri.Scheme == "https")
                        {
                            userMessageParts.Add(ChatMessageContentPart.CreateImagePart(uri));
                            hasValidImages = true;
                        }
                        else
                        {
                            logger.LogWarning("Skipping non-HTTP(S) media URL: {Url}", item.Url);
                        }
                    }
                }
            }
        }

        if (!hasValidImages && string.IsNullOrEmpty(request.Description))
        {
            return Results.Json(new { error = "Please provide a project description or a valid image." }, statusCode: 400);
        }

        messages.Add(new UserChatMessage(userMessageParts));

        ChatCompletion completion = await client.CompleteChatAsync(messages, options);
        string rawContent = completion.Content[0].Text.Trim();
        logger.LogInformation("OpenAI raw response: {Response}", rawContent);

        string jsonContent = rawContent;
        // Robust JSON extraction
        int firstBrace = rawContent.IndexOf('{');
        int lastBrace = rawContent.LastIndexOf('}');
        if (firstBrace >= 0 && lastBrace > firstBrace)
        {
            jsonContent = rawContent.Substring(firstBrace, lastBrace - firstBrace + 1);
        }

        try
        {
            var parsed = JsonSerializer.Deserialize<JsonElement>(jsonContent);
            return Results.Ok(parsed);
        }
        catch (JsonException ex)
        {
            logger.LogError(ex, "Failed to parse OpenAI JSON response. Content: {Content}", jsonContent);
            return Results.Json(new { error = "AI returned invalid JSON", rawResponse = rawContent }, statusCode: 500);
        }
    }
    catch (Exception ex)
    {
        logger.LogError(ex, "Error during DIY analysis. Exception: {Message}. StackTrace: {StackTrace}", ex.Message, ex.StackTrace);

        // Detailed error for common OpenAI failures
        if (ex.Message.Contains("400") || ex.Message.Contains("content_filter") || ex.Message.Contains("limit"))
        {
             return Results.Json(new { error = $"OpenAI API Error: {ex.Message}", details = ex.ToString() }, statusCode: 400);
        }

        return Results.Json(new { error = ex.Message, stackTrace = ex.StackTrace, innerException = ex.InnerException?.Message }, statusCode: 500);
    }
});

app.MapPost("/api/ask-helper", async ([FromBody] AskHelperRequest request, IConfiguration config, ILogger<Program> logger) =>
{
    try
    {
        string? openAiKey = config["OPENAI_API_KEY"] ?? Environment.GetEnvironmentVariable("OPENAI_API_KEY");
        if (string.IsNullOrEmpty(openAiKey))
        {
            return Results.Json(new { error = "OPENAI_API_KEY is not configured." }, statusCode: 500);
        }

        OpenAIClientOptions clientOptions = new();
        ChatClient client = new(model: "gpt-4o", new ApiKeyCredential(openAiKey), clientOptions);

        string contextJson = JsonSerializer.Serialize(request.ProjectContext);
        string systemPrompt = $"You are a helpful DIY project assistant. The user is currently working on a project with the following details: {contextJson}. Answer the user's question clearly and concisely within the context of this project.";

        var messages = new List<ChatMessage>
        {
            new SystemChatMessage(systemPrompt),
            new UserChatMessage(request.Question)
        };

        ChatCompletion completion = await client.CompleteChatAsync(messages);
        string answer = completion.Content[0].Text.Trim();

        return Results.Ok(new { answer });
    }
    catch (Exception ex)
    {
        logger.LogError(ex, "Error in Ask Helper endpoint.");
        return Results.Json(new { error = ex.Message }, statusCode: 500);
    }
});

app.Run();

public record AskHelperRequest(
    [property: JsonPropertyName("question")] string Question,
    [property: JsonPropertyName("projectContext")] object ProjectContext
);

public record AnalyzeProjectRequest(
    [property: JsonPropertyName("description")] string? Description,
    [property: JsonPropertyName("media")] MediaItem[]? Media
);

public record MediaItem(
    [property: JsonPropertyName("uri")] string? Url,
    [property: JsonPropertyName("base64")] string? Base64,
    [property: JsonPropertyName("mimeType")] string? MimeType,
    [property: JsonPropertyName("type")] string? Type
);
