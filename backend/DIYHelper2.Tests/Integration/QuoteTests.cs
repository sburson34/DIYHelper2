using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using DIYHelper2.Tests.Infrastructure;

namespace DIYHelper2.Tests.Integration;

/// <summary>
/// Phase 3 quotes: the owner sends a quote for a job (total computed server-side
/// from the lines), the customer sees it on their device-scoped request and
/// approves/declines it, and a response is only accepted while a quote is open.
/// </summary>
public class QuoteTests : IClassFixture<ApiFactory>
{
    private readonly ApiFactory _factory;
    public QuoteTests(ApiFactory factory) => _factory = factory;

    private HttpClient Device(string brand, string device)
    {
        var c = _factory.CreateClient();
        c.DefaultRequestHeaders.Add("X-Brand", brand);
        c.DefaultRequestHeaders.Add("X-Device-Id", device);
        return c;
    }

    private async Task<int> BookAsync(HttpClient c, string brand, string device)
    {
        var req = new HttpRequestMessage(HttpMethod.Post, "/api/help-requests")
        {
            Content = JsonContent.Create(new
            {
                customerName = "Q", customerEmail = "q@x.example", customerPhone = "5559990000",
                projectTitle = "Quote job", userDescription = "d", projectData = "{}", imageBase64 = (string?)null,
            }),
        };
        req.Headers.Add("X-Brand", brand);
        req.Headers.Add("X-Device-Id", device);
        var resp = await c.SendAsync(req);
        return (await resp.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetInt32();
    }

    [Fact]
    public async Task Owner_SendsQuote_CustomerSeesAndApproves()
    {
        await _factory.SeedBrandAsync("q-co", "Q Co", "leads@q.example");
        var device = Device("q-co", "q-dev");
        var jobId = await BookAsync(device, "q-co", "q-dev");

        // Owner sends a 2-line quote; total is computed server-side (100*1 + 25*2 = 150).
        var admin = _factory.CreateAdminClient();
        var send = await admin.PutAsJsonAsync($"/api/help-requests/{jobId}/quote", new
        {
            lines = new[]
            {
                new { description = "Labor", amount = 100.00, quantity = 1 },
                new { description = "Parts", amount = 25.00, quantity = 2 },
            },
        });
        Assert.Equal(HttpStatusCode.OK, send.StatusCode);
        var sent = await send.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(150.00m, sent.GetProperty("quoteTotal").GetDecimal());
        Assert.Equal("sent", sent.GetProperty("quoteStatus").GetString());

        // Customer sees the quote on their request.
        var detail = await device.GetFromJsonAsync<JsonElement>($"/api/my/requests/{jobId}");
        Assert.Equal("sent", detail.GetProperty("quoteStatus").GetString());
        Assert.Equal(150.00m, detail.GetProperty("quoteTotal").GetDecimal());

        // Customer approves.
        var respond = await device.PutAsJsonAsync($"/api/my/requests/{jobId}/quote", new { decision = "approved" });
        Assert.Equal(HttpStatusCode.OK, respond.StatusCode);
        var after = await device.GetFromJsonAsync<JsonElement>($"/api/my/requests/{jobId}");
        Assert.Equal("approved", after.GetProperty("quoteStatus").GetString());
    }

    [Fact]
    public async Task QuoteResponse_RejectedWhenNoOpenQuote()
    {
        await _factory.SeedBrandAsync("q-none", "Q None", "leads@qn.example");
        var device = Device("q-none", "qn-dev");
        var jobId = await BookAsync(device, "q-none", "qn-dev");

        // No quote has been sent → responding is a 400.
        var respond = await device.PutAsJsonAsync($"/api/my/requests/{jobId}/quote", new { decision = "approved" });
        Assert.Equal(HttpStatusCode.BadRequest, respond.StatusCode);
    }

    [Fact]
    public async Task PriceBook_IsBrandScoped()
    {
        await _factory.SeedBrandAsync("pb-a", "PB A", "a@x.example");
        var admin = _factory.CreateAdminClient();
        await admin.PostAsJsonAsync("/api/pricebook", new { name = "Snaking", defaultPrice = 149.99, brand = "pb-a" });

        var list = await admin.GetFromJsonAsync<JsonElement>("/api/pricebook?brand=pb-a");
        var names = list.EnumerateArray().Select(p => p.GetProperty("name").GetString()).ToList();
        Assert.Contains("Snaking", names);
    }
}
