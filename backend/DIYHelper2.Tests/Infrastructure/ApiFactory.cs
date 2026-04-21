using System.Data.Common;
using DIYHelper2.Api.AI;
using DIYHelper2.Api.Data;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;

namespace DIYHelper2.Tests.Infrastructure;

/// <summary>
/// Test host factory for API integration tests. Replaces the file-backed
/// SQLite registration with an in-memory SQLite connection that lives for
/// the lifetime of the factory — this keeps tests isolated and parallelizable
/// while still exercising the real EF Core + SQLite stack (important because
/// Program.cs runs raw <c>CREATE TABLE IF NOT EXISTS</c> statements that the
/// EF InMemory provider would reject).
///
/// <para>
/// Tests that need to stub the AI client can read <see cref="FakeAi"/> and
/// set <see cref="FakeAIVisionClient.Responder"/> to return canned JSON
/// for each call. The default responder returns <c>"{}"</c>.
/// </para>
/// </summary>
public class ApiFactory : WebApplicationFactory<Program>, IAsyncLifetime
{
    private DbConnection? _connection;

    /// <summary>
    /// Stub AI client shared by every request made through this factory.
    /// Tests set <c>FakeAi.Responder</c> to shape the canned AI response for
    /// their scenario. Also exposes <c>FakeAi.Requests</c> for assertions
    /// on what the handler sent.
    /// </summary>
    public FakeAIVisionClient FakeAi { get; } = new();

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        builder.UseEnvironment(Environments.Development);

        builder.ConfigureServices(services =>
        {
            // Remove the production DbContext registration.
            var dbDescriptors = services
                .Where(d => d.ServiceType == typeof(DbContextOptions<AppDbContext>)
                         || d.ServiceType == typeof(AppDbContext))
                .ToList();
            foreach (var d in dbDescriptors) services.Remove(d);

            // Shared open SQLite connection so every scope reuses the same
            // in-memory database for the duration of the factory.
            _connection = new SqliteConnection("DataSource=:memory:");
            _connection.Open();

            services.AddDbContext<AppDbContext>(options =>
            {
                options.UseSqlite(_connection);
            });

            // Replace the production IAIVisionClient with the test stub.
            // Last registration wins for GetRequiredService, so this shadows
            // the production factory registered in Program.cs.
            var aiDescriptors = services
                .Where(d => d.ServiceType == typeof(IAIVisionClient))
                .ToList();
            foreach (var d in aiDescriptors) services.Remove(d);
            services.AddSingleton<IAIVisionClient>(FakeAi);

            // AiKeyStore stays empty by default — keeps the "not configured"
            // 503 tests working. Tests that want to reach the AI path call
            // SetOpenAiKey() after Services is built.
        });
    }

    /// <summary>
    /// Populate the DI-resolved <see cref="AiKeyStore"/> with a non-empty
    /// key so AI-backed endpoints can reach the (stubbed) AI client. Call
    /// this from tests that want to exercise the full analyze pipeline.
    /// </summary>
    public void SetOpenAiKey(string key)
    {
        using var scope = Services.CreateScope();
        var store = scope.ServiceProvider.GetRequiredService<AiKeyStore>();
        store.OpenAiKey = key;
    }

    public Task InitializeAsync()
    {
        // Explicitly null out any AI keys Program.cs may have pulled from
        // ambient env vars at startup. Integration tests must be hermetic:
        // whether a developer happens to have OPENAI_API_KEY exported locally
        // should not change test behavior. Tests that need the key set call
        // SetOpenAiKey() explicitly.
        using var scope = Services.CreateScope();
        var store = scope.ServiceProvider.GetRequiredService<AiKeyStore>();
        store.OpenAiKey = null;
        store.AnthropicKey = null;
        return Task.CompletedTask;
    }

    public new async Task DisposeAsync()
    {
        if (_connection is not null)
        {
            await _connection.DisposeAsync();
            _connection = null;
        }
        await base.DisposeAsync();
    }
}
