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
using DIYHelper2.Api;
using DIYHelper2.Api.Data;
using DIYHelper2.Api.Models;
using DIYHelper2.Api.Middleware;
using DIYHelper2.Api.AI;
using DIYHelper2.Api.Integrations;
using OpenTelemetry;
using OpenTelemetry.Metrics;
using OpenTelemetry.Resources;
using OpenTelemetry.Trace;

var builder = WebApplication.CreateBuilder(args);

// Add services to the container.
builder.Services.AddControllers();
builder.Services.AddOpenApi();

builder.Logging.ClearProviders();
if (builder.Environment.IsDevelopment())
{
    builder.Logging.AddSimpleConsole(options =>
    {
        options.IncludeScopes = true;
        options.TimestampFormat = "yyyy-MM-dd HH:mm:ss ";
    });
}
else
{
    // Structured JSON — one line per event, CloudWatch-parseable.
    builder.Logging.AddJsonConsole(options =>
    {
        options.IncludeScopes = true;
        options.UseUtcTimestamp = true;
        options.TimestampFormat = "yyyy-MM-ddTHH:mm:ss.fffZ";
        options.JsonWriterOptions = new System.Text.Json.JsonWriterOptions { Indented = false };
    });
}

// ── OpenTelemetry ─────────────────────────────────────────────────────
var otelServiceName = Environment.GetEnvironmentVariable("OTEL_SERVICE_NAME") ?? "diyhelper2-api";
var otelEnvironment = builder.Environment.EnvironmentName; // Development / Staging / Production
var otelServiceVersion = typeof(Program).Assembly.GetName().Version?.ToString() ?? "1.0.0";
var useOtlpExporter = !string.IsNullOrEmpty(Environment.GetEnvironmentVariable("OTEL_EXPORTER_OTLP_ENDPOINT"));

var resourceBuilder = ResourceBuilder.CreateDefault()
    .AddService(serviceName: otelServiceName, serviceVersion: otelServiceVersion)
    .AddAttributes(new Dictionary<string, object>
    {
        ["deployment.environment"] = otelEnvironment,
    });

builder.Services.AddOpenTelemetry()
    .WithTracing(tracing =>
    {
        tracing
            .SetResourceBuilder(resourceBuilder)
            .AddAspNetCoreInstrumentation(opts =>
            {
                // Don't trace static files or health checks.
                opts.Filter = ctx => ctx.Request.Path.StartsWithSegments("/api");
            })
            .AddHttpClientInstrumentation();

        if (useOtlpExporter)
            tracing.AddOtlpExporter();
        else if (builder.Environment.IsDevelopment())
            tracing.AddConsoleExporter();
    })
    .WithMetrics(metrics =>
    {
        metrics
            .SetResourceBuilder(resourceBuilder)
            .AddAspNetCoreInstrumentation()
            .AddHttpClientInstrumentation()
            .AddRuntimeInstrumentation();

        if (useOtlpExporter)
            metrics.AddOtlpExporter();
    });

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

// External integration clients (typed HttpClients for uniform retry/timeout/logging)
builder.Services.AddHttpClient<YouTubeClient>();
builder.Services.AddHttpClient<WeatherClient>();
builder.Services.AddHttpClient<RedditClient>();
builder.Services.AddHttpClient<PubChemClient>();
builder.Services.AddHttpClient<AttomClient>();
builder.Services.AddHttpClient<ReceiptOcrClient>();
builder.Services.AddSingleton<AmazonPaClient>();
builder.Services.AddSingleton<PaintColorClient>();
builder.Services.AddSingleton<FeatureFlags>();

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

// Affiliate program configuration
// Replace these placeholder values with your actual affiliate IDs once approved
string amazonAssociateTag = Environment.GetEnvironmentVariable("AMAZON_ASSOCIATE_TAG") ?? "diyhelper20-20";
string homeDepotImpactId = Environment.GetEnvironmentVariable("HOMEDEPOT_IMPACT_ID") ?? "YOUR_IMPACT_ID";

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

// Observability middleware — order matters:
// 1. CorrelationId: assigns/reads the ID and pushes it into the log scope
// 2. ExceptionHandler: catches unhandled throws, logs them, returns safe JSON
// 3. RequestLogging: logs method/path/status/duration for every API request
app.UseMiddleware<CorrelationIdMiddleware>();
app.UseMiddleware<ExceptionHandlerMiddleware>();
app.UseMiddleware<RequestLoggingMiddleware>();

app.MapControllers();

app.MapGet("/", () => "DIYHelper2 API is running on " + DateTime.Now);
app.MapGet("/api/health", () => Results.Ok(new { status = "healthy", timestamp = DateTime.UtcNow }));

