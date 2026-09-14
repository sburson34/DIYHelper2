using DIYHelper2.Api.AI;
using Xunit;

namespace DIYHelper2.Tests;

public class JsonExtractorTests
{
    [Fact]
    public void ExtractObject_ReturnsEmptyObject_ForNullInput()
    {
        Assert.Equal("{}", JsonExtractor.ExtractObject(null!));
    }

    [Fact]
    public void ExtractObject_ReturnsEmptyObject_ForEmptyString()
    {
        Assert.Equal("{}", JsonExtractor.ExtractObject(""));
    }

    [Fact]
    public void ExtractObject_ExtractsJson_FromMarkdownCodeFence()
    {
        var raw = "```json\n{\"title\": \"Fix sink\"}\n```";
        var result = JsonExtractor.ExtractObject(raw);
        Assert.Equal("{\"title\": \"Fix sink\"}", result);
    }

    [Fact]
    public void ExtractObject_ExtractsJson_WithSurroundingText()
    {
        var raw = "Here is the result:\n{\"steps\": [\"1\", \"2\"]}\nDone.";
        var result = JsonExtractor.ExtractObject(raw);
        Assert.Equal("{\"steps\": [\"1\", \"2\"]}", result);
    }

    [Fact]
    public void ExtractObject_HandlesNestedBraces()
    {
        var raw = "{\"a\": {\"b\": 1}}";
        var result = JsonExtractor.ExtractObject(raw);
        Assert.Equal("{\"a\": {\"b\": 1}}", result);
    }

    [Fact]
    public void ExtractObject_ReturnsBareString_WhenNoBraces()
    {
        var raw = "no json here";
        Assert.Equal("no json here", JsonExtractor.ExtractObject(raw));
    }

    [Fact]
    public void TryParseObject_ReturnsJsonElement_ForValidJson()
    {
        var raw = "{\"title\": \"Test\"}";
        var result = JsonExtractor.TryParseObject(raw);
        Assert.NotNull(result);
        Assert.Equal("Test", result.Value.GetProperty("title").GetString());
    }

    [Fact]
    public void TryParseObject_ReturnsNull_ForInvalidJson()
    {
        var result = JsonExtractor.TryParseObject("not json {broken");
        Assert.Null(result);
    }

    [Fact]
    public void TryParseObject_ExtractsFromMarkdown()
    {
        var raw = "```\n{\"key\": 42}\n```";
        var result = JsonExtractor.TryParseObject(raw);
        Assert.NotNull(result);
        Assert.Equal(42, result.Value.GetProperty("key").GetInt32());
    }

    // ── Brace-depth scanning (replaced the old first-{ to last-} slice) ────

    [Fact]
    public void ExtractObject_StopsAtTheObjectEnd_NotAtTrailingProse()
    {
        // The old slice ran to the LAST '}' in the whole response, so any
        // commentary after the object that contained a brace got glued on and the
        // parse failed.
        var raw = "{\"title\":\"Fix sink\"}\n\nLet me know if that works :}";
        Assert.Equal("{\"title\":\"Fix sink\"}", JsonExtractor.ExtractObject(raw));
        Assert.NotNull(JsonExtractor.TryParseObject(raw));
    }

    [Fact]
    public void ExtractObject_IgnoresBracesInsideStringValues()
    {
        // A DIY guide legitimately says things like "use a 1/2\" fitting }".
        var raw = "prose {\"summary\":\"tighten the } fitting\",\"n\":1} more prose";
        var extracted = JsonExtractor.ExtractObject(raw);
        Assert.Equal("{\"summary\":\"tighten the } fitting\",\"n\":1}", extracted);

        var parsed = JsonExtractor.TryParseObject(raw);
        Assert.NotNull(parsed);
        Assert.Equal("tighten the } fitting", parsed.Value.GetProperty("summary").GetString());
    }

    [Fact]
    public void ExtractObject_HandlesEscapedQuotesBeforeABrace()
    {
        // The escaped quote must not be read as closing the string, or the brace
        // that follows would be counted as structure.
        var raw = "{\"note\":\"a 1/2\\\" gap }\",\"ok\":true}";
        var parsed = JsonExtractor.TryParseObject(raw);
        Assert.NotNull(parsed);
        Assert.True(parsed.Value.GetProperty("ok").GetBoolean());
    }

    [Fact]
    public void ExtractObject_TakesTheFirstCompleteObject_WhenTwoAreReturned()
    {
        var raw = "{\"a\":1}\n{\"b\":2}";
        Assert.Equal("{\"a\":1}", JsonExtractor.ExtractObject(raw));
    }

    [Fact]
    public void ExtractObject_FallsBackToWidestSlice_WhenBracesNeverBalance()
    {
        // Truncated completion: no closing brace for the outer object. Returning
        // the best-effort slice keeps the old behaviour for a salvageable case.
        var raw = "{\"a\": {\"b\": 1}";
        Assert.Equal("{\"a\": {\"b\": 1}", JsonExtractor.ExtractObject(raw));
    }
}
