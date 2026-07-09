using System.Net.Http.Json;
using System.Text.Json;
using DIYHelper2.Api.Data;
using DIYHelper2.Api.Models;
using DIYHelper2.Api.Services;
using DIYHelper2.Tests.Infrastructure;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;
using Sburson.Shared.Email;

namespace DIYHelper2.Tests.Integration;

/// <summary>
/// Job report email on completion, recurring maintenance scheduling, and the
/// maintenance-reminder sweep. Email goes through the captured FakeEmailService.
/// </summary>
public class ReportAndMaintenanceTests : IClassFixture<ApiFactory>
{
    private readonly ApiFactory _factory;
    public ReportAndMaintenanceTests(ApiFactory factory) => _factory = factory;

    private async Task<int> BookAsync(string brand, string device)
    {
        var c = _factory.CreateClient();
        c.DefaultRequestHeaders.Add("X-Brand", brand);
        c.DefaultRequestHeaders.Add("X-Device-Id", device);
        var req = new HttpRequestMessage(HttpMethod.Post, "/api/help-requests")
        {
            Content = JsonContent.Create(new
            {
                customerName = "Casey", customerEmail = "casey@rep.example", customerPhone = "5556667777",
                projectTitle = "Report job", userDescription = "d", projectData = "{}", imageBase64 = (string?)null,
            }),
        };
        req.Headers.Add("X-Brand", brand);
        req.Headers.Add("X-Device-Id", device);
        return (await (await c.SendAsync(req)).Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetInt32();
    }

    [Fact]
    public async Task Completing_SendsReport_AndSchedulesMaintenance()
    {
        await _factory.SeedBrandAsync("rep-co", "Rep Co", "leads@rep.example");
        var jobId = await BookAsync("rep-co", "rep-dev");
        var admin = _factory.CreateAdminClient();

        // Complete with a 6-month maintenance interval in the same PUT.
        var resp = await admin.PutAsJsonAsync($"/api/help-requests/{jobId}",
            new { status = "completed", maintenanceIntervalMonths = 6 });
        Assert.Equal(System.Net.HttpStatusCode.OK, resp.StatusCode);

        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var job = await db.HelpRequests.FirstAsync(r => r.Id == jobId);
        Assert.NotNull(job.ReportSentAt);   // report emailed

        var reminder = await db.MaintenanceReminders.FirstOrDefaultAsync(m => m.HelpRequestId == jobId);
        Assert.NotNull(reminder);
        Assert.Null(reminder!.SentAt);
        Assert.True(reminder.DueAt > DateTime.UtcNow.AddMonths(5));   // ~6 months out
    }

    [Fact]
    public async Task ReminderSweep_SendsDueReminders_AndMarksSent()
    {
        await _factory.SeedBrandAsync("rem-co", "Rem Co", "leads@rem.example");

        using (var seed = _factory.Services.CreateScope())
        {
            var db = seed.ServiceProvider.GetRequiredService<AppDbContext>();
            db.MaintenanceReminders.Add(new MaintenanceReminder
            {
                Brand = "rem-co",
                CustomerName = "Pat",
                CustomerEmail = "pat@rem.example",
                ServiceType = "HVAC tune-up",
                DueAt = DateTime.UtcNow.AddDays(-1),   // due yesterday
            });
            await db.SaveChangesAsync();
        }

        int sent;
        using (var run = _factory.Services.CreateScope())
        {
            var db = run.ServiceProvider.GetRequiredService<AppDbContext>();
            var mailer = run.ServiceProvider.GetRequiredService<IEmailService>();
            var messaging = run.ServiceProvider.GetRequiredService<MessagingService>();
            sent = await MaintenanceReminderService.ProcessDueAsync(db, mailer, messaging, NullLogger.Instance);
        }
        Assert.True(sent >= 1);

        using var check = _factory.Services.CreateScope();
        var db2 = check.ServiceProvider.GetRequiredService<AppDbContext>();
        var pending = await db2.MaintenanceReminders.CountAsync(m => m.Brand == "rem-co" && m.SentAt == null);
        Assert.Equal(0, pending);
    }
}
