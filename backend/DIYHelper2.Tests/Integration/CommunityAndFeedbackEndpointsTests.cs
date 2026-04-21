using System.Net;
using System.Net.Http.Json;
using DIYHelper2.Tests.Infrastructure;

namespace DIYHelper2.Tests.Integration;

public class CommunityAndFeedbackEndpointsTests : IClassFixture<ApiFactory>
{
    private readonly ApiFactory _factory;

    public CommunityAndFeedbackEndpointsTests(ApiFactory factory) => _factory = factory;

    [Fact]
    public async Task CommunityProjects_PostThenGetReturnsEntry()
    {
        var client = _factory.CreateClient();

        var title = $"Test project {Guid.NewGuid():N}";
        var createResp = await client.PostAsJsonAsync("/api/community-projects", new
        {
            title,
            description = "Bathroom tile regrouting",
            difficulty = "medium",
        });
        Assert.Equal(HttpStatusCode.Created, createResp.StatusCode);

        var listResp = await client.GetAsync("/api/community-projects");
        Assert.Equal(HttpStatusCode.OK, listResp.StatusCode);
        var body = await listResp.Content.ReadAsStringAsync();
        Assert.Contains(title, body);
    }

    [Fact]
    public async Task CommunityProjects_SearchFiltersByQuery()
    {
        var client = _factory.CreateClient();
        var uniqueWord = $"unicorn{Guid.NewGuid():N}";

        await client.PostAsJsonAsync("/api/community-projects", new
        {
            title = $"Project about {uniqueWord}",
            description = "nothing here",
        });
        await client.PostAsJsonAsync("/api/community-projects", new
        {
            title = "Totally unrelated",
            description = "also unrelated",
        });

        var filtered = await client.GetStringAsync($"/api/community-projects?q={uniqueWord}");
        Assert.Contains(uniqueWord, filtered);
        Assert.DoesNotContain("Totally unrelated", filtered);
    }

    [Fact]
    public async Task Feedback_PostPersistsAndListReturnsIt()
    {
        var client = _factory.CreateClient();

        var clientId = $"fb-{Guid.NewGuid():N}";
        var resp = await client.PostAsJsonAsync("/api/feedback", new
        {
            id = clientId,
            description = "Crash when tapping Save",
            whatYouWereDoing = "Filling out contact form",
            reproSteps = "1. open Settings 2. tap Save",
            metadata = new
            {
                appVersion = "1.0.0",
                platform = "android",
                osVersion = "33",
                environment = "beta",
            },
        });
        Assert.Equal(HttpStatusCode.Created, resp.StatusCode);

        var list = await client.GetStringAsync("/api/feedback");
        Assert.Contains(clientId, list);
        Assert.Contains("Crash when tapping Save", list);
    }
}
