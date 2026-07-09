namespace DIYHelper2.Api.Integrations.Messaging;

// SMS integration seam. Same shape as the CRM/billing seams: a provider-agnostic
// sender the app depends on, with a Twilio implementation behind it. Fail-soft —
// an SMS outage never breaks booking, scheduling, or completing a job. Nothing
// sends until Twilio credentials are configured (IsConfigured = false → no-op).

public record SmsResult(bool Ok, string? RemoteId, string? Error)
{
    public static SmsResult Success(string? remoteId) => new(true, remoteId, null);
    public static SmsResult Unavailable(string reason) => new(false, null, reason);
}

public interface ISmsSender
{
    /// <summary>True once provider credentials are present. Callers check this to
    /// decide whether to offer texting at all.</summary>
    bool IsConfigured { get; }

    /// <summary>Send one SMS. <paramref name="fromOverride"/> lets a brand use its
    /// own number; null falls back to the app-level default. Never throws.</summary>
    Task<SmsResult> SendAsync(string toPhone, string body, string? fromOverride = null, CancellationToken ct = default);
}
