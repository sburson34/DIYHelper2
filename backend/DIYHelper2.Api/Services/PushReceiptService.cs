using DIYHelper2.Api.Data;

namespace DIYHelper2.Api.Services;

/// <summary>
/// Background worker that reconciles Expo delivery receipts for recently-sent
/// campaigns: updates delivered/failed counts and prunes tokens Expo reports as
/// unregistered. Runs every 2 minutes (Expo needs a short delay before receipts
/// are ready). Delegates the actual work to <see cref="PushSendService"/>.
/// </summary>
public class PushReceiptService : BackgroundService
{
    private static readonly TimeSpan Interval = TimeSpan.FromMinutes(2);

    private readonly IServiceProvider _services;
    private readonly ILogger<PushReceiptService> _logger;

    public PushReceiptService(IServiceProvider services, ILogger<PushReceiptService> logger)
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
                using var scope = _services.CreateScope();
                var sender = scope.ServiceProvider.GetRequiredService<PushSendService>();
                await sender.ReconcileReceiptsAsync(stoppingToken);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                break;
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Push receipt reconciliation tick failed.");
            }
        }
    }
}
