using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using DIYHelper2.Tests.Infrastructure;

namespace DIYHelper2.Tests.Integration;

/// <summary>
/// SMS / communication layer. Twilio is dormant in tests (no creds), so these
/// assert the fail-soft contract: a manual send reports not-sent gracefully, a
/// status transition never fails because SMS is off, and the inbound Twilio
/// webhook records a reply and links it to the matching lead.
/// </summary>
public class SmsTests : IClassFixture<ApiFactory>
{
    private readonly ApiFactory _factory;
    public SmsTests(ApiFactory factory) => _factory = factory;

    private async Task<int> CreateLeadAsync(string brand, string phone)
    {
        var req = new HttpRequestMessage(HttpMethod.Post, "/api/help-requests")
        {
            Content = JsonContent.Create(new
            {
                customerName = "C", customerEmail = "c@x.example", customerPhone = phone,
                projectTitle = "SMS job", userDescription = "d", projectData = "{}", imageBase64 = (string?)null,
            }),
        };
        req.Headers.Add("X-Brand", brand);
        var resp = await _factory.CreateClient().SendAsync(req);
        return (await resp.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetInt32();
    }

    [Fact]
    public async Task ManualSend_ReturnsNotSent_WhenUnconfigured()
    {
        await _factory.SeedBrandAsync("sms-co", "SMS Co", "leads@sms.example");
        var id = await CreateLeadAsync("sms-co", "+15551230000");
        var admin = _factory.CreateAdminClient();

        var resp = await admin.PutAsJsonAsync($"/api/help-requests/{id}/message", new { body = "Hello!" });
        Assert.Equal(HttpStatusCode.OK, resp.StatusCode);
        var doc = await resp.Content.ReadFromJsonAsync<JsonElement>();
        Assert.False(doc.GetProperty("sent").GetBoolean());
    }

    [Fact]
    public async Task StatusTransition_DoesNotFail_WhenSmsUnconfigured()
    {
        await _factory.SeedBrandAsync("sms-tx", "SMS Tx", "leads@smstx.example");
        var id = await CreateLeadAsync("sms-tx", "+15551231111");
        var admin = _factory.CreateAdminClient();
        var resp = await admin.PutAsJsonAsync($"/api/help-requests/{id}", new { status = "on_the_way", techEtaMinutes = 15 });
        Assert.Equal(HttpStatusCode.OK, resp.StatusCode);
    }

    [Fact]
    public async Task InboundWebhook_RecordsReply_LinkedToLead()
    {
        // Lead under the flagship brand (the webhook resolves brand by the "To"
        // number; unmatched → "diyhelper", where this lead lives).
        var phone = "+15557778888";
        var id = await CreateLeadAsync("diyhelper", phone);

        var form = new FormUrlEncodedContent(new[]
        {
            new KeyValuePair<string, string>("From", phone),
            new KeyValuePair<string, string>("To", "+15550000000"),
            new KeyValuePair<string, string>("Body", "Yes that time works"),
        });
        var webhook = await _factory.CreateClient().PostAsync("/api/sms/incoming", form);
        Assert.Equal(HttpStatusCode.OK, webhook.StatusCode);

        var admin = _factory.CreateAdminClient();
        var msgs = await admin.GetFromJsonAsync<JsonElement>($"/api/help-requests/{id}/messages");
        Assert.True(msgs.GetArrayLength() >= 1);
        var last = msgs[msgs.GetArrayLength() - 1];
        Assert.Equal("in", last.GetProperty("direction").GetString());
        Assert.Contains("works", last.GetProperty("body").GetString());
    }
}
