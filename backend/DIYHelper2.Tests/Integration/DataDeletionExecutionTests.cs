using DIYHelper2.Api.Data;
using DIYHelper2.Api.Models;
using DIYHelper2.Api.Services;
using DIYHelper2.Tests.Infrastructure;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;
using Sburson.Shared.DataDeletion;

namespace DIYHelper2.Tests.Integration;

/// <summary>
/// The step that makes a verified deletion request mean something. Before
/// <see cref="DataDeletionExecutionService"/> existed, <c>/api/confirm-deletion</c>
/// set the row to "verified" and nothing ever read it — the data stayed until the
/// unrelated 90-day retention purge, and <c>Customers</c> / <c>SmsMessages</c> /
/// <c>MaintenanceReminders</c> / <c>PushTokens</c> were never touched at all,
/// against a privacy policy promising removal within 30 days.
/// </summary>
public class DataDeletionExecutionTests : IClassFixture<ApiFactory>
{
    private readonly ApiFactory _factory;

    public DataDeletionExecutionTests(ApiFactory factory) => _factory = factory;

    private async Task<T> WithDbAsync<T>(Func<AppDbContext, Task<T>> work)
    {
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        return await work(db);
    }

    /// <summary>Seeds one customer's full footprint across every table the wipe
    /// is supposed to reach, under a unique brand so parallel tests don't collide.</summary>
    private async Task SeedFootprintAsync(string brand, string email, string phone, string deviceId)
    {
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();

        var lead = new HelpRequest
        {
            Brand = brand,
            CustomerName = "Wipe Me",
            CustomerEmail = email,
            CustomerPhone = phone,
            DeviceId = deviceId,
            ProjectTitle = "Leaky tap",
            UserDescription = "drip",
            ProjectData = "{}",
            Status = "completed",
        };
        db.HelpRequests.Add(lead);
        await db.SaveChangesAsync();

        db.Customers.Add(new Customer
        {
            Brand = brand, Name = "Wipe Me", Email = email, Phone = phone, DeviceId = deviceId,
        });
        db.SmsMessages.Add(new SmsMessage
        {
            Brand = brand, HelpRequestId = lead.Id, Direction = "out",
            ToNumber = phone, Body = "on the way", Sent = true,
        });
        // An inbound reply we never linked to a job — reachable only via phone.
        db.SmsMessages.Add(new SmsMessage
        {
            Brand = brand, HelpRequestId = null, Direction = "in",
            FromNumber = phone, Body = "thanks", Sent = true,
        });
        db.MaintenanceReminders.Add(new MaintenanceReminder
        {
            Brand = brand, HelpRequestId = lead.Id, CustomerName = "Wipe Me",
            CustomerEmail = email, CustomerPhone = phone, DueAt = DateTime.UtcNow.AddMonths(6),
        });
        db.PushTokens.Add(new PushToken
        {
            Brand = brand, DeviceId = deviceId,
            Token = $"ExponentPushToken[{Guid.NewGuid():N}]", Platform = "ios", IsActive = true,
        });
        await db.SaveChangesAsync();
    }

    private async Task<DataDeletionRequest> SeedVerifiedRequestAsync(string email)
    {
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var req = new DataDeletionRequest
        {
            RequestId = Guid.NewGuid().ToString(),
            Email = email,
            Status = "verified",
            VerifiedAt = DateTime.UtcNow,
        };
        db.DataDeletionRequests.Add(req);
        await db.SaveChangesAsync();
        return req;
    }

    [Fact]
    public async Task VerifiedRequest_WipesEveryTableAndMarksCompleted()
    {
        var brand = $"wipe-{Guid.NewGuid():N}"[..20];
        var email = $"{Guid.NewGuid():N}@example.com";
        var phone = $"555{Random.Shared.Next(1000000, 9999999)}";
        var device = Guid.NewGuid().ToString();

        await SeedFootprintAsync(brand, email, phone, device);
        var request = await SeedVerifiedRequestAsync(email);

        using (var scope = _factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var done = await DataDeletionExecutionService.ProcessVerifiedAsync(db, NullLogger.Instance);
            Assert.True(done >= 1);
        }

        // Nothing of theirs survives, in any table.
        Assert.Equal(0, await WithDbAsync(db => db.HelpRequests.CountAsync(r => r.Brand == brand)));
        Assert.Equal(0, await WithDbAsync(db => db.Customers.CountAsync(c => c.Brand == brand)));
        Assert.Equal(0, await WithDbAsync(db => db.SmsMessages.CountAsync(m => m.Brand == brand)));
        Assert.Equal(0, await WithDbAsync(db => db.MaintenanceReminders.CountAsync(m => m.Brand == brand)));
        Assert.Equal(0, await WithDbAsync(db => db.PushTokens.CountAsync(t => t.DeviceId == device)));

        // And the receipt records that it happened — CompletedAt is also what
        // RetentionService later uses to age the receipt itself out.
        var settled = await WithDbAsync(db =>
            db.DataDeletionRequests.FirstAsync(r => r.RequestId == request.RequestId));
        Assert.Equal("completed", settled.Status);
        Assert.NotNull(settled.CompletedAt);
        Assert.Contains("helpRequests=1", settled.Notes);
    }

