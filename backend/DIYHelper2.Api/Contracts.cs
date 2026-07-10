// Request/response contracts (DTOs) for the API endpoints. These stay in the
// global namespace on purpose: DIYHelper2.Tests references several of them
// directly, and the endpoint handlers bind them by simple name.
using System.Text.Json.Serialization;

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
    [property: JsonPropertyName("imageBase64")] string? ImageBase64,
    // Booking details (optional — a plain "call a pro" lead omits them).
    [property: JsonPropertyName("serviceType")] string? ServiceType = null,
    [property: JsonPropertyName("preferredDate")] DateTime? PreferredDate = null,
    [property: JsonPropertyName("preferredWindow")] string? PreferredWindow = null,
    // Service address — the app sends ONE line (≤200 chars); City/State/Zip
    // stay null until the console edits them. Geocoded best-effort after save.
    [property: JsonPropertyName("address")] string? Address = null
);

public record UpdateHelpRequestDto(
    [property: JsonPropertyName("status")] string? Status,
    [property: JsonPropertyName("notes")] string? Notes,
    [property: JsonPropertyName("followUpDate")] DateTime? FollowUpDate,
    // Scheduling fields set by the operator to drive the customer's "My Jobs"
    // tracker. TechEtaMinutes uses a sentinel of -1 to explicitly clear.
    [property: JsonPropertyName("scheduledFor")] DateTime? ScheduledFor = null,
    [property: JsonPropertyName("techEtaMinutes")] int? TechEtaMinutes = null,
    // Assignment. -1 explicitly unassigns; any other value assigns that tech.
    [property: JsonPropertyName("assignedTechId")] int? AssignedTechId = null,
    // Job costing (owner-entered). Any value >= 0 sets it.
    [property: JsonPropertyName("laborCost")] decimal? LaborCost = null,
    [property: JsonPropertyName("partsCost")] decimal? PartsCost = null,
    // Recurring maintenance: schedule a reminder this many months after completion.
    [property: JsonPropertyName("maintenanceIntervalMonths")] int? MaintenanceIntervalMonths = null,
    // Service address (console-editable). Manual lat/lng are allowed; when the
    // address changes and no manual coords accompany it, the row is re-geocoded
    // best-effort after save.
    [property: JsonPropertyName("address")] string? Address = null,
    [property: JsonPropertyName("city")] string? City = null,
    [property: JsonPropertyName("state")] string? State = null,
    [property: JsonPropertyName("zip")] string? Zip = null,
    [property: JsonPropertyName("lat")] double? Lat = null,
    [property: JsonPropertyName("lng")] double? Lng = null
);

public record CreateTechnicianDto(
    [property: JsonPropertyName("name")] string Name,
    [property: JsonPropertyName("phone")] string? Phone,
    [property: JsonPropertyName("email")] string? Email,
    [property: JsonPropertyName("brand")] string? Brand
);

public record UpdateTechnicianDto(
    [property: JsonPropertyName("name")] string? Name,
    [property: JsonPropertyName("phone")] string? Phone,
    [property: JsonPropertyName("email")] string? Email,
    [property: JsonPropertyName("isActive")] bool? IsActive
);

public record TechLoginDto(
    [property: JsonPropertyName("code")] string? Code
);

public record TechJobUpdateDto(
    [property: JsonPropertyName("status")] string? Status,
    [property: JsonPropertyName("techEtaMinutes")] int? TechEtaMinutes,
    [property: JsonPropertyName("completionNotes")] string? CompletionNotes,
    [property: JsonPropertyName("beforePhotoBase64")] string? BeforePhotoBase64,
    [property: JsonPropertyName("afterPhotoBase64")] string? AfterPhotoBase64,
    [property: JsonPropertyName("signatureBase64")] string? SignatureBase64
);

// Console login (POST /admin/session). Same two credential tiers as Basic auth:
// super-admin config creds or a brand's dashboard login.
public record AdminLoginDto(
    [property: JsonPropertyName("username")] string? Username,
    [property: JsonPropertyName("password")] string? Password
);

public record PriceBookItemDto(
    [property: JsonPropertyName("name")] string? Name,
    [property: JsonPropertyName("defaultPrice")] decimal? DefaultPrice,
    [property: JsonPropertyName("isActive")] bool? IsActive,
    [property: JsonPropertyName("brand")] string? Brand
);

public record QuoteLineDto(
    [property: JsonPropertyName("description")] string? Description,
    [property: JsonPropertyName("amount")] decimal? Amount,
    [property: JsonPropertyName("quantity")] int? Quantity
);

