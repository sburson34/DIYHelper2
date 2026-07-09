namespace DIYHelper2.Api.Integrations.Crm;

/// <summary>
/// Jobber OAuth app credentials — OURS, not per-brand (one developer app serves
/// every brand; each brand grants it access via the OAuth consent flow). Sourced
/// from env in Program.cs: <c>JOBBER_CLIENT_ID</c>, <c>JOBBER_CLIENT_SECRET</c>,
/// <c>JOBBER_REDIRECT_URI</c>. When unset the connect endpoint returns 503 and
/// the sink is effectively dormant.
/// </summary>
public sealed class JobberOptions
{
    public string? ClientId { get; init; }
    public string? ClientSecret { get; init; }

    /// <summary>Absolute URL of our callback, e.g.
    /// <c>https://api.diyhelper.org/api/crm/jobber/callback</c>. Must exactly
    /// match the redirect URI registered in the Jobber Developer Center.</summary>
    public string? RedirectUri { get; init; }

    public bool IsConfigured =>
        !string.IsNullOrWhiteSpace(ClientId)
        && !string.IsNullOrWhiteSpace(ClientSecret)
        && !string.IsNullOrWhiteSpace(RedirectUri);
}
