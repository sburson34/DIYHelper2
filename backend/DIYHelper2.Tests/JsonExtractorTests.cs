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
}
