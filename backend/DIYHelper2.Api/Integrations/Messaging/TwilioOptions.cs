namespace DIYHelper2.Api.Integrations.Messaging;

/// <summary>
/// App-level Twilio credentials from env: <c>TWILIO_ACCOUNT_SID</c>,
/// <c>TWILIO_AUTH_TOKEN</c>, <c>TWILIO_FROM_NUMBER</c> (the default sending
/// number in E.164, e.g. +15551234567). A brand can override the From number via
/// <c>Brand.SmsFromNumber</c>. Empty until configured → the sender no-ops.
/// </summary>
public class TwilioOptions
{
    public string? AccountSid { get; init; }
    public string? AuthToken { get; init; }
    public string? FromNumber { get; init; }

    public bool IsConfigured =>
        !string.IsNullOrWhiteSpace(AccountSid) && !string.IsNullOrWhiteSpace(AuthToken);
}
