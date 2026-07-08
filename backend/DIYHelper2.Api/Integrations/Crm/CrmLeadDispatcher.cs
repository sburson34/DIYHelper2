using DIYHelper2.Api.Data;
using DIYHelper2.Api.Models;
using Microsoft.EntityFrameworkCore;

namespace DIYHelper2.Api.Integrations.Crm;

/// <summary>
/// Second delivery channel for a "call a pro" lead, running alongside the brand
/// lead email. Looks up the brand's CRM configuration and, when it has one,
/// pushes the lead into the external system through the matching
/// <see cref="ICrmLeadSink"/>.
///
/// <para>
/// Best-effort by contract: never throws. A CRM outage must not fail the
/// customer's submit — they already received their guide — mirroring the
/// swallow-and-log behaviour of <c>NotifyBrandOfLeadAsync</c> in Program.cs.
/// </para>
/// </summary>
public class CrmLeadDispatcher
{
    private readonly AppDbContext _db;
    private readonly IEnumerable<ICrmLeadSink> _sinks;
    private readonly ILogger<CrmLeadDispatcher> _logger;

    public CrmLeadDispatcher(
        AppDbContext db,
        IEnumerable<ICrmLeadSink> sinks,
        ILogger<CrmLeadDispatcher> logger)
    {
        _db = db;
        _sinks = sinks;
        _logger = logger;
    }

    public async Task PushLeadAsync(string brandSlug, HelpRequest lead, CancellationToken ct = default)
    {
        try
        {
            var brand = await _db.Brands.FirstOrDefaultAsync(b => b.Slug == brandSlug, ct);
            var provider = ResolveProvider(brand);
            if (provider == CrmProvider.None) return;   // brand not connected to any CRM

            var sink = _sinks.FirstOrDefault(s => s.Provider == provider);
            if (sink is null)
            {
                _logger.LogWarning("No CRM sink registered for provider {Provider}", provider);
                return;
            }

            var result = await sink.PushAsync(brand!, ToCrmLead(lead), ct);
            if (result.Ok)
            {
                if (!string.IsNullOrEmpty(result.RemoteId))
                {
                    lead.CrmRemoteId = result.RemoteId;
                    await _db.SaveChangesAsync(ct);
                }
                _logger.LogInformation(
                    "Lead {LeadId} pushed to {Provider} CRM{Remote}",
                    lead.Id, provider,
                    string.IsNullOrEmpty(result.RemoteId) ? "" : $" as {result.RemoteId}");
            }
            else
            {
                _logger.LogWarning(
                    "CRM push failed for lead {LeadId} via {Provider}: {Error}",
                    lead.Id, provider, result.Error);
            }
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "CRM dispatch threw for lead {LeadId} (swallowed)", lead.Id);
        }
    }

    // Step 1 supports one provider: a brand is "connected" iff it has a webhook
    // URL. Native OAuth providers (Jobber, Housecall Pro) will resolve from a
    // stored BrandCrmConnection row here in a later wave.
    private static CrmProvider ResolveProvider(Brand? brand) =>
        !string.IsNullOrWhiteSpace(brand?.LeadWebhookUrl) ? CrmProvider.Webhook : CrmProvider.None;

    private static CrmLead ToCrmLead(HelpRequest r) => new(
        CustomerName: r.CustomerName,
        CustomerEmail: string.IsNullOrWhiteSpace(r.CustomerEmail) ? null : r.CustomerEmail,
        CustomerPhone: string.IsNullOrWhiteSpace(r.CustomerPhone) ? null : r.CustomerPhone,
        ProjectTitle: r.ProjectTitle,
        Description: r.UserDescription,
        Brand: r.Brand,
        LeadId: r.Id,
        CreatedAt: r.CreatedAt);
}