// In-memory community projects store (#18). Replace with DB once schema is settled.
var communityProjects = new List<CommunityProjectDto>();

// Hazardous-chemical keyword list loaded once at startup for PubChem enrichment
HashSet<string> hazardousChemicals;
try
{
    var hazPath = Path.Combine(AppContext.BaseDirectory, "Data", "HazardousChemicals.json");
    if (File.Exists(hazPath))
    {
        var list = JsonSerializer.Deserialize<List<string>>(File.ReadAllText(hazPath)) ?? new();
        hazardousChemicals = new HashSet<string>(list.Select(s => s.ToLowerInvariant()));
    }
    else
    {
        hazardousChemicals = new HashSet<string>();
    }
}
catch
{
    hazardousChemicals = new HashSet<string>();
}

app.MapPost("/api/analyze", async (
    [FromBody] AnalyzeProjectRequest request,
    HttpContext context,
    ILogger<Program> logger,
    YouTubeClient youTube,
    PubChemClient pubChem,
    AmazonPaClient amazonPa,
    FeatureFlags features) =>
{
    try
    {
        if (string.IsNullOrEmpty(openAiKey))
            return ApiError.NotConfigured(context, "OpenAI API key");

        var correlationId = context.Items["CorrelationId"] as string;

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

        // Personalization: skill level (#15), zip/permits (#14), owned tools (#5)
        string skillClause = !string.IsNullOrWhiteSpace(request.SkillLevel)
            ? $"\nThe user describes themselves as a {request.SkillLevel} DIYer. Tailor instructions, warnings, and assumed knowledge accordingly."
            : "";
        string zipClause = !string.IsNullOrWhiteSpace(request.Zip)
            ? $"\nThe user is in zip code {request.Zip}. Use this to determine whether a permit is likely required for this work in their jurisdiction (best guess)."
            : "";
        string ownedClause = (request.OwnedTools != null && request.OwnedTools.Length > 0)
            ? $"\nThe user already owns the following tools/materials, so you should NOT include them in shopping_links (but still mention them in tools_and_materials with a marker like '(owned)'): {string.Join(", ", request.OwnedTools)}."
            : "";

        string textContent = $@"I want to do a DIY project. {(string.IsNullOrEmpty(request.Description) ? "Please analyze the media." : $"Description: \"{request.Description}\"")}

{imageRef}
{skillClause}{zipClause}{ownedClause}

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
  ""youtube_queries"": [""short search query for a helpful tutorial video"", ""second query for a different technique""],
  ""shopping_links"": [""specific product name 1"", ""specific product name 2""],
  ""safety_tips"": [""Tip 1"", ""Tip 2""],
  ""when_to_call_pro"": [""Warning 1"", ""Warning 2""],
  ""permit_required"": false,
  ""permit_notes"": ""Brief explanation if a permit may be required, or null"",
  ""pro_cost"": ""Rough cost if hiring a pro, e.g. $200-$400"",
  ""pro_time"": ""Rough time if hiring a pro"",
  ""recommendation"": ""diy or pro — short justification"",
  ""diy_vs_pro_summary"": ""1-2 sentence comparison"",
  ""outdoor"": false,
  ""weather_sensitive"": false,
  ""repair_type"": ""one of: kitchen, bathroom, roof, flooring, windows, deck, exterior_paint, interior_paint, plumbing, electrical, hvac, landscaping, garage, basement, drywall, general""
}}

IMPORTANT for steps:
- Each step's image_annotations should reference user photos by photo_number (1-indexed) when the photo is relevant to that step. Include a description of what to look at in the photo.
- reference_image_search should be a useful Google Images search query that would find a helpful diagram or reference photo for that step. Set to null if the user's photos are sufficient.
- The top-level image_annotations should provide an overview analysis of each user photo.

IMPORTANT for shopping_links:
- List specific product names that the user would need to buy (e.g. ""3/4 inch copper pipe"", ""Moen kitchen faucet cartridge"", ""DAP silicone caulk"").
- Be specific with product names so searches return relevant results. Include brand names when a specific brand matters.
- Include every item from tools_and_materials that would need to be purchased.

IMPORTANT for youtube_queries:
- ALWAYS include 2-4 short, specific YouTube search queries relevant to the project (plain text, not URLs).
- Make each query specific and different (e.g. one for the overall project, one for a tricky technique, one for a tool tutorial).

