using Sburson.Shared.Email;

namespace DIYHelper2.Tests.Infrastructure;

/// <summary>
/// Test double for <see cref="IEmailService"/> that records every message
/// instead of hitting SES. Set <see cref="OnSend"/> to simulate a mail-service
/// outage (e.g. asserting a lead still returns 201 when email throws).
/// </summary>
public class FakeEmailService : IEmailService
{
    public record Sent(string To, string Subject, string TextBody, string? HtmlBody);

    public List<Sent> SentMessages { get; } = new();

    /// <summary>When set, invoked before recording — throw here to simulate a
    /// send failure.</summary>
    public Func<Task>? OnSend { get; set; }

    public async Task SendAsync(
        string toAddress,
        string subject,
        string textBody,
        string? htmlBody = null,
        CancellationToken ct = default)
    {
        if (OnSend is not null) await OnSend();
        SentMessages.Add(new Sent(toAddress, subject, textBody, htmlBody));
    }
}
