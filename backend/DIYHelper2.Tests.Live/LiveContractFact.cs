namespace DIYHelper2.Tests.Live;

/// <summary>
/// xUnit fact attribute that auto-skips unless the live-contract opt-in
/// env vars are present. Two conditions must be true to run the test:
///
///   1. <c>RUN_LIVE_CONTRACT=true</c> — global flag, off by default so
///      `npm run validate` / `dotnet test` never accidentally hits real APIs.
///   2. The per-provider key env var named in <see cref="RequiredEnv"/> must
///      be set. Lets a single workflow exercise just the providers whose
///      secrets exist.
/// </summary>
[AttributeUsage(AttributeTargets.Method)]
public sealed class LiveContractFactAttribute : FactAttribute
{
    public LiveContractFactAttribute(string requiredEnv)
    {
        RequiredEnv = requiredEnv;
        var optIn = Environment.GetEnvironmentVariable("RUN_LIVE_CONTRACT");
        var providerKey = Environment.GetEnvironmentVariable(requiredEnv);
        if (!string.Equals(optIn, "true", StringComparison.OrdinalIgnoreCase))
        {
            Skip = $"RUN_LIVE_CONTRACT is not 'true' — set it + {requiredEnv} to run live contract suite.";
        }
        else if (string.IsNullOrEmpty(providerKey))
        {
            Skip = $"{requiredEnv} is not set — live contract suite needs the real provider key.";
        }
    }

    public string RequiredEnv { get; }
}
