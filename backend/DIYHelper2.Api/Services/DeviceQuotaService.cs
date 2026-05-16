using System.Collections.Concurrent;

namespace DIYHelper2.Api.Services;

/// <summary>
/// Per-device daily ceiling on AI calls. IP-based rate limiting already
/// prevents short bursts (20/min); this stops a single device from slowly
/// draining quota over 24 hours. Counter resets at UTC midnight.
///
/// In-memory only — fine for a single-instance Elastic Beanstalk deployment.
/// If we horizontally scale the API, replace the ConcurrentDictionary with a
/// shared store (Redis / DynamoDB).
/// </summary>
public class DeviceQuotaService
{
    private readonly int _dailyLimit;
    private readonly ILogger<DeviceQuotaService> _logger;
    private readonly ConcurrentDictionary<string, Counter> _counters = new();

    public DeviceQuotaService(IConfiguration config, ILogger<DeviceQuotaService> logger)
    {
        _logger = logger;
        var raw = Environment.GetEnvironmentVariable("DAILY_DEVICE_AI_LIMIT");
        _dailyLimit = int.TryParse(raw, out var n) && n > 0 ? n : 60;
    }

    public bool TryConsume(string deviceKey, out int remaining)
    {
        var today = DateTime.UtcNow.Date;
        var counter = _counters.GetOrAdd(deviceKey, _ => new Counter());

        int count;
        lock (counter)
        {
            if (counter.Day != today)
            {
                counter.Day = today;
                counter.Count = 0;
            }
            counter.Count++;
            count = counter.Count;
        }

        remaining = Math.Max(0, _dailyLimit - count);
        return count <= _dailyLimit;
    }

    public static string DeviceKey(HttpContext ctx)
    {
        var deviceId = ctx.Request.Headers["X-Device-Id"].FirstOrDefault();
        if (!string.IsNullOrWhiteSpace(deviceId)) return "d:" + deviceId.Trim();
        var ip = ctx.Request.Headers["X-Forwarded-For"].FirstOrDefault()?.Split(',').FirstOrDefault()?.Trim()
                 ?? ctx.Connection.RemoteIpAddress?.ToString()
                 ?? "unknown";
        return "ip:" + ip;
    }

    private sealed class Counter
    {
        public DateTime Day { get; set; }
        public int Count { get; set; }
    }
}
