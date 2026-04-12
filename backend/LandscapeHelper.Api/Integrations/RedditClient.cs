using System.Collections.Concurrent;
using System.Text.Json;

namespace DIYHelper2.Api.Integrations;

public record RedditThread(
    string Title,
    string Url,
    string Subreddit,
    int Upvotes,
    int NumComments,
    string Excerpt
);

public class RedditClient
{
    private readonly HttpClient _http;
    private readonly ILogger<RedditClient> _logger;

    // 24h cache
    private static readonly ConcurrentDictionary<string, (DateTime fetched, List<RedditThread> threads)> _cache = new();
    private static readonly TimeSpan _ttl = TimeSpan.FromHours(24);

    public RedditClient(HttpClient http, ILogger<RedditClient> logger)
    {
        _http = http;
        _logger = logger;
        if (!_http.DefaultRequestHeaders.Contains("User-Agent"))
            _http.DefaultRequestHeaders.TryAddWithoutValidation("User-Agent", "DIYHelper2/1.0 (by /u/diyhelper)");
    }

    public async Task<List<RedditThread>> SearchAsync(string query, int limit = 5, CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(query)) return new List<RedditThread>();
        var cacheKey = $"{query.Trim().ToLowerInvariant()}::{limit}";
        if (_cache.TryGetValue(cacheKey, out var hit) && DateTime.UtcNow - hit.fetched < _ttl)
            return hit.threads;

        var url = $"https://www.reddit.com/r/HomeImprovement+DIY+HomeOwners+Fixit/search.json?" +
                  $"q={Uri.EscapeDataString(query)}&restrict_sr=1&sort=top&limit={limit}&t=year";

        try
        {
            using var resp = await _http.GetAsync(url, ct);
            if (!resp.IsSuccessStatusCode)
            {
                _logger.LogWarning("Reddit search failed {Status} for '{Q}'", (int)resp.StatusCode, query);
                return new List<RedditThread>();
            }
            using var doc = JsonDocument.Parse(await resp.Content.ReadAsStringAsync(ct));
            var threads = new List<RedditThread>();
            if (doc.RootElement.TryGetProperty("data", out var data) &&
                data.TryGetProperty("children", out var children) && children.ValueKind == JsonValueKind.Array)
            {
                foreach (var child in children.EnumerateArray())
                {
                    if (!child.TryGetProperty("data", out var d)) continue;
                    string title = d.TryGetProperty("title", out var t) ? t.GetString() ?? "" : "";
                    string permalink = d.TryGetProperty("permalink", out var pl) ? pl.GetString() ?? "" : "";
                    string sub = d.TryGetProperty("subreddit", out var s) ? s.GetString() ?? "" : "";
                    int ups = d.TryGetProperty("ups", out var u) ? u.GetInt32() : 0;
                    int nc = d.TryGetProperty("num_comments", out var nn) ? nn.GetInt32() : 0;
                    string selftext = d.TryGetProperty("selftext", out var st) ? st.GetString() ?? "" : "";
                    var excerpt = selftext.Length > 240 ? selftext.Substring(0, 240) + "…" : selftext;
                    threads.Add(new RedditThread(
                        title,
                        $"https://reddit.com{permalink}",
                        sub,
                        ups,
                        nc,
                        excerpt
                    ));
                }
            }
            _cache[cacheKey] = (DateTime.UtcNow, threads);
            return threads;
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Reddit search exception for '{Q}'", query);
            return new List<RedditThread>();
        }
    }
}
