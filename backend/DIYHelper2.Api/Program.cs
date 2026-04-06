using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using OpenAI.Chat;
using OpenAI;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Linq;
using System.ClientModel;
using System.ClientModel.Primitives;
using Amazon.SecretsManager;
using Amazon.SecretsManager.Model;
using DIYHelper2.Api.Data;
using DIYHelper2.Api.Models;

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

// Add SQLite database
builder.Services.AddDbContext<AppDbContext>(options =>
    options.UseSqlite("Data Source=helpRequests.db"));

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

// Fetch OpenAI API key from AWS Secrets Manager (or fall back to env var for local dev)
string? openAiKey = null;
{
    var startupLogger = app.Services.GetRequiredService<ILogger<Program>>();
    string? secretArn = Environment.GetEnvironmentVariable("SECRET_ARN");
    if (!string.IsNullOrEmpty(secretArn))
    {
        try
        {
            using var smClient = new AmazonSecretsManagerClient(Amazon.RegionEndpoint.USEast1);
            var response = await smClient.GetSecretValueAsync(new GetSecretValueRequest { SecretId = secretArn });
            var secretString = response.SecretString;
            // Handle JSON-wrapped secret: {"OPENAI_API_KEY":"sk-..."}
            try
            {
                var parsed = JsonSerializer.Deserialize<JsonElement>(secretString);
                if (parsed.TryGetProperty("OPENAI_API_KEY", out var keyProp))
                    openAiKey = keyProp.GetString();
            }
            catch (JsonException) { }
            openAiKey ??= secretString;
            startupLogger.LogInformation("OpenAI API key loaded from Secrets Manager.");
        }
        catch (Exception ex)
        {
            startupLogger.LogError(ex, "Failed to fetch secret from Secrets Manager (ARN: {Arn}).", secretArn);
        }
    }
    openAiKey ??= Environment.GetEnvironmentVariable("OPENAI_API_KEY");
    if (string.IsNullOrEmpty(openAiKey))
        startupLogger.LogWarning("OPENAI_API_KEY is not configured. Set SECRET_ARN or OPENAI_API_KEY env var.");
    else
        startupLogger.LogInformation("Backend starting up. Listening for requests...");
}

// Ensure SQLite database is created
using (var scope = app.Services.CreateScope())
{
    var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
    db.Database.EnsureCreated();
}

// Configure the HTTP request pipeline.
if (app.Environment.IsDevelopment())
{
    app.MapOpenApi();
}

app.UseDefaultFiles();
app.UseStaticFiles();

app.UseCors("MobilePolicy");

app.MapControllers();

app.MapGet("/", () => "DIYHelper2 API is running on " + DateTime.Now);

