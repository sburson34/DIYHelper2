using DIYHelper2.Api.Data;
using Microsoft.EntityFrameworkCore;

namespace DIYHelper2.Api.Services;

/// <summary>
/// Background worker that dispatches scheduled push campaigns once their send
/// time arrives. Send-now campaigns are dispatched inline by the endpoint; this
/// only picks up rows a composer scheduled for the future.
///
/// <para>
/// Polls every 30s. <see cref="PushSendService"/> is scoped, so each due
/// campaign is dispatched inside its own DI scope (fresh DbContext).
/// </para>
/// </summary>
public class PushDispatchService : BackgroundService
{
    private static readonly TimeSpan Interval = TimeSpan.FromSeconds(30);

    private readonly IServiceProvider _services;
    private readonly ILogger<PushDispatchService> _logger;

    public PushDispatchService(IServiceProvider services, ILogger<PushDispatchService> logger)
    {
        _services = services;
        _logger = logger;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        using var timer = new PeriodicTimer(Interval);
        while (!stoppingToken.IsCancellationRequested
               && await timer.WaitForNextTickAsync(stoppingToken))
        {
            try
            {
                await DispatchDueAsync(stoppingToken);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                break;
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Push dispatch tick failed.");
            }
        }
    }

    private async Task DispatchDueAsync(CancellationToken ct)
    {
        using var scope = _services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var sender = scope.ServiceProvider.GetRequiredService<PushSendService>();

        var now = DateTime.UtcNow;
        var dueIds = await db.PushCampaigns
            .Where(c => c.Status == "scheduled" && c.ScheduledFor != null && c.ScheduledFor <= now)
            .OrderBy(c => c.ScheduledFor)
            .Select(c => c.Id)
            .Take(20)
            .ToListAsync(ct);

        foreach (var id in dueIds)
            await sender.DispatchAsync(id, ct);
    }
}