IMPORTANT for outdoor / weather_sensitive / repair_type:
- outdoor: true if the user will be working outside
- weather_sensitive: true if weather conditions would affect the work (e.g. paint, concrete, roofing)
- repair_type: pick the single best category from the enumerated list. Use ""general"" if nothing fits.";

        bool isSpanish = string.Equals(request.Language, "es", StringComparison.OrdinalIgnoreCase);
        string languageInstruction = isSpanish
            ? " IMPORTANT: All text fields in the JSON response (title, steps, tools_and_materials, difficulty, estimated_time, estimated_cost, safety_tips, when_to_call_pro, image_annotations descriptions and overviews) MUST be written in Spanish. URLs, JSON keys, and search query parameters should remain in English."
            : "";

        var messages = new List<ChatMessage>
        {
            new SystemChatMessage("You are a helpful DIY project assistant. Analyze any provided photos carefully. Provide a detailed step-by-step guide with image annotations referencing the user's photos and suggest reference image searches. Return valid JSON only." + languageInstruction)
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
            return ApiError.BadRequest(context, "Please provide a project description or a valid image.");

        messages.Add(new UserChatMessage(userMessageParts));

        var aiCtx = new AiCallContext("analyze", "gpt-4o", request.Description?.Length ?? 0, imageCount, request.Language, correlationId);
        string rawContent = await AiWorkflow.CompleteAsync(client, messages, options, aiCtx, logger);

        var resultDict = AiWorkflow.ParseJsonResponse(rawContent, aiCtx, logger);
        if (resultDict == null)
            return ApiError.Response(context, 502, "AI returned an unparseable response. Please try again.", "ai_parse_error");

        try
        {
            using var doc = JsonDocument.Parse(rawContent.Substring(rawContent.IndexOf('{'), rawContent.LastIndexOf('}') - rawContent.IndexOf('{') + 1));
            var root = doc.RootElement;
            if (root.TryGetProperty("shopping_links", out var shoppingEl))
            {
                var affiliateLinks = new List<object>();

                if (shoppingEl.ValueKind == JsonValueKind.Array)
                {
                    foreach (var item in shoppingEl.EnumerateArray())
                    {
                        // Handle both string items and {item, url} objects from GPT
                        string itemName;
                        if (item.ValueKind == JsonValueKind.String)
                        {
                            itemName = item.GetString() ?? "";
                        }
                        else if (item.TryGetProperty("item", out var itemProp))
                        {
                            itemName = itemProp.GetString() ?? "";
                        }
                        else continue;

                        if (string.IsNullOrWhiteSpace(itemName)) continue;

                        var encoded = Uri.EscapeDataString(itemName);
                        affiliateLinks.Add(new
                        {
                            item = itemName,
                            amazon_url = $"https://www.amazon.com/s?k={encoded}&tag={amazonAssociateTag}",
                            homedepot_url = $"https://www.homedepot.com/s/{encoded}?NCNI-5&irclickid={homeDepotImpactId}"
                        });
                    }
                }

                resultDict!["shopping_links"] = JsonSerializer.SerializeToElement(affiliateLinks);
            }

            // ── YouTube enrichment: replace youtube_queries with real video metadata ──
            try
            {
                var queries = new List<string>();
                if (root.TryGetProperty("youtube_queries", out var qEl) && qEl.ValueKind == JsonValueKind.Array)
                {
                    foreach (var q in qEl.EnumerateArray())
                        if (q.ValueKind == JsonValueKind.String) queries.Add(q.GetString() ?? "");
                }
                else if (root.TryGetProperty("youtube_links", out var oldEl) && oldEl.ValueKind == JsonValueKind.Array)
                {
                    foreach (var u in oldEl.EnumerateArray())
                    {
                        if (u.ValueKind != JsonValueKind.String) continue;
                        var s = u.GetString() ?? "";
                        var markerIdx = s.IndexOf("search_query=", StringComparison.OrdinalIgnoreCase);
                        queries.Add(markerIdx >= 0
                            ? Uri.UnescapeDataString(s.Substring(markerIdx + "search_query=".Length)).Replace('+', ' ')
                            : s);
                    }
                }

                if (youTube.IsConfigured && queries.Count > 0)
                {
                    var videos = new List<object>();
                    foreach (var q in queries.Take(4))
                    {
                        var results = await youTube.SearchAsync(q, limit: 1);
                        foreach (var v in results)
                        {
                            videos.Add(new
                            {
                                videoId = v.VideoId,
                                title = v.Title,
                                channel = v.Channel,
                                thumbnailUrl = v.ThumbnailUrl,
                                publishedAt = v.PublishedAt,
                                url = $"https://www.youtube.com/watch?v={v.VideoId}"
                            });
                        }
                    }
                    if (videos.Count > 0)
                        resultDict!["youtube_links"] = JsonSerializer.SerializeToElement(videos);
                    else
                        resultDict!["youtube_links"] = JsonSerializer.SerializeToElement(
                            queries.Select(q => new { query = q, url = $"https://www.youtube.com/results?search_query={Uri.EscapeDataString(q)}" }));
                }
                else if (queries.Count > 0)
                {
                    resultDict!["youtube_links"] = JsonSerializer.SerializeToElement(
                        queries.Select(q => new { query = q, url = $"https://www.youtube.com/results?search_query={Uri.EscapeDataString(q)}" }));
                }
            }
            catch (Exception ytEx)
            {
                logger.LogWarning(ytEx, "YouTube enrichment failed");
            }

            // ── PubChem enrichment: surface hazard data for recognized hazardous materials ──
            try
            {
                if (root.TryGetProperty("tools_and_materials", out var toolsEl) && toolsEl.ValueKind == JsonValueKind.Array)
                {
                    var pubchemResults = new List<object>();
                    var seen = new HashSet<string>();
                    foreach (var tool in toolsEl.EnumerateArray())
                    {
                        if (tool.ValueKind != JsonValueKind.String) continue;
                        var text = tool.GetString()?.ToLowerInvariant() ?? "";
                        foreach (var chem in hazardousChemicals)
                        {
                            if (!text.Contains(chem) || !seen.Add(chem)) continue;
                            var data = await pubChem.LookupAsync(chem);
                            if (data is null) continue;
                            pubchemResults.Add(new
                            {
                                chemical = data.Chemical,
                                cid = data.Cid,
                                hazards = data.Hazards,
                                pictograms = data.GhsPictograms,
                                firstAid = data.FirstAid,
                                storage = data.Storage,
                            });
                            if (pubchemResults.Count >= 5) break;
                        }
                        if (pubchemResults.Count >= 5) break;
                    }
                    if (pubchemResults.Count > 0)
                        resultDict!["pubchem_safety"] = JsonSerializer.SerializeToElement(pubchemResults);
                }
            }
            catch (Exception pcEx)
            {
                logger.LogWarning(pcEx, "PubChem enrichment failed");
            }

            return Results.Ok(resultDict);
        }
        catch (JsonException)
        {
            // Shopping link / enrichment post-processing failed — return the AI result as-is.
            return Results.Ok(resultDict);
        }
    }
    catch (Exception)
    {
        // Let ExceptionHandlerMiddleware classify and format the response.
        throw;
    }
});