app.MapPost("/api/analyze", async ([FromBody] AnalyzeProjectRequest request, ILogger<Program> logger) =>
{
    try
    {
        string requestSizeStr = request.Media != null ? $"{request.Media.Length} media items, total base64 chars: {request.Media.Sum(m => (long)(m.Base64?.Length ?? 0))}" : "no media";
        logger.LogInformation("Analysis request received. Description: {DescLength} chars, {RequestSize}", request.Description?.Length ?? 0, requestSizeStr);

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

        // Count images so GPT-4o can reference them by number
        int imageCount = 0;
        if (request.Media != null)
        {
            foreach (var m in request.Media)
            {
                if (m.Type != "video" && (!string.IsNullOrEmpty(m.Base64) || !string.IsNullOrEmpty(m.Url)))
                    imageCount++;
            }
        }

        string imageRef = imageCount > 0
            ? $"I have attached {imageCount} photo(s) numbered 1 through {imageCount}. Reference them by number in your annotations."
            : "No photos were provided.";

        string textContent = $@"I want to do a DIY project. {(string.IsNullOrEmpty(request.Description) ? "Please analyze the media." : $"Description: \"{request.Description}\"")}

{imageRef}

Return a JSON object with exactly these fields:
{{
  ""title"": ""Project Title"",
  ""steps"": [
    {{
      ""text"": ""Step description"",
      ""image_annotations"": [
        {{
          ""photo_number"": 1,
          ""description"": ""Describe what to look at or mark up in this user photo for this step""
        }}
      ],
      ""reference_image_search"": ""A Google Images search query for a helpful reference image for this step, or null if not needed""
    }}
  ],
  ""image_annotations"": [
    {{
      ""photo_number"": 1,
      ""overview"": ""Overall description of what this photo shows and key areas of concern""
    }}
  ],
  ""tools_and_materials"": [""item 1"", ""item 2""],
  ""difficulty"": ""easy/medium/hard"",
  ""estimated_time"": ""e.g. 2 hours"",
  ""estimated_cost"": ""e.g. $50-$100"",
  ""youtube_links"": [""https://youtube.com/watch?v=...""],
  ""shopping_links"": [
    {{ ""item"": ""item name"", ""url"": ""https://..."" }}
  ],
  ""safety_tips"": [""Tip 1"", ""Tip 2""],
  ""when_to_call_pro"": [""Warning 1"", ""Warning 2""]
}}

IMPORTANT for steps:
- Each step's image_annotations should reference user photos by photo_number (1-indexed) when the photo is relevant to that step. Include a description of what to look at in the photo.
- reference_image_search should be a useful Google Images search query that would find a helpful diagram or reference photo for that step. Set to null if the user's photos are sufficient.
- The top-level image_annotations should provide an overview analysis of each user photo.";

        var messages = new List<ChatMessage>
        {
            new SystemChatMessage("You are a helpful DIY project assistant. Analyze any provided photos carefully. Provide a detailed step-by-step guide with image annotations referencing the user's photos and suggest reference image searches. Return valid JSON only.")
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

app.MapPost("/api/ask-helper", async ([FromBody] AskHelperRequest request, ILogger<Program> logger) =>
{
    try
    {
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

// ── Help Request endpoints ──────────────────────────────────────────

app.MapPost("/api/help-requests", async ([FromBody] CreateHelpRequestDto dto, AppDbContext db) =>
{
    var helpRequest = new HelpRequest
    {
        CustomerName = dto.CustomerName,
        CustomerEmail = dto.CustomerEmail,
        CustomerPhone = dto.CustomerPhone,
        ProjectTitle = dto.ProjectTitle,
        UserDescription = dto.UserDescription,
        ProjectData = dto.ProjectData,
        ImageBase64 = dto.ImageBase64,
        Status = "new",
        CreatedAt = DateTime.UtcNow,
        UpdatedAt = DateTime.UtcNow
    };
    db.HelpRequests.Add(helpRequest);
    await db.SaveChangesAsync();
    return Results.Created($"/api/help-requests/{helpRequest.Id}", new { id = helpRequest.Id });
});

app.MapGet("/api/help-requests", async ([FromQuery] string? status, AppDbContext db) =>
{
    var query = db.HelpRequests.AsQueryable();
    if (!string.IsNullOrEmpty(status))
        query = query.Where(r => r.Status == status);

    var results = await query
        .OrderByDescending(r => r.CreatedAt)
        .Select(r => new
        {
            r.Id,
            r.CustomerName,
            r.CustomerEmail,
            r.CustomerPhone,
            r.ProjectTitle,
            r.UserDescription,
            r.Status,
            r.Notes,
            r.FollowUpDate,
            r.CreatedAt,
            r.UpdatedAt
        })
        .ToListAsync();
    return Results.Ok(results);
});

app.MapGet("/api/help-requests/{id:int}", async (int id, AppDbContext db) =>
{
    var request = await db.HelpRequests.FindAsync(id);
    return request is not null ? Results.Ok(request) : Results.NotFound();
});

app.MapPut("/api/help-requests/{id:int}", async (int id, [FromBody] UpdateHelpRequestDto dto, AppDbContext db) =>
{
    var request = await db.HelpRequests.FindAsync(id);
    if (request is null) return Results.NotFound();

    if (dto.Status is not null) request.Status = dto.Status;
    if (dto.Notes is not null) request.Notes = dto.Notes;
    if (dto.FollowUpDate.HasValue) request.FollowUpDate = dto.FollowUpDate;
    request.UpdatedAt = DateTime.UtcNow;

    await db.SaveChangesAsync();
    return Results.Ok(request);
});

app.MapDelete("/api/help-requests/{id:int}", async (int id, AppDbContext db) =>
{
    var request = await db.HelpRequests.FindAsync(id);
    if (request is null) return Results.NotFound();

    db.HelpRequests.Remove(request);
    await db.SaveChangesAsync();
    return Results.NoContent();
});

app.Run();

public record CreateHelpRequestDto(
    [property: JsonPropertyName("customerName")] string CustomerName,
    [property: JsonPropertyName("customerEmail")] string CustomerEmail,
    [property: JsonPropertyName("customerPhone")] string CustomerPhone,
    [property: JsonPropertyName("projectTitle")] string ProjectTitle,
    [property: JsonPropertyName("userDescription")] string UserDescription,
    [property: JsonPropertyName("projectData")] string ProjectData,
    [property: JsonPropertyName("imageBase64")] string? ImageBase64
);

public record UpdateHelpRequestDto(
    [property: JsonPropertyName("status")] string? Status,
    [property: JsonPropertyName("notes")] string? Notes,
    [property: JsonPropertyName("followUpDate")] DateTime? FollowUpDate
);

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
