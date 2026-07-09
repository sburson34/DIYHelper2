using System.Collections.Concurrent;

namespace DIYHelper2.Api.Services;

/// <summary>
/// Process-lifetime cache for Google Translate results plus the dedicated
/// HttpClient the translate endpoint uses. Keyed "source|target|text" →
/// translated. Long-term reuse is handled by the per-device AsyncStorage
/// cache in the app; this only de-dupes across devices within a process.
/// (Fixed, well-known host — no SSRF guard needed, same as before the move
/// out of Program.cs locals.)
/// </summary>
public class TranslationCache
{
    /// <summary>Upper bound on cached entries; beyond it new results are
    /// returned but not cached (same backstop as the original local).</summary>
    public const int MaxEntries = 50_000;

    public ConcurrentDictionary<string, string> Cache { get; } = new();

    public HttpClient Http { get; } = new() { Timeout = TimeSpan.FromSeconds(30) };
}
