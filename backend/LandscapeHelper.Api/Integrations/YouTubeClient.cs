using System.Collections.Concurrent;
using System.Text.Json;

namespace DIYHelper2.Api.Integrations;

public record YouTubeVideo(
    string VideoId,
    string Title,
    string Channel,
    string ThumbnailUrl,
    string PublishedAt
);

public class YouTubeClient
{
    private readonly HttpClient _http;
    private readonly ILogger<YouTubeClient> _logger;
    private readonly string? _apiKey;

    // Tiny in-memory cache — 24h TTL keyed by query+limit. Good enough for one instance.
    private static readonly ConcurrentDictionary<string, (DateTime fetched, List<YouTubeVideo> videos)> _cache = new();
    private static readonly TimeSpan _ttl = TimeSpan.FromHours(24);

    public YouTubeClient(HttpClient http, ILogger<YouTubeClient> logger)
    {
        _http = http;
        _logger = logger;
        _apiKey = Environment.GetEnvironmentVariable("YOUTUBE_API_KEY");
    }

    public bool IsConfigured => !string.IsNullOrEmpty(_apiKey);

    public async Task<List<YouTubeVideo>> SearchAsync(string query, int limit = 3, CancellationToken ct = default)
    {
        if (!IsConfigured || string.IsNullOrWhiteSpace(query))
            return new List<YouTubeVideo>();

        var cacheKey = $"{query.Trim().ToLowerInvariant()}::{limit}";
        if (_cache.TryGetValue(cacheKey, out var hit) && DateTime.UtcNow - hit.fetched < _ttl)
            return hit.videos;

        var url = $"https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&maxResults={limit}" +
                  $"&q={Uri.EscapeDataString(query)}&key={_apiKey}";

        try
        {
            using var resp = await _http.GetAsync(url, ct);
            if (!resp.IsSuccessStatusCode)
            {
                _logger.LogWarning("YouTube search failed {Status} for query '{Q}'", (int)resp.StatusCode, query);
                return new List<YouTubeVideo>();
            }
            await using var stream = await resp.Content.ReadAsStreamAsync(ct);
            using var doc = await JsonDocument.ParseAsync(stream, cancellationToken: ct);
            var videos = new List<YouTubeVideo>();
            if (doc.RootElement.TryGetProperty("items", out var items) && items.ValueKind == JsonValueKind.Array)
            {
                foreach (var item in items.EnumerateArray())
                {
                    if (!item.TryGetProperty("id", out var idEl) || !idEl.TryGetProperty("videoId", out var vidEl))
                        continue;
                    if (!item.TryGetProperty("snippet", out var snippet)) continue;
                    var videoId = vidEl.GetString() ?? "";
                    var title = snippet.TryGetProperty("title", out var t) ? t.GetString() ?? "" : "";
                    var channel = snippet.TryGetProperty("channelTitle", out var c) ? c.GetString() ?? "" : "";
                    var published = snippet.TryGetProperty("publishedAt", out var p) ? p.GetString() ?? "" : "";
                    string thumb = "";
                    if (snippet.TryGetProperty("thumbnails", out var th) && th.TryGetProperty("high", out var hi) &&
                        hi.TryGetProperty("url", out var hu))
                        thumb = hu.GetString() ?? "";
                    videos.Add(new YouTubeVideo(videoId, title, channel, thumb, published));
                }
            }
            _cache[cacheKey] = (DateTime.UtcNow, videos);
            return videos;
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "YouTube search exception for query '{Q}'", query);
            return new List<YouTubeVideo>();
        }
    }
}
