namespace DIYHelper2.Api.Integrations;

public record AmazonProduct(
    string Asin,
    string Title,
    string? Price,
    string? ImageUrl,
    bool PrimeEligible,
    string AffiliateUrl
);

/// <summary>
/// Scaffold for Amazon Product Advertising API. The real PA-API uses AWS SigV4 signing and
/// requires partner-account approval (3 qualifying sales in 180 days). We expose the same
/// interface so the rest of the code can depend on it; when FEATURES_AMAZON_PA=true and the
/// credentials are set, swap in the real HTTP call — everything else stays the same.
/// </summary>
public class AmazonPaClient
{
    private readonly ILogger<AmazonPaClient> _logger;
    private readonly string? _accessKey;
    private readonly string? _secretKey;
    private readonly string _partnerTag;

    public AmazonPaClient(ILogger<AmazonPaClient> logger)
    {
        _logger = logger;
        _accessKey = Environment.GetEnvironmentVariable("AMAZON_PA_ACCESS_KEY");
        _secretKey = Environment.GetEnvironmentVariable("AMAZON_PA_SECRET_KEY");
        _partnerTag = Environment.GetEnvironmentVariable("AMAZON_PARTNER_TAG") ?? "diyhelper20-20";
    }

    public bool IsConfigured => !string.IsNullOrEmpty(_accessKey) && !string.IsNullOrEmpty(_secretKey);

    public Task<AmazonProduct?> SearchFirstAsync(string keyword, CancellationToken ct = default)
    {
        if (!IsConfigured || string.IsNullOrWhiteSpace(keyword))
            return Task.FromResult<AmazonProduct?>(null);

        // TODO: real SigV4-signed POST to https://webservices.amazon.com/paapi5/searchitems
        // once credentials are approved. For now we return null so the caller falls back to
        // the existing search-URL template. This keeps the feature-flag gate honest.
        _logger.LogDebug("AmazonPaClient.SearchFirstAsync called with credentials but real PA-API not yet wired.");
        return Task.FromResult<AmazonProduct?>(null);
    }
}
