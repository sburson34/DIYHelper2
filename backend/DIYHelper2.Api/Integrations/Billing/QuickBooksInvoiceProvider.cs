using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using DIYHelper2.Api.Data;
using DIYHelper2.Api.Models;
using Microsoft.EntityFrameworkCore;

namespace DIYHelper2.Api.Integrations.Billing;

/// <summary>
/// QuickBooks Online implementation of <see cref="IInvoiceProvider"/>. When the
/// brand has an active <see cref="BrandAccountingConnection"/> (built by the QBO
/// OAuth flow), it finds-or-creates the customer by email and posts an invoice
/// with the job's quote lines, returning the QBO invoice id.
///
/// <para>Fail-soft by contract: unconfigured app creds, a missing connection, an
/// expired-and-unrefreshable token, or any QBO API error all resolve to an
/// unavailable <see cref="InvoiceResult"/> rather than throwing — invoice sync is
/// a best-effort side effect of completing a job, never a blocker. The typed
/// client is SSRF-guarded like every external client.</para>
/// </summary>
public class QuickBooksInvoiceProvider : IInvoiceProvider
{
    private readonly HttpClient _http;
    private readonly QuickBooksOptions _options;
    private readonly QuickBooksTokenService _tokens;
    private readonly AppDbContext _db;
    private readonly ILogger<QuickBooksInvoiceProvider> _logger;

    public QuickBooksInvoiceProvider(
        HttpClient http, QuickBooksOptions options, QuickBooksTokenService tokens,
        AppDbContext db, ILogger<QuickBooksInvoiceProvider> logger)
    {
        _http = http;
        _options = options;
        _tokens = tokens;
        _db = db;
        _logger = logger;
    }

    // App creds present. Whether a given brand can actually sync also depends on
    // an active connection, checked per-call in CreateInvoiceAsync.
    public bool IsConfigured => _options.IsConfigured;

    public async Task<InvoiceResult> CreateInvoiceAsync(InvoiceRequest request, CancellationToken ct = default)
    {
        if (!_options.IsConfigured)
            return InvoiceResult.Unavailable("QuickBooks is not configured for this deployment.");

        try
        {
            var conn = await _db.BrandAccountingConnections
                .FirstOrDefaultAsync(c => c.BrandSlug == request.Brand && c.IsActive, ct);
            if (conn is null || string.IsNullOrEmpty(conn.RealmId))
                return InvoiceResult.Unavailable("This brand hasn't connected QuickBooks.");

            var token = await _tokens.GetValidAccessTokenAsync(conn, ct);
            if (string.IsNullOrEmpty(token))
                return InvoiceResult.Unavailable("QuickBooks needs to be reconnected.");

            var customerId = await FindOrCreateCustomerAsync(conn.RealmId!, token, request, ct);
            if (customerId is null)
                return InvoiceResult.Unavailable("Couldn't resolve the QuickBooks customer.");

            var lines = request.Lines.Select(l => new
            {
                Amount = l.Amount * l.Quantity,
                DetailType = "SalesItemLineDetail",
                Description = l.Description,
                SalesItemLineDetail = new
                {
                    ItemRef = new { value = _options.ItemId },
                    Qty = l.Quantity,
                    UnitPrice = l.Amount,
                },
            }).ToArray();

            var invoiceBody = new
            {
                CustomerRef = new { value = customerId },
                Line = lines,
                CustomerMemo = string.IsNullOrWhiteSpace(request.Memo) ? null : new { value = request.Memo },
            };

            using var resp = await SendAsync(HttpMethod.Post, conn.RealmId!, "invoice", token, invoiceBody, ct);
            var body = await resp.Content.ReadAsStringAsync(ct);
            if (!resp.IsSuccessStatusCode)
            {
                _logger.LogWarning("QBO invoice create for brand {Brand} failed: {Status}", request.Brand, resp.StatusCode);
                return InvoiceResult.Unavailable("QuickBooks rejected the invoice.");
            }
            using var doc = JsonDocument.Parse(body);
            var id = doc.RootElement.TryGetProperty("Invoice", out var inv) && inv.TryGetProperty("Id", out var idEl)
                ? idEl.GetString() : null;
            return id is null
                ? InvoiceResult.Unavailable("QuickBooks returned no invoice id.")
                : InvoiceResult.Success(id);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "QBO invoice sync threw for brand {Brand}.", request.Brand);
            return InvoiceResult.Unavailable("Couldn't reach QuickBooks.");
        }
    }

    // Find a customer by email (QBO query language), else create a minimal one.
    private async Task<string?> FindOrCreateCustomerAsync(
        string realmId, string token, InvoiceRequest request, CancellationToken ct)
    {
        var email = (request.CustomerEmail ?? "").Replace("'", "");
        if (!string.IsNullOrWhiteSpace(email))
        {
            var query = Uri.EscapeDataString($"SELECT Id FROM Customer WHERE PrimaryEmailAddr = '{email}'");
            using var q = await SendAsync(HttpMethod.Get, realmId, $"query?query={query}", token, null, ct);
            if (q.IsSuccessStatusCode)
            {
                using var doc = JsonDocument.Parse(await q.Content.ReadAsStringAsync(ct));
                if (doc.RootElement.TryGetProperty("QueryResponse", out var qr)
                    && qr.TryGetProperty("Customer", out var custs)
                    && custs.ValueKind == JsonValueKind.Array && custs.GetArrayLength() > 0)
                {
                    return custs[0].GetProperty("Id").GetString();
                }
            }
        }

        var display = string.IsNullOrWhiteSpace(request.CustomerName)
            ? (string.IsNullOrWhiteSpace(email) ? $"Customer {Guid.NewGuid():N}".Substring(0, 20) : email)
            : request.CustomerName!;
        var createBody = new
        {
            DisplayName = display,
            PrimaryEmailAddr = string.IsNullOrWhiteSpace(email) ? null : new { Address = email },
        };
        using var create = await SendAsync(HttpMethod.Post, realmId, "customer", token, createBody, ct);
        if (!create.IsSuccessStatusCode) return null;
        using var cdoc = JsonDocument.Parse(await create.Content.ReadAsStringAsync(ct));
        return cdoc.RootElement.TryGetProperty("Customer", out var c) && c.TryGetProperty("Id", out var cid)
            ? cid.GetString() : null;
    }

    private Task<HttpResponseMessage> SendAsync(
        HttpMethod method, string realmId, string path, string token, object? body, CancellationToken ct)
    {
        var req = new HttpRequestMessage(method, $"{_options.ApiBase}/v3/company/{realmId}/{path}");
        req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
        req.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));
        if (body is not null)
        {
            var json = JsonSerializer.Serialize(body,
                new JsonSerializerOptions { DefaultIgnoreCondition = System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingNull });
            req.Content = new StringContent(json, Encoding.UTF8, "application/json");
        }
        return _http.SendAsync(req, ct);
    }
}