public record SendQuoteDto(
    [property: JsonPropertyName("lines")] List<QuoteLineDto>? Lines
);

public record QuoteDecisionDto(
    [property: JsonPropertyName("decision")] string? Decision
);

public record SendMessageDto(
    [property: JsonPropertyName("body")] string? Body
);

public record PaymentLinkDto(
    [property: JsonPropertyName("amount")] decimal? Amount,
    [property: JsonPropertyName("sendSms")] bool? SendSms
);

public record ReviewResponseDto(
    [property: JsonPropertyName("review")] string? Review,
    [property: JsonPropertyName("rating")] int? Rating,
    [property: JsonPropertyName("company")] string? Company
);

public record InventoryItemDto(
    [property: JsonPropertyName("name")] string? Name,
    [property: JsonPropertyName("sku")] string? Sku,
    [property: JsonPropertyName("quantity")] int? Quantity,
    [property: JsonPropertyName("reorderAt")] int? ReorderAt,
    [property: JsonPropertyName("brand")] string? Brand
);

public record MembershipCheckoutDto(
    [property: JsonPropertyName("planId")] string? PlanId,
    [property: JsonPropertyName("customerEmail")] string? CustomerEmail,
    [property: JsonPropertyName("customerName")] string? CustomerName,
    [property: JsonPropertyName("successUrl")] string? SuccessUrl,
    [property: JsonPropertyName("cancelUrl")] string? CancelUrl
);

public record RegisterPushDto(
    [property: JsonPropertyName("token")] string? Token,
    [property: JsonPropertyName("platform")] string? Platform,
    [property: JsonPropertyName("marketingOptIn")] bool MarketingOptIn
);

public record UnregisterPushDto(
    [property: JsonPropertyName("token")] string? Token
);

public record SendPushDto(
    [property: JsonPropertyName("brand")] string? Brand,
    [property: JsonPropertyName("title")] string? Title,
    [property: JsonPropertyName("body")] string? Body,
    [property: JsonPropertyName("subtitle")] string? Subtitle,
    [property: JsonPropertyName("imageUrl")] string? ImageUrl,
    [property: JsonPropertyName("data")] System.Text.Json.JsonElement? Data,
    [property: JsonPropertyName("platform")] string? Platform,
    [property: JsonPropertyName("scheduledFor")] DateTime? ScheduledFor
);

public record TestPushDto(
    [property: JsonPropertyName("token")] string? Token,
    [property: JsonPropertyName("title")] string? Title,
    [property: JsonPropertyName("body")] string? Body,
    [property: JsonPropertyName("subtitle")] string? Subtitle,
    [property: JsonPropertyName("imageUrl")] string? ImageUrl,
    [property: JsonPropertyName("data")] System.Text.Json.JsonElement? Data
);

public record DeleteUserDataDto(
    [property: JsonPropertyName("name")] string? Name,
    [property: JsonPropertyName("email")] string? Email,
    [property: JsonPropertyName("phone")] string? Phone
);

public record ConfirmDeletionDto(
    [property: JsonPropertyName("requestId")] string? RequestId,
    [property: JsonPropertyName("code")] string? Code
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
    [property: JsonPropertyName("ownedTools")] string[]? OwnedTools,
    [property: JsonPropertyName("extractedEntities")] ExtractedEntity[]? ExtractedEntities
);

public record ExtractedEntity(
    [property: JsonPropertyName("type")] string? Type,
    [property: JsonPropertyName("text")] string? Text
);

public record MediaItem(
    [property: JsonPropertyName("uri")] string? Url,
    [property: JsonPropertyName("base64")] string? Base64,
    [property: JsonPropertyName("mimeType")] string? MimeType,
    [property: JsonPropertyName("type")] string? Type,
    [property: JsonPropertyName("labels")] string[]? Labels
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

public record TranslateRequest(
    [property: JsonPropertyName("q")] string[]? Q,
    [property: JsonPropertyName("target")] string? Target,
    [property: JsonPropertyName("source")] string? Source
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

public record LiveDiyAnalyzeRequest(
    [property: JsonPropertyName("taskDescription")] string? TaskDescription,
    [property: JsonPropertyName("currentStep")] int? CurrentStep,
    [property: JsonPropertyName("userQuestion")] string? UserQuestion,
    [property: JsonPropertyName("imageBase64")] string? ImageBase64,
    [property: JsonPropertyName("mimeType")] string? MimeType,
    [property: JsonPropertyName("sessionId")] string? SessionId
);
