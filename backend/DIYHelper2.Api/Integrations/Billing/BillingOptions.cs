namespace DIYHelper2.Api.Integrations.Billing;

/// <summary>
/// App-level Stripe credentials, read from env at startup (empty in dev/until a
/// key is added). When <see cref="IsConfigured"/> is false the payment provider
/// short-circuits to an "unavailable" result and nothing is charged.
///
/// <para>Env vars: <c>STRIPE_SECRET_KEY</c>, <c>STRIPE_MEMBERSHIP_PRICE_ID</c>
/// (the recurring Price the membership checkout subscribes the customer to).
/// Secrets Manager takes precedence over env if a value is present there.</para>
/// </summary>
public class StripeOptions
{
    public string? SecretKey { get; init; }
    public string? MembershipPriceId { get; init; }

    public bool IsConfigured =>
        !string.IsNullOrWhiteSpace(SecretKey) && !string.IsNullOrWhiteSpace(MembershipPriceId);
}

/// <summary>
/// App-level QuickBooks Online credentials. Like Jobber, QBO uses OAuth 2.0 with
/// per-company (per-brand) tokens, so full wiring needs the same connect/callback
/// dance stored on a per-brand connection row — deferred until a brand asks for
/// invoice sync. Env vars: <c>QBO_CLIENT_ID</c>, <c>QBO_CLIENT_SECRET</c>,
/// <c>QBO_REDIRECT_URI</c>, <c>QBO_ENVIRONMENT</c> (sandbox|production).
/// </summary>
public class QuickBooksOptions
{
    public string? ClientId { get; init; }
    public string? ClientSecret { get; init; }
    public string? RedirectUri { get; init; }
    public string Environment { get; init; } = "sandbox";

    /// <summary>QBO Item id every invoice line references (QBO requires an
    /// existing Item). Defaults to "1", the id of the "Services" item seeded in a
    /// fresh QBO/sandbox company; override with <c>QBO_ITEM_ID</c> if different.</summary>
    public string ItemId { get; init; } = "1";

    /// <summary>API base for the configured environment.</summary>
    public string ApiBase =>
        string.Equals(Environment, "production", StringComparison.OrdinalIgnoreCase)
            ? "https://quickbooks.api.intuit.com"
            : "https://sandbox-quickbooks.api.intuit.com";

    public bool IsConfigured =>
        !string.IsNullOrWhiteSpace(ClientId) && !string.IsNullOrWhiteSpace(ClientSecret);
}