    [Fact]
    public async Task Wipe_MatchesEmailCaseInsensitively()
    {
        // The request stores a lowercased address; the lead keeps whatever casing
        // the customer typed. A case-sensitive compare would silently wipe nothing.
        var brand = $"case-{Guid.NewGuid():N}"[..20];
        var local = Guid.NewGuid().ToString("N");
        await SeedFootprintAsync(brand, $"{local}@Example.COM", "5550000001", Guid.NewGuid().ToString());
        await SeedVerifiedRequestAsync($"{local}@example.com");

        using (var scope = _factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            await DataDeletionExecutionService.ProcessVerifiedAsync(db, NullLogger.Instance);
        }

        Assert.Equal(0, await WithDbAsync(db => db.HelpRequests.CountAsync(r => r.Brand == brand)));
    }

    [Fact]
    public async Task Wipe_IgnoresRowsBelongingToOtherPeople()
    {
        // The blast radius is the verified email and nothing else. A bystander who
        // merely shares the brand must be untouched.
        var brand = $"other-{Guid.NewGuid():N}"[..20];
        var victimEmail = $"{Guid.NewGuid():N}@example.com";
        var bystanderEmail = $"{Guid.NewGuid():N}@example.com";

        await SeedFootprintAsync(brand, victimEmail, "5550000002", Guid.NewGuid().ToString());
        await SeedFootprintAsync(brand, bystanderEmail, "5550000003", Guid.NewGuid().ToString());
        await SeedVerifiedRequestAsync(victimEmail);

        using (var scope = _factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            await DataDeletionExecutionService.ProcessVerifiedAsync(db, NullLogger.Instance);
        }

        var remaining = await WithDbAsync(db =>
            db.HelpRequests.Where(r => r.Brand == brand).Select(r => r.CustomerEmail).ToListAsync());
        Assert.Single(remaining);
        Assert.Equal(bystanderEmail, remaining[0]);
    }

    [Fact]
    public async Task UnverifiedPhone_DoesNotWidenTheWipe()
    {
        // The verification code goes to the EMAIL, so only email ownership is
        // proven. If the unverified phone on the request were also used as a match
        // key, anyone could pair their own address with a stranger's number and
        // destroy that stranger's records.
        var brand = $"phone-{Guid.NewGuid():N}"[..20];
        var victimPhone = $"555{Random.Shared.Next(1000000, 9999999)}";
        await SeedFootprintAsync(brand, $"{Guid.NewGuid():N}@example.com", victimPhone, Guid.NewGuid().ToString());

        using (var scope = _factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            // An attacker's own (verified) address, pointed at the victim's phone.
            db.DataDeletionRequests.Add(new DataDeletionRequest
            {
                RequestId = Guid.NewGuid().ToString(),
                Email = $"attacker-{Guid.NewGuid():N}@example.com",
                Phone = victimPhone,
                Status = "verified",
                VerifiedAt = DateTime.UtcNow,
            });
            await db.SaveChangesAsync();
            await DataDeletionExecutionService.ProcessVerifiedAsync(db, NullLogger.Instance);
        }

        Assert.Equal(1, await WithDbAsync(db => db.HelpRequests.CountAsync(r => r.Brand == brand)));
    }

    [Fact]
    public async Task PendingVerification_IsNotExecuted()
    {
        // Only a proven request wipes anything; an unconfirmed one must not.
        var brand = $"pend-{Guid.NewGuid():N}"[..20];
        var email = $"{Guid.NewGuid():N}@example.com";
        await SeedFootprintAsync(brand, email, "5550000004", Guid.NewGuid().ToString());

        using (var scope = _factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            db.DataDeletionRequests.Add(new DataDeletionRequest
            {
                RequestId = Guid.NewGuid().ToString(),
                Email = email,
                Status = "pending_verification",
            });
            await db.SaveChangesAsync();
            await DataDeletionExecutionService.ProcessVerifiedAsync(db, NullLogger.Instance);
        }

        Assert.Equal(1, await WithDbAsync(db => db.HelpRequests.CountAsync(r => r.Brand == brand)));
    }

    [Fact]
    public async Task Rerunning_IsIdempotent()
    {
        // A request that throws part-way stays "verified" and is retried, so a
        // second pass over already-deleted data must be a clean no-op.
        var brand = $"idem-{Guid.NewGuid():N}"[..20];
        var email = $"{Guid.NewGuid():N}@example.com";
        await SeedFootprintAsync(brand, email, "5550000005", Guid.NewGuid().ToString());
        await SeedVerifiedRequestAsync(email);

        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        await DataDeletionExecutionService.ProcessVerifiedAsync(db, NullLogger.Instance);

        var secondPass = await DataDeletionExecutionService.ProcessVerifiedAsync(db, NullLogger.Instance);
        Assert.Equal(0, secondPass);   // nothing left in "verified"
        Assert.Equal(0, await db.HelpRequests.CountAsync(r => r.Brand == brand));
    }
}
