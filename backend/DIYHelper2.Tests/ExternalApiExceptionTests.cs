using DIYHelper2.Api.Integrations;
using Xunit;

namespace DIYHelper2.Tests;

public class ExternalApiExceptionTests
{
    [Fact]
    public void Constructor_SetsAllProperties()
    {
        var inner = new Exception("inner");
        var ex = new ExternalApiException("ATTOM", "API failed", 502, inner);

        Assert.Equal("ATTOM", ex.Service);
        Assert.Equal("API failed", ex.Message);
        Assert.Equal(502, ex.StatusCode);
        Assert.Same(inner, ex.InnerException);
    }

    [Fact]
    public void Constructor_AllowsNullOptionalParams()
    {
        var ex = new ExternalApiException("PubChem", "Not found");

        Assert.Equal("PubChem", ex.Service);
        Assert.Equal("Not found", ex.Message);
        Assert.Null(ex.StatusCode);
        Assert.Null(ex.InnerException);
    }

    [Fact]
    public void IsException()
    {
        var ex = new ExternalApiException("Test", "msg");
        Assert.IsAssignableFrom<Exception>(ex);
    }
}
