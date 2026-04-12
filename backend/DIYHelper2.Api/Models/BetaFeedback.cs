namespace DIYHelper2.Api.Models;

public class BetaFeedback
{
    public int Id { get; set; }
    public string ClientId { get; set; } = string.Empty;
    public string Description { get; set; } = string.Empty;
    public string? WhatYouWereDoing { get; set; }
    public string? ReproSteps { get; set; }
    public string? AppVersion { get; set; }
    public string? BuildNumber { get; set; }
    public string? Platform { get; set; }
    public string? OsVersion { get; set; }
    public string? Environment { get; set; }
    public string? GitCommit { get; set; }
    public string? CurrentScreen { get; set; }
    public string? CorrelationId { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}
