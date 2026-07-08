using System.Text.Json;
using DIYHelper2.Api.Data;
using DIYHelper2.Api.Integrations;
using DIYHelper2.Api.Models;
using DIYHelper2.Api.Validation;
using Microsoft.EntityFrameworkCore;

namespace DIYHelper2.Api.Services;

/// <summary>Opted-in device counts for a brand's audience.</summary>
public record PushAudience(int Total, int Ios, int Android);

/// <summary>
/// Owns the campaign → delivery path so the send endpoint and the background
/// dispatch worker share one implementation. Scoped (touches
/// <see cref="AppDbContext"/> per request/tick); resolve it inside a DI scope
/// from a hosted service.
/// </summary>
public class PushSendService
{
    private readonly AppDbContext _db;
    private readonly ExpoPushClient _expo;
    private readonly ILogger<PushSendService> _logger;

    public PushSendService(AppDbContext db, ExpoPushClient expo, ILogger<PushSendService> logger)
    {
        _db = db;
        _expo = expo;
        _logger = logger;
    }

    /// <summary>Counts active, opted-in devices for a brand, optionally filtered
    /// to one platform.</summary>
    public async Task<PushAudience> PreviewAudienceAsync(string brand, string? platform, CancellationToken ct = default)
    {
        var q = _db.PushTokens.Where(t => t.Brand == brand && t.IsActive && t.MarketingOptIn);
        var normalized = PushValidation.NormalizePlatform(platform);
        if (!string.IsNullOrEmpty(normalized))
            q = q.Where(t => t.Platform == normalized);

        var total = await q.CountAsync(ct);
        var ios = await q.CountAsync(t => t.Platform == "ios", ct);
        var android = await q.CountAsync(t => t.Platform == "android", ct);
        return new PushAudience(total, ios, android);
    }

    /// <summary>
    /// Sends a campaign now: resolves its audience, fans the notification out to
    /// Expo, records tickets for later receipt polling, and deactivates any
    /// tokens Expo rejects as unregistered. Idempotent-ish — only dispatches a
    /// campaign that is still "scheduled" or "sending".
    /// </summary>
    public async Task DispatchAsync(int campaignId, CancellationToken ct = default)
    {
        var campaign = await _db.PushCampaigns.FirstOrDefaultAsync(c => c.Id == campaignId, ct);
        if (campaign is null) return;
        if (campaign.Status is not ("scheduled" or "sending"))
            return; // already sent/canceled/failed

        campaign.Status = "sending";
        campaign.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync(ct);

        try
        {
            var tokensQuery = _db.PushTokens
                .Where(t => t.Brand == campaign.Brand && t.IsActive && t.MarketingOptIn);
            if (!string.IsNullOrEmpty(campaign.PlatformFilter))
                tokensQuery = tokensQuery.Where(t => t.Platform == campaign.PlatformFilter);
            var tokens = await tokensQuery.ToListAsync(ct);

            campaign.RecipientCount = tokens.Count;

            if (tokens.Count == 0)
            {
                campaign.Status = "sent";
                campaign.SentAt = DateTime.UtcNow;
                campaign.UpdatedAt = DateTime.UtcNow;
                await _db.SaveChangesAsync(ct);
                return;
            }

            object? data = ParseData(campaign.DataJson);
            var messages = tokens.Select(t => new ExpoPushMessage(
                To: t.Token,
                Title: campaign.Title,
                Body: campaign.Body,
                Subtitle: campaign.Subtitle,
                ImageUrl: campaign.ImageUrl,
                Data: data)).ToList();

            var tickets = await _expo.SendAsync(messages, ct);

            var ticketMap = new Dictionary<string, string>();
            var failed = 0;
            var now = DateTime.UtcNow;
            for (var i = 0; i < tickets.Count && i < tokens.Count; i++)
            {
                var ticket = tickets[i];
                var token = tokens[i];
                if (ticket.Ok && !string.IsNullOrEmpty(ticket.Id))
                {
                    ticketMap[ticket.Id] = token.Token;
                }
                else
                {
                    failed++;
                    if (IsUnregistered(ticket.ErrorCode))
                    {
                        token.IsActive = false;
                        token.UpdatedAt = now;
                    }
                }
            }

            campaign.FailedCount = failed;
            campaign.TicketsJson = ticketMap.Count > 0 ? JsonSerializer.Serialize(ticketMap) : null;
            campaign.SentAt = now;
            campaign.Status = "sent";
            campaign.UpdatedAt = now;
            await _db.SaveChangesAsync(ct);

            _logger.LogInformation(
                "Push campaign {CampaignId} ({Brand}) sent to {Recipients} devices ({Failed} send failures).",
                campaign.Id, campaign.Brand, campaign.RecipientCount, failed);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Push campaign {CampaignId} dispatch failed.", campaign.Id);
            campaign.Status = "failed";
            campaign.UpdatedAt = DateTime.UtcNow;
            await _db.SaveChangesAsync(ct);
        }
    }

    /// <summary>
    /// Polls Expo delivery receipts for recently-sent campaigns that still have
    /// outstanding tickets, updates delivered/failed counts, and deactivates
    /// tokens Expo now reports as unregistered.
    /// </summary>
    public async Task ReconcileReceiptsAsync(CancellationToken ct = default)
    {
        var pending = await _db.PushCampaigns
            .Where(c => c.TicketsJson != null && c.Status == "sent")
            .OrderByDescending(c => c.SentAt)
            .Take(50)
            .ToListAsync(ct);

        foreach (var campaign in pending)
        {
            Dictionary<string, string>? map;
            try { map = JsonSerializer.Deserialize<Dictionary<string, string>>(campaign.TicketsJson!); }
            catch { map = null; }
            if (map is null || map.Count == 0)
            {
                campaign.TicketsJson = null;
                await _db.SaveChangesAsync(ct);
                continue;
            }

            var receipts = await _expo.GetReceiptsAsync(map.Keys.ToList(), ct);
            if (receipts.Count == 0) continue; // nothing resolved yet

            var remaining = new Dictionary<string, string>();
            var deadTokens = new List<string>();
            foreach (var (ticketId, token) in map)
            {
                if (!receipts.TryGetValue(ticketId, out var receipt))
                {
                    remaining[ticketId] = token; // not resolved yet — keep polling
                    continue;
                }
                if (receipt.Ok)
                {
                    campaign.DeliveredCount++;
                }
                else
                {
                    campaign.FailedCount++;
                    if (IsUnregistered(receipt.ErrorCode))
                        deadTokens.Add(token);
                }
            }

            campaign.TicketsJson = remaining.Count > 0 ? JsonSerializer.Serialize(remaining) : null;
            campaign.UpdatedAt = DateTime.UtcNow;
            await _db.SaveChangesAsync(ct);

            if (deadTokens.Count > 0)
            {
                await _db.PushTokens
                    .Where(t => deadTokens.Contains(t.Token) && t.IsActive)
                    .ExecuteUpdateAsync(s => s
                        .SetProperty(t => t.IsActive, false)
                        .SetProperty(t => t.UpdatedAt, DateTime.UtcNow), ct);
            }
        }
    }

    private static bool IsUnregistered(string? errorCode) =>
        string.Equals(errorCode, "DeviceNotRegistered", StringComparison.OrdinalIgnoreCase);

    private static object? ParseData(string? dataJson)
    {
        if (string.IsNullOrWhiteSpace(dataJson)) return null;
        try { return JsonSerializer.Deserialize<JsonElement>(dataJson); }
        catch { return null; }
    }
}
