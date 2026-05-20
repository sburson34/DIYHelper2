namespace DIYHelper2.Tests.Infrastructure;

/// <summary>
/// Variant of <see cref="ApiFactory"/> that flips <c>AI_KILL_SWITCH=true</c>
/// before the host is built. <see cref="DIYHelper2.Api.Integrations.FeatureFlags"/>
/// caches the env var in its constructor as a singleton, so this is the only
/// reliable way to assert the gate is enforced on every AI route from a
/// single, dedicated test fixture.
///
/// <para>
/// Inherits the new <see cref="ApiFactory"/> (which itself inherits
/// <see cref="Sburson.Shared.Testing.BaseApiFactory{TProgram}"/>), so it gets
/// Testcontainers Postgres + SQLite-fallback for free.
/// </para>
///
/// Restores the previous value of the env var on dispose to keep other test
/// classes hermetic.
/// </summary>
public class KillSwitchApiFactory : ApiFactory
{
    private readonly string? _previousValue;

    public KillSwitchApiFactory()
    {
        _previousValue = Environment.GetEnvironmentVariable("AI_KILL_SWITCH");
        Environment.SetEnvironmentVariable("AI_KILL_SWITCH", "true");
    }

    public new async Task DisposeAsync()
    {
        Environment.SetEnvironmentVariable("AI_KILL_SWITCH", _previousValue);
        await base.DisposeAsync();
    }
}
