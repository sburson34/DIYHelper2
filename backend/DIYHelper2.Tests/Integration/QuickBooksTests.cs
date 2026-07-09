using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using DIYHelper2.Api.Data;
using DIYHelper2.Tests.Infrastructure;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace DIYHelper2.Tests.Integration;

/// <summary>
/// Phase 4 QuickBooks: the seam is dormant in tests (no QBO creds/connection), so
/// these assert the fail-soft contract — the connect endpoint reports "not
/// configured", status is false with no connection, and completing an approved
/// job never fails just because invoice sync can't run.
/// </summary>
public class QuickBooksTests : IClassFixture<ApiFactory>
{
    private readonly ApiFactory _factory;
    public QuickBooksTests(ApiFactory factory) => _factory = factory;

    [Fact]
    public async Task Connect_Returns503_WhenNotConfigured()
    {
        var admin = _factory.CreateAdminClient();
        var resp = await admin.GetAsync("/api/accounting/qbo/connect?brand=diyhelper");
        Assert.Equal(HttpStatusCode.ServiceUnavailable, resp.StatusCode);
    }

    [Fact]
    public async Task Status_False_WithoutConnection()
    {
        await _factory.SeedBrandAsync("qb-none", "QB None", "leads@qbn.example");
        var admin = _factory.CreateAdminClient();
        var doc = await admin.GetFromJsonAsync<JsonElement>("/api/accounting/status?brand=qb-none");
        Assert.False(doc.GetProperty("connected").GetBoolean());
    }

    [Fact]
    public async Task CompletingApprovedJob_Succeeds_EvenWhenQboUnavailable()
    {
        await _factory.SeedBrandAsync("qb-job", "QB Job", "leads@qbj.example");
        var device = _factory.CreateClient();
        device.DefaultRequestHeaders.Add("X-Brand", "qb-job");
        device.DefaultRequestHeaders.Add("X-Device-Id", "qb-dev");

        // Book → quote → approve.
        var bookReq = new HttpRequestMessage(HttpMethod.Post, "/api/help-requests")
        {
            Content = JsonContent.Create(new
            {
                customerName = "C", customerEmail = "c@qbj.example", customerPhone = "5551110000",
                projectTitle = "Invoice me", userDescription = "d", projectData = "{}", imageBase64 = (string?)null,
            }),
        };
        bookReq.Headers.Add("X-Brand", "qb-job");
        bookReq.Headers.Add("X-Device-Id", "qb-dev");
        var jobId = (await (await device.SendAsync(bookReq)).Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetInt32();

        var admin = _factory.CreateAdminClient();
        await admin.PutAsJsonAsync($"/api/help-requests/{jobId}/quote", new
        { lines = new[] { new { description = "Work", amount = 200.0, quantity = 1 } } });
        await device.PutAsJsonAsync($"/api/my/requests/{jobId}/quote", new { decision = "approved" });

        // Complete the job — invoice sync is unavailable (no QBO), must not fail.
        var complete = await admin.PutAsJsonAsync($"/api/help-requests/{jobId}", new { status = "completed" });
        Assert.Equal(HttpStatusCode.OK, complete.StatusCode);

        // No invoice was recorded (sync was a no-op), and the job is completed.
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var job = await db.HelpRequests.FirstAsync(r => r.Id == jobId);
        Assert.Equal("completed", job.Status);
        Assert.Null(job.InvoiceRemoteId);
    }
}
