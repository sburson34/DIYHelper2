namespace DIYHelper2.Tests.Infrastructure;

/// <summary>
/// xUnit serial collection for test classes that mutate process-wide
/// environment variables (AI_KILL_SWITCH, OPENAI_API_KEY, MINDEE_API_KEY,
/// PLAY_INTEGRITY_*, etc.). Tests in this collection run sequentially with
/// every other test in the collection, so the env vars they set can't bleed
/// into a parallel test that just built a fresh DI container.
///
/// Tests that do NOT need env-mutation can stay outside this collection and
/// run in parallel against their own ApiFactory IClassFixture.
/// </summary>
[CollectionDefinition("SerialEnv", DisableParallelization = true)]
public class SerialEnvCollection { }
