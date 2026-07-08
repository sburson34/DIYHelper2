using System.Net;
using System.Net.Http.Json;
using DIYHelper2.Tests.Infrastructure;

namespace DIYHelper2.Tests.Integration;

/// <summary>
/// CRM delivery (step 1: generic webhook). When a brand has a LeadWebhookUrl, a
/// newly-created "call a pro" lead is POSTed to it as JSON — a second delivery
/// channel alongside the brand email. Best-effort: a webhook failure never fails
/// the customer's submit, and a brand with no webhook URL is left untouched.
///
/// Uses example.com as the webhook host because the SSRF guard (still in the
/// WebhookCrmSink client chain during tests) resolves the host for real; the
/// response is faked via <see cref="ApiFactory.FakeCrmWebhookHandler"/>.
/// </summary>
public class CrmWebhookLeadTests : IClassFixture<ApiFactory>
{
    private readonly ApiFactory _factory;

    public CrmWebhookLeadTests(ApiFactory factory) => _factory = factory;

    private static HttpRequestMessage PostLead(string brand, string projectTitle, string customerEmail)
    {
        var req = new HttpRequestMessage(HttpMethod.Post, "/api/help-requests")
        {
            Content = JsonContent.Create(new
            {
                customerName = "Cust",
                customerEmail,
                customerPhone = "5550000000",
                projectTitle,
                userDescription = "leaky faucet under the sink",
                projectData = "{}",
                imageBase64 = (string?)null,
            }),
        };
        req.Headers.Add("X-Brand", brand);
        return req;
    }

    [Fact]
    public async Task Create_PushesLeadToWebhook_WhenBrandHasWebhookUrl()
    {
        await _factory.SeedBrandAsync(
            "crm-hook", "CRM Hook Co", "leads@crm-hook.example",
            leadWebhookUrl: "https://example.com/hooks/crm");

        string? capturedBody = null;
        HttpMethod? capturedMethod = null;
        _factory.FakeCrmWebhookHandler.Responder = async req =>
        {
            capturedMethod = req.Method;
            capturedBody = req.Content is null ? "" : await req.Content.ReadAsStringAsync();
            return new HttpResponseMessage(HttpStatusCode.OK);
        };

        var resp = await _factory.CreateClient().SendAsync(PostLead("crm-hook", "Faucet fix", "hook-cust@example.com"));
        Assert.Equal(HttpStatusCode.Created, resp.StatusCode);

        Assert.Equal(HttpMethod.Post, capturedMethod);
        Assert.NotNull(capturedBody);
        Assert.Contains("Faucet fix", capturedBody);
        Assert.Contains("hook-cust@example.com", capturedBody);
        Assert.Contains("lead.created", capturedBody);   // the event envelope
    }

    [Fact]
    public async Task Create_Returns201_EvenWhenWebhookFails()
    {
        await _factory.SeedBrandAsync(
            "crm-hook-fail", "CRM Hook Fail", "leads@fail.example",
            leadWebhookUrl: "https://example.com/hooks/down");

        _factory.FakeCrmWebhookHandler.Responder = _ => throw new HttpRequestException("webhook down");

        var resp = await _factory.CreateClient().SendAsync(PostLead("crm-hook-fail", "X", "c@example.com"));
        Assert.Equal(HttpStatusCode.Created, resp.StatusCode);
    }

    [Fact]
    public async Task Create_DoesNotCallWebhook_WhenBrandHasNoWebhookUrl()
    {
        await _factory.SeedBrandAsync("crm-no-hook", "No Hook Co", "leads@no-hook.example");

        var called = false;
        _factory.FakeCrmWebhookHandler.Responder = _ =>
        {
            called = true;
            return Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK));
        };

        var resp = await _factory.CreateClient().SendAsync(PostLead("crm-no-hook", "No push", "c@example.com"));
        Assert.Equal(HttpStatusCode.Created, resp.StatusCode);
        Assert.False(called, "webhook should not be called for a brand with no LeadWebhookUrl");
    }
}
