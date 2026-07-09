using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using DIYHelper2.Api.Data;
using DIYHelper2.Api.Models;
using Microsoft.EntityFrameworkCore;

namespace DIYHelper2.Api.Integrations.Crm;

/// <summary>
/// Pushes a lead into a brand's connected Jobber account via the GraphQL API.
/// The brand's OAuth tokens come from its <see cref="BrandCrmConnection"/>;
/// <see cref="JobberTokenService"/> keeps the access token fresh.
///
/// <para>
/// Step 2 sends the confirmed, version-stable <c>clientCreate</c> mutation to
/// create the customer (name + email + phone). Turning that client into a work
/// <em>Request</em> (<c>requestCreate</c>, carrying the project title/description)
/// is the documented next step, but Jobber's Request input schema is version-
/// specific and can only be confirmed in GraphiQL against a live account — so it
/// is intentionally NOT sent blind here. When validated, add a second mutation
/// using the client id returned below; the sink already threads it through.
/// </para>
///
/// <para>Registered as a typed HttpClient with the shared SsrfGuardHandler.
/// Fail-soft: returns <see cref="CrmPushResult.Failure"/> on any error.</para>
/// </summary>
public class JobberCrmSink : ICrmLeadSink
{
    private const string GraphQlUrl = "https://api.getjobber.com/api/graphql";
    // Pin the schema version so a server-side schema bump can't silently change
    // mutation behavior. Bump deliberately after validating in GraphiQL.
    private const string ApiVersion = "2023-11-15";

    private const string CreateClientMutation = """
        mutation CreateClient($input: ClientCreateInput!) {
          clientCreate(input: $input) {
            client { id }
            userErrors { message path }
          }
        }
        """;

    private readonly HttpClient _http;
    private readonly AppDbContext _db;
    private readonly JobberTokenService _tokens;
    private readonly ILogger<JobberCrmSink> _logger;

    public JobberCrmSink(
        HttpClient http,
        AppDbContext db,
        JobberTokenService tokens,
        ILogger<JobberCrmSink> logger)
    {
        _http = http;
        _db = db;
        _tokens = tokens;
        _logger = logger;
        _http.Timeout = TimeSpan.FromSeconds(20);
    }

    public CrmProvider Provider => CrmProvider.Jobber;

    public async Task<CrmPushResult> PushAsync(Brand brand, CrmLead lead, CancellationToken ct = default)
    {
        var conn = await _db.BrandCrmConnections.FirstOrDefaultAsync(
            c => c.BrandSlug == brand.Slug && c.Provider == (int)CrmProvider.Jobber && c.IsActive, ct);
        if (conn is null)
            return CrmPushResult.Failure("no active Jobber connection for brand");

        var token = await _tokens.GetValidAccessTokenAsync(conn, ct);
        if (token is null)
            return CrmPushResult.Failure("could not obtain a valid Jobber access token (needs re-auth)");

        var (first, last) = SplitName(lead.CustomerName);
        var input = new Dictionary<string, object?>
        {
            ["firstName"] = first,
            ["lastName"] = last,
        };
        if (!string.IsNullOrWhiteSpace(lead.CustomerEmail))
            input["emails"] = new[] { new { address = lead.CustomerEmail, primary = true, description = "MAIN" } };
        if (!string.IsNullOrWhiteSpace(lead.CustomerPhone))
            input["phones"] = new[] { new { number = lead.CustomerPhone, primary = true, description = "MAIN" } };

        var body = new { query = CreateClientMutation, variables = new { input } };

        try
        {
            using var req = new HttpRequestMessage(HttpMethod.Post, GraphQlUrl)
            {
                Content = JsonContent.Create(body),
            };
            req.Headers.Authorization = new AuthenticationHeaderValue("bearer", token);
            req.Headers.TryAddWithoutValidation("X-JOBBER-GRAPHQL-VERSION", ApiVersion);

            using var resp = await _http.SendAsync(req, ct);

            if (resp.StatusCode == HttpStatusCode.TooManyRequests)
                return CrmPushResult.Failure("Jobber rate limit hit (429)");
            if (!resp.IsSuccessStatusCode)
                return CrmPushResult.Failure($"Jobber GraphQL returned HTTP {(int)resp.StatusCode}");

            using var doc = JsonDocument.Parse(await resp.Content.ReadAsStringAsync(ct));
            var root = doc.RootElement;

            // Transport-level GraphQL errors (auth, malformed query, etc.).
            if (root.TryGetProperty("errors", out var errors) && errors.ValueKind == JsonValueKind.Array && errors.GetArrayLength() > 0)
                return CrmPushResult.Failure("Jobber GraphQL errors: " + FirstMessage(errors));

            if (!root.TryGetProperty("data", out var data)
                || !data.TryGetProperty("clientCreate", out var clientCreate))
                return CrmPushResult.Failure("unexpected Jobber response shape");

            // Domain-level validation errors returned by the mutation.
            if (clientCreate.TryGetProperty("userErrors", out var userErrors)
                && userErrors.ValueKind == JsonValueKind.Array && userErrors.GetArrayLength() > 0)
                return CrmPushResult.Failure("Jobber userErrors: " + FirstMessage(userErrors));

            var id = clientCreate.TryGetProperty("client", out var client)
                     && client.ValueKind == JsonValueKind.Object
                     && client.TryGetProperty("id", out var idEl)
                ? idEl.GetString()
                : null;

            return CrmPushResult.Success(id);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Jobber push for lead {LeadId} threw", lead.LeadId);
            return CrmPushResult.Failure(ex.Message);
        }
    }

    // Jobber's clientCreate wants first/last name. Split on the first space;
    // a single token becomes the first name (last name empty).
    private static (string first, string last) SplitName(string name)
    {
        var trimmed = (name ?? "").Trim();
        if (trimmed.Length == 0) return ("", "");
        var idx = trimmed.IndexOf(' ');
        return idx < 0 ? (trimmed, "") : (trimmed[..idx], trimmed[(idx + 1)..].Trim());
    }

    private static string FirstMessage(JsonElement array)
    {
        foreach (var e in array.EnumerateArray())
            if (e.TryGetProperty("message", out var m) && m.ValueKind == JsonValueKind.String)
                return m.GetString() ?? "";
        return "unknown";
    }
}
