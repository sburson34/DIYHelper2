namespace DIYHelper2.Api.Integrations.Billing;

// Billing integration seam. Mirrors the CRM seam (Integrations/Crm): a small set
// of provider-agnostic contracts the app depends on, with concrete providers
// (Stripe for payments, QuickBooks for invoicing) plugged in behind them. Every
// implementation MUST be fail-soft — a billing outage can never break booking or
// break the customer's app. Nothing charges or syncs until per-brand credentials
// are configured (see BillingOptions); until then IsConfigured is false and calls
// return an "unavailable" result the caller surfaces gracefully.

/// <summary>Ask the payment provider to start a hosted checkout for a membership
/// / maintenance plan. The provider owns the payment UI (e.g. Stripe Checkout);
/// we only hand back a URL for the app to open.</summary>
public record MembershipCheckoutRequest(
    string Brand,
    string PlanId,
    string CustomerEmail,
    string? CustomerName,
    string SuccessUrl,
    string CancelUrl);

/// <summary>Result of starting a checkout. <see cref="CheckoutUrl"/> is set only
/// when <see cref="Ok"/>; otherwise <see cref="Error"/> explains why (unconfigured,
/// provider error) so the endpoint can 200-with-unavailable rather than throw.</summary>
public record CheckoutResult(bool Ok, string? CheckoutUrl, string? Error)
{
    public static CheckoutResult Success(string url) => new(true, url, null);
    public static CheckoutResult Unavailable(string reason) => new(false, null, reason);
}

/// <summary>One line on an invoice pushed to the accounting provider.</summary>
public record InvoiceLine(string Description, decimal Amount, int Quantity = 1);

/// <summary>Request to create/sync an invoice for a completed job into the
/// brand's accounting system (e.g. QuickBooks Online).</summary>
public record InvoiceRequest(
    string Brand,
    string CustomerEmail,
    string? CustomerName,
    IReadOnlyList<InvoiceLine> Lines,
    string? Memo);

public record InvoiceResult(bool Ok, string? RemoteInvoiceId, string? Error)
{
    public static InvoiceResult Success(string remoteId) => new(true, remoteId, null);
    public static InvoiceResult Unavailable(string reason) => new(false, null, reason);
}

/// <summary>Payment provider (Stripe). Charges customers for memberships.</summary>
public interface IPaymentProvider
{
    /// <summary>True once credentials are present. Endpoints check this to decide
    /// whether to offer the paid flow at all.</summary>
    bool IsConfigured { get; }

    Task<CheckoutResult> CreateMembershipCheckoutAsync(
        MembershipCheckoutRequest request, CancellationToken ct = default);
}

/// <summary>Accounting provider (QuickBooks). Syncs invoices for completed jobs.</summary>
public interface IInvoiceProvider
{
    bool IsConfigured { get; }

    Task<InvoiceResult> CreateInvoiceAsync(
        InvoiceRequest request, CancellationToken ct = default);
}
