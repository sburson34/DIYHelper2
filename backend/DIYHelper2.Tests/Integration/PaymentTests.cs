using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using DIYHelper2.Api.Data;
using DIYHelper2.Tests.Infrastructure;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace DIYHelper2.Tests.Integration;

/// <summary>
/// Field payment loop. Stripe is dormant in tests (no creds), so the link
/// endpoints report unavailable gracefully; the webhook (no signing secret in
/// tests → accepted) marks the right job paid from its metadata.
/// </summary>
public class PaymentTests : IClassFixture<ApiFactory>
{
    private readonly ApiFactory _factory;
    public PaymentTests(ApiFactory factory) => _factory = factory;

    private async Task<int> BookAsync(string brand, string device)
    {
        var c = _factory.CreateClient();
        c.DefaultRequestHeaders.Add("X-Brand", brand);
        c.DefaultRequestHeaders.Add("X-Device-Id", device);
        var req = new HttpRequestMessage(HttpMethod.Post, "/api/help-requests")
        {
            Content = JsonContent.Create(new
            {
                customerName = "C", customerEmail = "c@pay.example", customerPhone = "5553334444",
                projectTitle = "Pay job", userDescription = "d", projectData = "{}", imageBase64 = (string?)null,
            }),
        };
        req.Headers.Add("X-Brand", brand);
        req.Headers.Add("X-Device-Id", device);
        return (await (await c.SendAsync(req)).Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetInt32();
    }

    [Fact]
    public async Task PaymentLink_Unavailable_WhenStripeNotConfigured()
    {
        await _factory.SeedBrandAsync("pay-co", "Pay Co", "leads@pay.example");
        var jobId = await BookAsync("pay-co", "pay-dev");
        var admin = _factory.CreateAdminClient();
        // With an amount passed so we get past the "no amount" guard to the provider.
        var resp = await admin.PutAsJsonAsync($"/api/help-requests/{jobId}/payment-link", new { amount = 150.0 });
        Assert.Equal(HttpStatusCode.OK, resp.StatusCode);
        var doc = await resp.Content.ReadFromJsonAsync<JsonElement>();
        Assert.False(doc.GetProperty("available").GetBoolean());
    }

    [Fact]
    public async Task Webhook_MarksJobPaid_FromMetadata()
    {
        await _factory.SeedBrandAsync("pay-wh", "Pay WH", "leads@paywh.example");
        var jobId = await BookAsync("pay-wh", "wh-dev");

        var evt = new
        {
            type = "checkout.session.completed",
            data = new { @object = new { amount_total = 20000, metadata = new { brand = "pay-wh", jobId = jobId.ToString() } } },
        };
        var content = new StringContent(JsonSerializer.Serialize(evt), Encoding.UTF8, "application/json");
        var resp = await _factory.CreateClient().PostAsync("/api/stripe/webhook", content);
        Assert.Equal(HttpStatusCode.OK, resp.StatusCode);

        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var job = await db.HelpRequests.FirstAsync(r => r.Id == jobId);
        Assert.NotNull(job.PaidAt);
        Assert.Equal(200.00m, job.AmountPaid);
    }
}
