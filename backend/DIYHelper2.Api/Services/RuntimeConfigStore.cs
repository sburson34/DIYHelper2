namespace DIYHelper2.Api.Services;

/// <summary>
/// Mutable singleton for config values that are resolved AFTER the host is
/// built (the AWS Secrets Manager bundle is fetched in Program.cs post-build,
/// same pattern as <see cref="DIYHelper2.Api.AI.AiKeyStore"/>). Handlers inject
/// this instead of closing over Program.cs locals, which keeps them movable
/// into Endpoints/*.cs files.
/// </summary>
public class RuntimeConfigStore
{
    /// <summary>Google Cloud API key (Translate v2 today; Geocoding later).
    /// Null/empty → those integrations respond "not configured".</summary>
    public string? GoogleApiKey { get; set; }

    /// <summary>Amazon Associates tag appended to shopping links. Empty →
    /// plain search URL (still valid, just unattributed).</summary>
    public string AmazonAssociateTag { get; set; } = "";

    /// <summary>Home Depot Impact click id appended to shopping links.
    /// Empty → plain search URL.</summary>
    public string HomeDepotImpactId { get; set; } = "";
}
