using System.Text.Json;

namespace DIYHelper2.Api.AI;

/// <summary>
/// Pulls the JSON object out of a raw model response.
///
/// <para>Every AI endpoint asks for "JSON only", but models routinely wrap the
/// answer in a markdown fence or a sentence of preamble, so the payload has to be
/// located rather than parsed directly.</para>
///
/// <para><b>Why not first-<c>{</c> to last-<c>}</c>.</b> That was the original
/// approach and it mis-slices whenever a brace appears inside a string value —
/// <c>{"summary":"use a 1/2\" fitting }"}</c>, or any trailing prose after the
/// object that happens to contain <c>}</c>. It also silently accepted a fenced
/// object followed by commentary. Scanning with brace depth, while skipping over
/// string literals and their escapes, finds the actual end of the first complete
/// object instead. The old behaviour is kept only as a fallback for a response
/// whose braces never balance (a truncated completion), where a best-effort slice
/// still beats returning nothing.</para>
/// </summary>
public static class JsonExtractor
{
    public static string ExtractObject(string raw)
    {
        if (string.IsNullOrEmpty(raw)) return "{}";

        int first = raw.IndexOf('{');
        if (first < 0) return raw;

        var depth = 0;
        var inString = false;
        var escaped = false;

        for (var i = first; i < raw.Length; i++)
        {
            var c = raw[i];

            if (inString)
            {
                // A backslash escapes the next character, including a quote or
                // another backslash — so track it rather than closing the string
                // on the first quote we happen to see.
                if (escaped) escaped = false;
                else if (c == '\\') escaped = true;
                else if (c == '"') inString = false;
                continue;
            }

            switch (c)
            {
                case '"':
                    inString = true;
                    break;
                case '{':
                    depth++;
                    break;
                case '}':
                    depth--;
                    // Balanced: this is the end of the first complete object.
                    if (depth == 0) return raw.Substring(first, i - first + 1);
                    break;
            }
        }

        // Never balanced (truncated response). Fall back to the widest plausible
        // slice so a caller that can still salvage something gets the chance.
        int last = raw.LastIndexOf('}');
        return last > first ? raw.Substring(first, last - first + 1) : raw;
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
