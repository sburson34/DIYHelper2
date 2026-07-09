using System.Net.Http.Json;
using System.Text.Json;
using DIYHelper2.Api.Data;
using DIYHelper2.Tests.Infrastructure;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace DIYHelper2.Tests.Integration;

/// <summary>Timesheet rollup: labor hours per tech from StartedAt→CompletedAt.</summary>
public class TimesheetTests : IClassFixture<ApiFactory>
{
    private readonly ApiFactory _factory;
    public TimesheetTests(ApiFactory factory) => _factory = factory;

    [Fact]
    public async Task Timesheet_SumsHoursPerTech()
    {
        await _factory.SeedBrandAsync("ts-co", "TS Co", "leads@ts.example");
        var admin = _factory.CreateAdminClient();
        var techId = (await (await admin.PostAsJsonAsync("/api/technicians", new { name = "Jordan", brand = "ts-co" }))
            .Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetInt32();

        // Seed a completed job with a known 2-hour span, assigned to the tech.
        int jobId;
        using (var scope = _factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var job = new DIYHelper2.Api.Models.HelpRequest
            {
                Brand = "ts-co",
                CustomerName = "C",
                ProjectTitle = "Timed job",
                Status = "completed",
                AssignedTechId = techId,
                StartedAt = DateTime.UtcNow.AddHours(-2),
                CompletedAt = DateTime.UtcNow,
            };
            db.HelpRequests.Add(job);
            await db.SaveChangesAsync();
            jobId = job.Id;
        }

        var doc = await admin.GetFromJsonAsync<JsonElement>("/api/ops/timesheet?brand=ts-co");
        var perTech = doc.GetProperty("perTech");
        Assert.Equal(1, perTech.GetArrayLength());
        var row = perTech[0];
        Assert.Equal(techId, row.GetProperty("techId").GetInt32());
        Assert.True(row.GetProperty("hours").GetDouble() >= 1.9 && row.GetProperty("hours").GetDouble() <= 2.1);
    }
}
