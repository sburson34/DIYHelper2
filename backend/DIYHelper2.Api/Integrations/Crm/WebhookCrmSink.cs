using System.Net.Http.Json;
using DIYHelper2.Api.Models;

namespace DIYHelper2.Api.Integrations.Crm;

/// <summary>
/// Pushes a lead as a JSON POST to a brand's configured outbound webhook
/// (<see cref="Brand.LeadWebhookUrl"/>) — typically a Zapier/Make catch hook the
/// company wires into whatever CRM they run. This is the zero-integration path
/// that covers the tiny shops we don't support with a native OAuth connector.
///
/// <para>
/// Registered as a typed HttpClient with the shared <c>SsrfGuardHandler</c> in
/// Program.cs. The guard matters here specifically because the destination URL
/// is operator-supplied: without it a brand could point its webhook at
/// 169.254.169.254 or loopback and pivot our outbound request into the instance
/// metadata service. Fail-soft — a webhook outage yields a failure result, never
/// an exception, so the customer's submit still succeeds.
/// </para>
/// </summary>
public class WebhookCrmSink : ICrmLeadSink
{
    private readonly HttpClient _http;
    private readonly ILogger<WebhookCrmSink> _logger;

    public WebhookCrmSink(HttpClient http, ILogger<WebhookCrmSink> logger)
    {
        _http = http;
        _logger = logger;
        _http.Timeout = TimeSpan.FromSeconds(15);
    }

    public CrmProvider Provider => CrmProvider.Webhook;

    public async Task<CrmPushResult> PushAsync(Brand brand, CrmLead lead, CancellationToken ct = default)
    {
        var url = brand.LeadWebhookUrl;
        if (string.IsNullOrWhiteSpace(url))
            return CrmPushResult.Failure("brand has no LeadWebhookUrl");

        // Only ever POST to an absolute http(s) URL. SsrfGuardHandler still vets
        // the resolved IP against the private-range denylist; this just rejects
        // obviously-bad config early with a clear reason.
        if (!Uri.TryCreate(url, UriKind.Absolute, out var uri)
            || (uri.Scheme != Uri.UriSchemeHttp && uri.Scheme != Uri.UriSchemeHttps))
            return CrmPushResult.Failure("LeadWebhookUrl is not an absolute http(s) URL");

        var payload = new
        {
            @event = "lead.created",
            leadId = lead.LeadId,
            brand = lead.Brand,
            customerName = lead.CustomerName,
            customerEmail = lead.CustomerEmail,
            customerPhone = lead.CustomerPhone,
            projectTitle = lead.ProjectTitle,
            description = lead.Description,
            createdAt = lead.CreatedAt,
        };

        try
        {
            using var resp = await _http.PostAsJsonAsync(uri, payload, ct);
            if (!resp.IsSuccessStatusCode)
                return CrmPushResult.Failure($"webhook returned HTTP {(int)resp.StatusCode}");

            // A generic webhook (Zapier catch hook) has no meaningful record id
            // to hand back, so there's no RemoteId to persist — success is enough.
            return CrmPushResult.Success();
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Webhook push for lead {LeadId} threw", lead.LeadId);
            return CrmPushResult.Failure(ex.Message);
        }
    }
}
