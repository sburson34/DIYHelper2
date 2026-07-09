using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using DIYHelper2.Api.Data;
using DIYHelper2.Api.Models;
using Microsoft.EntityFrameworkCore;

namespace DIYHelper2.Api.Integrations.Crm;

/// <summary>
/// Pushes a lead into a brand's connected Housecall Pro account: creates a
/// customer (POST /customers) then a Job-Inbox lead (POST /leads) referencing it,
/// so it lands in the Pro's "API Leads" channel. OAuth tokens come from the
/// brand's <see cref="BrandCrmConnection"/>, kept fresh by
/// <see cref="HousecallTokenService"/>.
///
/// <para>
/// Housecall's public API requires the Pro's account to be on the <b>MAX plan</b>
/// (and "API Leads in Job Inbox" toggled on under My Apps). A 402/403 is surfaced
/// as a clear, actionable failure rather than a generic error.
/// </para>
///
/// <para>
/// The OAuth flow, base URL, and Bearer scheme are confirmed; the <c>/customers</c>
/// and <c>/leads</c> request-body field names are the documented shape but should
/// be validated against a live MAX-plan partner account. They're centralized in
/// <see cref="BuildCustomerBody"/> / <see cref="BuildLeadBody"/> so that's a
/// one-place change. Fail-soft: returns <see cref="CrmPushResult.Failure"/> on any error.
/// </para>
/// </summary>
public class HousecallCrmSink : ICrmLeadSink
{
    private const string BaseUrl = "https://api.housecallpro.com";

    private readonly HttpClient _http;
    private readonly AppDbContext _db;
    private readonly HousecallTokenService _tokens;
    private readonly ILogger<HousecallCrmSink> _logger;

    public HousecallCrmSink(
        HttpClient http,
        AppDbContext db,
        HousecallTokenService tokens,
        ILogger<HousecallCrmSink> logger)
    {
        _http = http;
        _db = db;
        _tokens = tokens;
        _logger = logger;
        _http.Timeout = TimeSpan.FromSeconds(20);
    }

    public CrmProvider Provider => CrmProvider.HousecallPro;

    public async Task<CrmPushResult> PushAsync(Brand brand, CrmLead lead, CancellationToken ct = default)
    {
        var conn = await _db.BrandCrmConnections.FirstOrDefaultAsync(
            c => c.BrandSlug == brand.Slug && c.Provider == (int)CrmProvider.HousecallPro && c.IsActive, ct);
        if (conn is null)
            return CrmPushResult.Failure("no active Housecall Pro connection for brand");

        var token = await _tokens.GetValidAccessTokenAsync(conn, ct);
        if (token is null)
            return CrmPushResult.Failure("could not obtain a valid Housecall access token (needs re-auth)");

        // 1) Create the customer.
        var (first, last) = SplitName(lead.CustomerName);
        var customer = await PostAsync("/customers", BuildCustomerBody(first, last, lead), token, ct);
        if (!customer.Ok) return customer.Result!;
        var customerId = ReadId(customer.Json);
        if (string.IsNullOrEmpty(customerId))
            return CrmPushResult.Failure("Housecall customer created but no id returned");

        // 2) Create the Job-Inbox lead referencing that customer. This is the
        // whole point — a customer without a lead never appears in Job Inbox.
        var leadResp = await PostAsync("/leads", BuildLeadBody(customerId, lead), token, ct);
        if (!leadResp.Ok) return leadResp.Result!;

        // Prefer the lead id as the remote id; fall back to the customer id.
        return CrmPushResult.Success(ReadId(leadResp.Json) ?? customerId);
    }

    private static object BuildCustomerBody(string first, string last, CrmLead lead) => new
    {
        first_name = first,
        last_name = last,
        email = lead.CustomerEmail,
        mobile_number = lead.CustomerPhone,
        notifications_enabled = false,
    };

    private static object BuildLeadBody(string customerId, CrmLead lead) => new
    {
        customer_id = customerId,
        source = "DIYHelper",
        description = string.IsNullOrWhiteSpace(lead.Description)
            ? lead.ProjectTitle
            : $"{lead.ProjectTitle}\n\n{lead.Description}",
    };

    private readonly record struct PostOutcome(bool Ok, JsonElement Json, CrmPushResult? Result);

    private async Task<PostOutcome> PostAsync(string path, object body, string token, CancellationToken ct)
    {
        try
        {
            using var req = new HttpRequestMessage(HttpMethod.Post, BaseUrl + path)
            {
                Content = JsonContent.Create(body),
            };
            req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);

            using var resp = await _http.SendAsync(req, ct);

            // MAX-plan / API-Leads gating surfaces as a payment/permission error.
            if (resp.StatusCode is HttpStatusCode.PaymentRequired or HttpStatusCode.Forbidden)
                return Fail("Housecall API refused (HTTP " + (int)resp.StatusCode
                    + ") — the connected account likely isn't on the MAX plan or hasn't enabled API Leads in Job Inbox.");
            if (resp.StatusCode == HttpStatusCode.TooManyRequests)
                return Fail("Housecall rate limit hit (429)");
            if (!resp.IsSuccessStatusCode)
                return Fail($"Housecall {path} returned HTTP {(int)resp.StatusCode}");

            var text = await resp.Content.ReadAsStringAsync(ct);
            var json = string.IsNullOrWhiteSpace(text)
                ? default
                : JsonDocument.Parse(text).RootElement.Clone();
            return new PostOutcome(true, json, null);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Housecall POST {Path} threw", path);
            return Fail(ex.Message);
        }

        static PostOutcome Fail(string error) => new(false, default, CrmPushResult.Failure(error));
    }

    private static string? ReadId(JsonElement json) =>
        json.ValueKind == JsonValueKind.Object && json.TryGetProperty("id", out var id)
            ? (id.ValueKind == JsonValueKind.String ? id.GetString() : id.ToString())
            : null;

    private static (string first, string last) SplitName(string name)
    {
        var trimmed = (name ?? "").Trim();
        if (trimmed.Length == 0) return ("", "");
        var idx = trimmed.IndexOf(' ');
        return idx < 0 ? (trimmed, "") : (trimmed[..idx], trimmed[(idx + 1)..].Trim());
    }
}
