using System.Net.Http.Headers;

namespace DIYHelper2.Api.Integrations.Billing;

/// <summary>
/// Stripe implementation of <see cref="IPaymentProvider"/>. Talks to the Stripe
/// REST API directly (form-encoded, no SDK dependency) so it works the moment a
/// <c>STRIPE_SECRET_KEY</c> + membership Price id are configured — no code change.
/// Creates a hosted Checkout Session in subscription mode and returns its URL.
///
/// <para>Fail-soft by contract: any error (unconfigured, network, Stripe 4xx) is
/// caught and returned as an unavailable <see cref="CheckoutResult"/>; this never
/// throws into the request pipeline. The typed HttpClient is SSRF-guarded like
/// every other external client (api.stripe.com is public, so the guard passes).</para>
/// </summary>
public class StripePaymentProvider : IPaymentProvider
{
    private const string ApiBase = "https://api.stripe.com/v1";

    private readonly HttpClient _http;
    private readonly StripeOptions _options;
    private readonly ILogger<StripePaymentProvider> _logger;

    public StripePaymentProvider(
        HttpClient http, StripeOptions options, ILogger<StripePaymentProvider> logger)
    {
        _http = http;
        _options = options;
        _logger = logger;
    }

    public bool IsConfigured => _options.IsConfigured;

    public async Task<CheckoutResult> CreateMembershipCheckoutAsync(
        MembershipCheckoutRequest request, CancellationToken ct = default)
    {
        if (!IsConfigured)
            return CheckoutResult.Unavailable("Stripe is not configured for this deployment.");

        try
        {
            // Subscription-mode Checkout Session. The Price id identifies the
            // recurring membership plan; Stripe hosts the payment page and
            // redirects back to success/cancel URLs the app supplies.
            var form = new List<KeyValuePair<string, string>>
            {
                new("mode", "subscription"),
                new("line_items[0][price]", _options.MembershipPriceId!),
                new("line_items[0][quantity]", "1"),
                new("success_url", request.SuccessUrl),
                new("cancel_url", request.CancelUrl),
                new("customer_email", request.CustomerEmail),
                // Attribution so the webhook (added when billing goes live) can tie
                // the subscription back to the right tenant + plan.
                new("client_reference_id", $"{request.Brand}:{request.PlanId}"),
                new("metadata[brand]", request.Brand),
                new("metadata[planId]", request.PlanId),
            };

            using var msg = new HttpRequestMessage(HttpMethod.Post, $"{ApiBase}/checkout/sessions")
            {
                Content = new FormUrlEncodedContent(form),
            };
            msg.Headers.Authorization = new AuthenticationHeaderValue("Bearer", _options.SecretKey);

            using var resp = await _http.SendAsync(msg, ct);
            var body = await resp.Content.ReadAsStringAsync(ct);
            if (!resp.IsSuccessStatusCode)
            {
                // Never log the key; the body is a Stripe error object (safe).
                _logger.LogWarning(
                    "Stripe checkout for brand {Brand} failed: {Status}", request.Brand, resp.StatusCode);
                return CheckoutResult.Unavailable("Payment provider rejected the request.");
            }

            using var doc = System.Text.Json.JsonDocument.Parse(body);
            var url = doc.RootElement.TryGetProperty("url", out var u) ? u.GetString() : null;
            if (string.IsNullOrEmpty(url))
                return CheckoutResult.Unavailable("Payment provider returned no checkout URL.");

            return CheckoutResult.Success(url);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Stripe checkout threw for brand {Brand}.", request.Brand);
            return CheckoutResult.Unavailable("Could not reach the payment provider.");
        }
    }

    public async Task<CheckoutResult> CreateJobPaymentAsync(JobPaymentRequest request, CancellationToken ct = default)
    {
        // Only the secret key is needed for one-off payments (no recurring Price).
        if (string.IsNullOrWhiteSpace(_options.SecretKey))
            return CheckoutResult.Unavailable("Stripe is not configured for this deployment.");
        if (request.Amount <= 0)
            return CheckoutResult.Unavailable("The amount must be greater than zero.");

        try
        {
            var cents = (long)Math.Round(request.Amount * 100m, MidpointRounding.AwayFromZero);
            var form = new List<KeyValuePair<string, string>>
            {
                new("mode", "payment"),
                new("line_items[0][price_data][currency]", "usd"),
                new("line_items[0][price_data][product_data][name]",
                    string.IsNullOrWhiteSpace(request.Description) ? "Service" : request.Description),
                new("line_items[0][price_data][unit_amount]", cents.ToString()),
                new("line_items[0][quantity]", "1"),
                new("success_url", request.SuccessUrl),
                new("cancel_url", request.CancelUrl),
                // Metadata so the webhook can mark the right job paid.
                new("client_reference_id", $"{request.Brand}:{request.JobId}"),
                new("metadata[brand]", request.Brand),
                new("metadata[jobId]", request.JobId.ToString()),
            };
            if (!string.IsNullOrWhiteSpace(request.CustomerEmail))
                form.Add(new("customer_email", request.CustomerEmail));

            using var msg = new HttpRequestMessage(HttpMethod.Post, $"{ApiBase}/checkout/sessions")
            {
                Content = new FormUrlEncodedContent(form),
            };
            msg.Headers.Authorization = new AuthenticationHeaderValue("Bearer", _options.SecretKey);

            using var resp = await _http.SendAsync(msg, ct);
            var body = await resp.Content.ReadAsStringAsync(ct);
            if (!resp.IsSuccessStatusCode)
            {
                _logger.LogWarning("Stripe job payment for brand {Brand} failed: {Status}", request.Brand, resp.StatusCode);
                return CheckoutResult.Unavailable("Payment provider rejected the request.");
            }
            using var doc = System.Text.Json.JsonDocument.Parse(body);
            var url = doc.RootElement.TryGetProperty("url", out var u) ? u.GetString() : null;
            return string.IsNullOrEmpty(url)
                ? CheckoutResult.Unavailable("Payment provider returned no checkout URL.")
                : CheckoutResult.Success(url);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Stripe job payment threw for brand {Brand}.", request.Brand);
            return CheckoutResult.Unavailable("Could not reach the payment provider.");
        }
    }
}
