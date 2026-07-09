namespace DIYHelper2.Api.Integrations.Crm;

/// <summary>
/// Housecall Pro OAuth app credentials — OURS, not per-brand (one partner app
/// serves every brand; each brand grants it access via the OAuth consent flow).
/// Sourced from env in Program.cs: <c>HOUSECALL_CLIENT_ID</c>,
/// <c>HOUSECALL_CLIENT_SECRET</c>, <c>HOUSECALL_REDIRECT_URI</c>.
///
/// <para>OAuth is available only to verified Housecall Pro integration partners
/// (email apideveloper@housecallpro.com to register the app + redirect URI). When
/// unset the connect endpoint returns 503 and the sink is dormant.</para>
/// </summary>
public sealed class HousecallOptions
{
    public string? ClientId { get; init; }
    public string? ClientSecret { get; init; }

    /// <summary>Absolute callback URL, must exactly match the one registered with
    /// Housecall, e.g. <c>https://api.diyhelper.org/api/crm/housecall/callback</c>.</summary>
    public string? RedirectUri { get; init; }

    /// <summary>OAuth scope. "public" is the documented scope for the public API.</summary>
    public string Scope { get; init; } = "public";

    public bool IsConfigured =>
        !string.IsNullOrWhiteSpace(ClientId)
        && !string.IsNullOrWhiteSpace(ClientSecret)
        && !string.IsNullOrWhiteSpace(RedirectUri);
}