app.MapPost("/api/ask-helper", async ([FromBody] AskHelperRequest request, HttpContext context, ILogger<Program> logger) =>
{
    if (string.IsNullOrEmpty(openAiKey))
        return ApiError.NotConfigured(context, "OpenAI API key");

    var correlationId = context.Items["CorrelationId"] as string;
    OpenAIClientOptions clientOptions = new();
    ChatClient client = new(model: "gpt-4o", new ApiKeyCredential(openAiKey), clientOptions);

    string contextJson = JsonSerializer.Serialize(request.ProjectContext);
    bool askIsSpanish = string.Equals(request.Language, "es", StringComparison.OrdinalIgnoreCase);
    string langClause = askIsSpanish ? " Respond in Spanish." : "";
    string systemPrompt = $"You are a helpful DIY project assistant. The user is currently working on a project with the following details: {contextJson}. Answer the user's question clearly and concisely within the context of this project.{langClause}";

    var messages = new List<ChatMessage>
    {
        new SystemChatMessage(systemPrompt),
        new UserChatMessage(request.Question)
    };

    var aiCtx = new AiCallContext("ask-helper", "gpt-4o", request.Question?.Length ?? 0, 0, request.Language, correlationId);
    string answer = await AiWorkflow.CompleteAsync(client, messages, null, aiCtx, logger);

    return Results.Ok(new { answer });
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

// ── #9 verify-step ─────────────────────────────────────────────────
app.MapPost("/api/verify-step", async ([FromBody] VerifyStepRequest req, HttpContext context, ILogger<Program> logger) =>
{
    if (string.IsNullOrEmpty(openAiKey))
        return ApiError.NotConfigured(context, "OpenAI API key");

    var correlationId = context.Items["CorrelationId"] as string;
    var clientOptions = new OpenAIClientOptions { NetworkTimeout = TimeSpan.FromMinutes(2) };
    ChatClient client = new(model: "gpt-4o", new ApiKeyCredential(openAiKey), clientOptions);

    bool isEs = string.Equals(req.Language, "es", StringComparison.OrdinalIgnoreCase);
    string lang = isEs ? " Respond entirely in Spanish." : "";

    string prompt = $@"You are inspecting a user's photo of completed DIY work to verify quality.
Project: ""{req.ProjectTitle}""
Step they just completed: ""{req.StepText}""

Return JSON only:
{{
  ""rating"": ""good|needs_work|wrong"",
  ""score"": 1-10,
  ""issues"": [""..""],
  ""fixes"": [""..""],
  ""summary"": ""1-2 sentences""
}}{lang}";

    int imgCount = 0;
    var parts = new List<ChatMessageContentPart> { ChatMessageContentPart.CreateTextPart(prompt) };
    if (!string.IsNullOrEmpty(req.Base64Image))
    {
        try
        {
            byte[] data = Convert.FromBase64String(req.Base64Image);
            parts.Add(ChatMessageContentPart.CreateImagePart(BinaryData.FromBytes(data), req.MimeType ?? "image/jpeg"));
            imgCount = 1;
        }
        catch (Exception ex)
        {
            logger.LogWarning(ex, "verify-step: failed to decode image");
        }
    }

    var messages = new List<ChatMessage>
    {
        new SystemChatMessage("You are a DIY project quality inspector. Return valid JSON only."),
        new UserChatMessage(parts),
    };
    var aiCtx = new AiCallContext("verify-step", "gpt-4o", req.StepText?.Length ?? 0, imgCount, req.Language, correlationId);
    string raw = await AiWorkflow.CompleteAsync(client, messages, null, aiCtx, logger);
    int a = raw.IndexOf('{'); int b = raw.LastIndexOf('}');
    if (a >= 0 && b > a) raw = raw.Substring(a, b - a + 1);
    return Results.Content(raw, "application/json");
});

// ── #10 diagnose ───────────────────────────────────────────────────
app.MapPost("/api/diagnose", async ([FromBody] AnalyzeProjectRequest req, HttpContext context, ILogger<Program> logger) =>
{
    if (string.IsNullOrEmpty(openAiKey))
        return ApiError.NotConfigured(context, "OpenAI API key");

    var correlationId = context.Items["CorrelationId"] as string;
    var clientOptions = new OpenAIClientOptions { NetworkTimeout = TimeSpan.FromMinutes(2) };
    ChatClient client = new(model: "gpt-4o", new ApiKeyCredential(openAiKey), clientOptions);

    bool isEs = string.Equals(req.Language, "es", StringComparison.OrdinalIgnoreCase);
    string lang = isEs ? " Respond entirely in Spanish." : "";

    string prompt = $@"You are diagnosing a possible home issue. The user has not yet decided what's wrong — they want a ranked list of likely causes and what to check next.

Description: {req.Description ?? "(none)"}

Return JSON only:
{{
  ""possible_causes"": [
    {{ ""issue"": ""…"", ""likelihood"": ""high|medium|low"", ""why"": ""…"", ""next_check"": ""what the user should look for or test next"" }}
  ],
  ""urgency"": ""low|medium|high|emergency"",
  ""call_pro_immediately"": false,
  ""summary"": ""1-2 sentences""
}}{lang}";

    int imgCount = 0;
    var parts = new List<ChatMessageContentPart> { ChatMessageContentPart.CreateTextPart(prompt) };
    if (req.Media != null)
    {
        foreach (var m in req.Media)
        {
            if (m.Type == "video" || string.IsNullOrEmpty(m.Base64)) continue;
            try
            {
                byte[] data = Convert.FromBase64String(m.Base64);
                parts.Add(ChatMessageContentPart.CreateImagePart(BinaryData.FromBytes(data), m.MimeType ?? "image/jpeg"));
                imgCount++;
            }
            catch { }
        }
    }
    var messages = new List<ChatMessage>
    {
        new SystemChatMessage("You are a home repair diagnostician. Return valid JSON only."),
        new UserChatMessage(parts),
    };
    var aiCtx = new AiCallContext("diagnose", "gpt-4o", req.Description?.Length ?? 0, imgCount, req.Language, correlationId);
    string raw = await AiWorkflow.CompleteAsync(client, messages, null, aiCtx, logger);
    int a = raw.IndexOf('{'); int b = raw.LastIndexOf('}');
    if (a >= 0 && b > a) raw = raw.Substring(a, b - a + 1);
    return Results.Content(raw, "application/json");
});

// ── #11 clarifying questions ───────────────────────────────────────
app.MapPost("/api/clarify", async ([FromBody] AnalyzeProjectRequest req, HttpContext context, ILogger<Program> logger) =>
{
    if (string.IsNullOrEmpty(openAiKey))
        return ApiError.NotConfigured(context, "OpenAI API key");

    var correlationId = context.Items["CorrelationId"] as string;
    ChatClient client = new(model: "gpt-4o", new ApiKeyCredential(openAiKey));

    bool isEs = string.Equals(req.Language, "es", StringComparison.OrdinalIgnoreCase);
    string lang = isEs ? " Respond in Spanish." : "";

    string prompt = $@"Before generating a full DIY guide, you may want to ask 2-3 short clarifying questions. The user described: ""{req.Description ?? ""}"".

Return JSON only:
{{
  ""questions"": [
    {{ ""q"": ""short question"", ""why"": ""why this matters"", ""options"": [""option1"", ""option2""] }}
  ]
}}
If the description is already complete and unambiguous, return {{""questions"": []}}.{lang}";

    int imgCount = 0;
    var parts = new List<ChatMessageContentPart> { ChatMessageContentPart.CreateTextPart(prompt) };
    if (req.Media != null)
    {
        foreach (var m in req.Media)
        {
            if (m.Type == "video" || string.IsNullOrEmpty(m.Base64)) continue;
            try
            {
                byte[] data = Convert.FromBase64String(m.Base64);
                parts.Add(ChatMessageContentPart.CreateImagePart(BinaryData.FromBytes(data), m.MimeType ?? "image/jpeg"));
                imgCount++;
            }
            catch { }
        }
    }
    var messages = new List<ChatMessage>
    {
        new SystemChatMessage("You ask short, useful clarifying questions for DIY projects. Return valid JSON only."),
        new UserChatMessage(parts),
    };
    var aiCtx = new AiCallContext("clarify", "gpt-4o", req.Description?.Length ?? 0, imgCount, req.Language, correlationId);
    string raw = await AiWorkflow.CompleteAsync(client, messages, null, aiCtx, logger);
    int a = raw.IndexOf('{'); int b = raw.LastIndexOf('}');
    if (a >= 0 && b > a) raw = raw.Substring(a, b - a + 1);
    return Results.Content(raw, "application/json");
});

// ── #18 community projects (in-memory; replace with DB if persistent) ──
app.MapPost("/api/community-projects", ([FromBody] CommunityProjectDto dto) =>
{
    var entry = dto with { Id = Guid.NewGuid().ToString(), CreatedAt = DateTime.UtcNow };
    communityProjects.Insert(0, entry);
    return Results.Created($"/api/community-projects/{entry.Id}", entry);
});

app.MapGet("/api/community-projects", ([FromQuery] string? q) =>
{
    var results = communityProjects.AsEnumerable();
    if (!string.IsNullOrWhiteSpace(q))
    {
        var ql = q.ToLowerInvariant();
        results = results.Where(p =>
            (p.Title ?? "").ToLowerInvariant().Contains(ql) ||
            (p.Description ?? "").ToLowerInvariant().Contains(ql));
    }
    return Results.Ok(results.Take(50));
});

// ── Beta feedback ─────────────────────────────────────────────────
app.MapPost("/api/feedback", async ([FromBody] CreateFeedbackDto dto, AppDbContext db) =>
{
    var feedback = new BetaFeedback
    {
        ClientId = dto.Id ?? "",
        Description = dto.Description ?? "",
        WhatYouWereDoing = dto.WhatYouWereDoing,
        ReproSteps = dto.ReproSteps,
        AppVersion = dto.Metadata?.AppVersion,
        BuildNumber = dto.Metadata?.BuildNumber,
        Platform = dto.Metadata?.Platform,
        OsVersion = dto.Metadata?.OsVersion,
        Environment = dto.Metadata?.Environment,
        GitCommit = dto.Metadata?.GitCommit,
        CurrentScreen = dto.Metadata?.CurrentScreen,
        CorrelationId = dto.Metadata?.LastCorrelationId,
        CreatedAt = DateTime.UtcNow,
    };
    db.BetaFeedback.Add(feedback);
    await db.SaveChangesAsync();
    return Results.Created($"/api/feedback/{feedback.Id}", new { id = feedback.Id });
});

app.MapGet("/api/feedback", async (AppDbContext db) =>
{
    var results = await db.BetaFeedback
        .OrderByDescending(f => f.CreatedAt)
        .Take(100)
        .Select(f => new
        {
            f.Id, f.ClientId, f.Description, f.WhatYouWereDoing, f.ReproSteps,
            f.AppVersion, f.Platform, f.OsVersion, f.CurrentScreen,
            f.Environment, f.GitCommit, f.CorrelationId, f.CreatedAt,
        })
        .ToListAsync();
    return Results.Ok(results);
});

// ── #16 emergency directory (static for now) ───────────────────────
app.MapGet("/api/emergency", () =>
{
    return Results.Ok(new
    {
        categories = new[]
        {
            new { id = "water", label = "Active leak / burst pipe", instructions = new[] { "Shut off your home's main water valve.", "Open a faucet to release pressure.", "Move valuables away from the leak." }, callType = "plumber" },
            new { id = "electric", label = "Sparking outlet / shock", instructions = new[] { "Do NOT touch the affected outlet.", "Trip the breaker for that circuit at your panel.", "Unplug nearby devices once safe." }, callType = "electrician" },
            new { id = "gas", label = "Gas smell", instructions = new[] { "Leave the building immediately.", "Do not flip light switches or use phones inside.", "Call your gas utility and 911 from outside." }, callType = "gas-utility" },
            new { id = "fire", label = "Active fire", instructions = new[] { "Get out, stay out, call 911." }, callType = "911" },
        }
    });
});

// ══════════════════════════════════════════════════════════════════════════
// External-API integration endpoints
// ══════════════════════════════════════════════════════════════════════════

// ── Feature flags (frontend polls this on boot) ────────────────────
app.MapGet("/api/features", (FeatureFlags flags) => Results.Ok(flags.ToPublicJson()));

// ── Weather forecast for an outdoor project ────────────────────────
app.MapGet("/api/weather", async ([FromQuery] string zip, [FromQuery] int? days, WeatherClient weather) =>
{
    if (string.IsNullOrWhiteSpace(zip))
        return Results.Json(new { error = "zip query parameter is required." }, statusCode: 400);
    if (!weather.IsConfigured)
        return Results.Json(new { error = "Weather service not configured.", configured = false }, statusCode: 503);
    var forecast = await weather.GetForecastAsync(zip, days ?? 5);
    if (forecast is null)
        return Results.Json(new { error = "Weather lookup failed." }, statusCode: 502);
    return Results.Ok(forecast);
});

// ── Reddit community discussions ───────────────────────────────────
app.MapGet("/api/reddit-discussions", async ([FromQuery] string query, RedditClient reddit) =>
{
    if (string.IsNullOrWhiteSpace(query))
        return Results.Json(new { error = "query parameter is required." }, statusCode: 400);
    var threads = await reddit.SearchAsync(query);
    return Results.Ok(new { threads });
});

// ── PubChem safety data for a single chemical ──────────────────────
app.MapGet("/api/safety-data", async ([FromQuery] string chemical, PubChemClient pubChem) =>
{
    if (string.IsNullOrWhiteSpace(chemical))
        return Results.Json(new { error = "chemical parameter is required." }, statusCode: 400);
    var data = await pubChem.LookupAsync(chemical);
    if (data is null)
        return Results.Json(new { error = "Chemical not found or PubChem unavailable." }, statusCode: 404);
    return Results.Ok(new
    {
        chemical = data.Chemical,
        cid = data.Cid,
        hazards = data.Hazards,
        pictograms = data.GhsPictograms,
        firstAid = data.FirstAid,
        storage = data.Storage,
    });
});

// ── Property-value impact (ATTOM or static fallback) ───────────────
app.MapGet("/api/property-value-impact", async (
    [FromQuery] string? zip,
    [FromQuery] string repairType,
    [FromQuery] double estimatedCost,
    AttomClient attom,
    FeatureFlags features) =>
{
    if (string.IsNullOrWhiteSpace(repairType))
        return Results.Json(new { error = "repairType parameter is required." }, statusCode: 400);
    var impact = await attom.EstimateAsync(zip ?? "", repairType, estimatedCost);
    if (impact is null)
        return Results.Json(new { error = "Property value lookup failed." }, statusCode: 502);
    return Results.Ok(new
    {
        estimatedValueAdd = impact.EstimatedValueAdd,
        confidence = impact.Confidence,
        source = impact.Source,
        attomEnabled = features.Attom,
    });
});

// ── Receipt OCR (Mindee) ───────────────────────────────────────────
app.MapPost("/api/receipt-ocr", async ([FromBody] ReceiptOcrRequest req, ReceiptOcrClient ocr) =>
{
    if (!ocr.IsConfigured)
        return Results.Json(new { error = "Receipt OCR not configured." }, statusCode: 503);
    if (string.IsNullOrWhiteSpace(req.Base64Image))
        return Results.Json(new { error = "base64Image is required." }, statusCode: 400);
    byte[] data;
    try { data = Convert.FromBase64String(req.Base64Image); }
    catch { return Results.Json(new { error = "base64Image is not valid base64." }, statusCode: 400); }

    var parsed = await ocr.ParseAsync(data, req.MimeType ?? "image/jpeg");
    if (parsed is null)
        return Results.Json(new { error = "Receipt OCR failed." }, statusCode: 502);
    return Results.Ok(new
    {
        merchant = parsed.Merchant,
        date = parsed.Date,
        total = parsed.Total,
        lineItems = parsed.LineItems,
    });
});

// ── Paint color match ──────────────────────────────────────────────
app.MapPost("/api/paint-color-match", ([FromBody] PaintColorRequest req, PaintColorClient paint, FeatureFlags features) =>
{
    if (string.IsNullOrWhiteSpace(req.Base64Image))
        return Results.Json(new { error = "base64Image is required." }, statusCode: 400);
    byte[] data;
    try { data = Convert.FromBase64String(req.Base64Image); }
    catch { return Results.Json(new { error = "base64Image is not valid base64." }, statusCode: 400); }

    var result = paint.Match(data);
    return Results.Ok(new
    {
        dominantHex = result.DominantHex,
        matches = result.Matches,
        source = features.PaintColors ? "brand-api" : "bundled-palette",
    });
});

app.Run();

public record VerifyStepRequest(
    [property: JsonPropertyName("stepText")] string StepText,
    [property: JsonPropertyName("projectTitle")] string ProjectTitle,
    [property: JsonPropertyName("base64Image")] string? Base64Image,
    [property: JsonPropertyName("mimeType")] string? MimeType,
    [property: JsonPropertyName("language")] string? Language
);

public record CommunityProjectDto
{
    [JsonPropertyName("id")] public string? Id { get; init; }
    [JsonPropertyName("title")] public string? Title { get; init; }
    [JsonPropertyName("description")] public string? Description { get; init; }
    [JsonPropertyName("difficulty")] public string? Difficulty { get; init; }
    [JsonPropertyName("estimated_time")] public string? EstimatedTime { get; init; }
    [JsonPropertyName("estimated_cost")] public string? EstimatedCost { get; init; }
    [JsonPropertyName("steps")] public object? Steps { get; init; }
    [JsonPropertyName("tools_and_materials")] public object? ToolsAndMaterials { get; init; }
    [JsonPropertyName("photoUri")] public string? PhotoUri { get; init; }
    [JsonPropertyName("createdAt")] public DateTime CreatedAt { get; init; }
}

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
    [property: JsonPropertyName("projectContext")] object ProjectContext,
    [property: JsonPropertyName("language")] string? Language
);

public record AnalyzeProjectRequest(
    [property: JsonPropertyName("description")] string? Description,
    [property: JsonPropertyName("media")] MediaItem[]? Media,
    [property: JsonPropertyName("language")] string? Language,
    [property: JsonPropertyName("skillLevel")] string? SkillLevel,
    [property: JsonPropertyName("zip")] string? Zip,
    [property: JsonPropertyName("ownedTools")] string[]? OwnedTools
);

public record MediaItem(
    [property: JsonPropertyName("uri")] string? Url,
    [property: JsonPropertyName("base64")] string? Base64,
    [property: JsonPropertyName("mimeType")] string? MimeType,
    [property: JsonPropertyName("type")] string? Type
);

public record ReceiptOcrRequest(
    [property: JsonPropertyName("base64Image")] string? Base64Image,
    [property: JsonPropertyName("mimeType")] string? MimeType,
    [property: JsonPropertyName("projectId")] string? ProjectId
);

public record PaintColorRequest(
    [property: JsonPropertyName("base64Image")] string? Base64Image,
    [property: JsonPropertyName("mimeType")] string? MimeType
);

public record CreateFeedbackDto(
    [property: JsonPropertyName("id")] string? Id,
    [property: JsonPropertyName("description")] string? Description,
    [property: JsonPropertyName("whatYouWereDoing")] string? WhatYouWereDoing,
    [property: JsonPropertyName("reproSteps")] string? ReproSteps,
    [property: JsonPropertyName("metadata")] FeedbackMetadataDto? Metadata
);

public record FeedbackMetadataDto(
    [property: JsonPropertyName("appVersion")] string? AppVersion,
    [property: JsonPropertyName("buildNumber")] string? BuildNumber,
    [property: JsonPropertyName("platform")] string? Platform,
    [property: JsonPropertyName("osVersion")] string? OsVersion,
    [property: JsonPropertyName("environment")] string? Environment,
    [property: JsonPropertyName("release")] string? Release,
    [property: JsonPropertyName("gitCommit")] string? GitCommit,
    [property: JsonPropertyName("currentScreen")] string? CurrentScreen,
    [property: JsonPropertyName("lastCorrelationId")] string? LastCorrelationId
);
