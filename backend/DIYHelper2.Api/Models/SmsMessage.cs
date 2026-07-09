namespace DIYHelper2.Api.Models;

/// <summary>
/// A record of one SMS to/from a customer — the console's conversation log. Both
/// outbound automations (on-the-way, reminders, review requests, manual texts)
/// and inbound replies (the Twilio webhook) write rows here. Brand-scoped, and
/// linked to a <see cref="HelpRequest"/> when we can match the phone number.
/// </summary>
public class SmsMessage
{
    public int Id { get; set; }
    public string Brand { get; set; } = "diyhelper";

    /// <summary>The lead/job this message relates to, if matched by phone. Null
    /// for an inbound text we couldn't tie to a known lead.</summary>
    public int? HelpRequestId { get; set; }

    /// <summary>"out" (we sent it) or "in" (customer replied).</summary>
    public string Direction { get; set; } = "out";

    public string? FromNumber { get; set; }
    public string? ToNumber { get; set; }
    public string Body { get; set; } = string.Empty;

    /// <summary>Provider message id (Twilio SID) for an outbound send, when known.</summary>
    public string? RemoteId { get; set; }

    /// <summary>For outbound: whether the provider accepted it. Inbound is always true.</summary>
    public bool Sent { get; set; }

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}
