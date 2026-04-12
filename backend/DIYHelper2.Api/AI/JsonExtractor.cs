using System.Text.Json;

namespace DIYHelper2.Api.AI;

public static class JsonExtractor
{
    public static string ExtractObject(string raw)
    {
        if (string.IsNullOrEmpty(raw)) return "{}";
        int first = raw.IndexOf('{');
        int last = raw.LastIndexOf('}');
        if (first >= 0 && last > first)
            return raw.Substring(first, last - first + 1);
        return raw;
    }

    public static JsonElement? TryParseObject(string raw)
    {
        var body = ExtractObject(raw);
        try
        {
            return JsonSerializer.Deserialize<JsonElement>(body);
        }
        catch (JsonException)
        {
            return null;
        }
    }
}
