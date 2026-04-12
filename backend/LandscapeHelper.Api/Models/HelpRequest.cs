namespace DIYHelper2.Api.Models;

public class HelpRequest
{
    public int Id { get; set; }
    public string CustomerName { get; set; } = string.Empty;
    public string CustomerEmail { get; set; } = string.Empty;
    public string CustomerPhone { get; set; } = string.Empty;
    public string ProjectTitle { get; set; } = string.Empty;
    public string UserDescription { get; set; } = string.Empty;
    public string ProjectData { get; set; } = string.Empty;
    public string? ImageBase64 { get; set; }
    public string Status { get; set; } = "new";
    public string? Notes { get; set; }
    public DateTime? FollowUpDate { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}
