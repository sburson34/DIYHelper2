does the # Testing guide

Authoritative reference for how the DIYHelper2 repo is tested, how to run
the suites, what CI runs, and how to add new tests. Kept deliberately short
— the test code itself is the detailed spec.

## Philosophy

- **Regression protection over coverage theater.** Every test must describe a
  real behavior a user or caller depends on. Coverage numbers are a
  side-effect, not a goal.
- **Fast feedback first.** The default `test` target finishes in ~15 s. Slow
  suites (screen-smoke, integration, coverage) run in dedicated targets.
- **No network in tests.** `fetch` is globally mocked on the frontend; the
  backend integration tests spin up a real ASP.NET Core pipeline but hit
  an in-memory SQLite — no HTTP, no OpenAI, no AWS.
- **Production code determines tests, not the other way around.** We don't
  add hooks "for testability" if the code is fine without them. We do
  refactor when a test would otherwise be impossible (e.g. we exposed
  `Program` as a `public partial class` so `WebApplicationFactory` can host it).

## Testing shape

Roughly a "testing trophy" for this app:

```
             ┌───────────────────┐
             │ E2E / Maestro     │  ← manual dispatch CI; Android emu
             ├───────────────────┤
             │ Backend           │  ← WebApplicationFactory + real EF+SQLite
             │   integration     │    + stubbable IAIVisionClient
             ├───────────────────┤
             │ Screen / nav      │  ← @testing-library/react-native
             │  tests            │
             ├───────────────────┤
             │ Unit              │  ← logic, hooks, contexts, utilities,
             │                   │    models, middleware
             └───────────────────┘
```

## What is tested, by layer

### Frontend (`app/`, Jest + @testing-library/react-native)

| Area | Suite |
|---|---|
| API client (retry, caching, error shape, breadcrumbs) | `backendClient.test.js` |
| AsyncStorage wrappers (projects, prefs, caches) | `storage.test.js` |
| Feature-flag resolution with fallback | `features.test.js` |
| Sentry monitoring adapter | `monitoring.test.js`, `sentry.test.js` |
| Beta feedback submission | `feedback.test.js` |
| Push notifications (permissions, scheduling) | `notifications.test.js` |
| Hooks/contexts: i18n, theme, capture bus | `I18nContext.test.js`, `ThemeContext.test.js`, `captureBus.test.js` |
| Per-screen navigation params + focus | `*.nav.test.js` |
| Static navigation graph scan | `navigation-scan.test.js` |
| Error boundary fallback UI | `ScreenErrorBoundary.test.js` |
| Every screen renders without throwing | `screens.smoke.test.js` |

Global test setup lives in `app/jest.setup.js` — it stubs every native
module, Expo SDK, Sentry, TTS, speech recognition, vector icons, reanimated,
gesture handler, and i18n so each test file can focus on behavior.

### Backend (`backend/DIYHelper2.Tests/`, xUnit + Moq)

| Area | Suite |
|---|---|
| AI factory fallback chain (OpenAI → Anthropic) | `AIClientFactoryTests.cs` |
| ATTOM client value-add multipliers | `AttomClientTests.cs` |
| Feature flag env-var resolution | `FeatureFlagsTests.cs` |
| JSON extractor (markdown, nested, null) | `JsonExtractorTests.cs` |
| Correlation / exception / logging middleware | `MiddlewareTests.cs` |
| DTO records + defaults | `ModelsTests.cs` |
| Paint color palette matcher | `PaintColorClientTests.cs` |
| ExternalApiException shape | `ExternalApiExceptionTests.cs` |
| **API integration** | `Integration/*` |
| &emsp;Health + features + emergency endpoints | `HealthAndFeaturesEndpointsTests.cs` |
| &emsp;Help-requests CRUD | `HelpRequestsEndpointsTests.cs` |
| &emsp;Privacy deletion w/ per-email rate limit | `DeleteUserDataEndpointTests.cs` |
| &emsp;Community + feedback persistence | `CommunityAndFeedbackEndpointsTests.cs` |
| &emsp;AI endpoints 503 when not configured | `AiEndpointsNotConfiguredTests.cs` |
| &emsp;AI policy rate limiter → 429 | `RateLimiterTests.cs` |
| &emsp;`/api/analyze` full pipeline w/ stub AI | `AnalyzeEndpointTests.cs` |

Integration tests host the real minimal-API pipeline via
`WebApplicationFactory<Program>` (`Tests/Infrastructure/ApiFactory.cs`),
replacing the file-backed SQLite with an in-memory connection so runs are
hermetic and parallel-safe. The factory also replaces the production
`IAIVisionClient` with `FakeAIVisionClient` — integration tests can set a
canned responder (`factory.FakeAi.Responder = _ => "…json…"`) to exercise
the full AI pipeline without hitting OpenAI.

### E2E (`app/maestro/`, Maestro)

| Flow | Purpose | Live backend? |
|---|---|---|
| `smoke-launch.yaml` | App boots, first screen renders | No |
| `drawer-navigation.yaml` | Every drawer route mounts | No |
| `settings-theme.yaml` | Dark-mode toggle round-trips | No |
| `describe-analyze-save.yaml` | Golden path: describe → analyze → save | **Yes** |

See `app/maestro/README.md` for running locally + testID conventions.

## Commands

Every command works from the repo root. `bash scripts/test.sh <target>` is
the canonical entry point; per-project commands exist for when you want to
iterate in a single stack.

### Root (monorepo)

```bash
bash scripts/test.sh all            # lint + frontend + backend
bash scripts/test.sh fast           # skip slow smoke + integration (~90s)
bash scripts/test.sh fe             # all frontend
bash scripts/test.sh fe:unit        # frontend unit only
bash scripts/test.sh fe:nav         # frontend nav suites
bash scripts/test.sh fe:smoke       # frontend screen smoke (slow)
bash scripts/test.sh fe:coverage    # frontend + coverage report
bash scripts/test.sh be             # all backend
bash scripts/test.sh be:unit        # backend unit only (no WebAppFactory)
bash scripts/test.sh be:integration # backend integration only
bash scripts/test.sh be:coverage    # backend + XPlat coverage
bash scripts/test.sh lint           # eslint
bash scripts/test.sh build-verify   # dotnet publish smoke
bash scripts/test.sh help           # prints this list
```

### Frontend (`cd app/`)

```bash
npm test                 # all Jest suites
npm run test:fast        # skip screens.smoke
npm run test:unit        # skip nav + smoke
npm run test:nav         # only nav suites
npm run test:smoke       # only screens.smoke
npm run test:coverage    # with coverage (slow)
npm run test:watch       # watch mode
npm run lint             # eslint
```

### Backend (`cd backend/`)

```bash
dotnet test DIYHelper2.slnx
dotnet test DIYHelper2.slnx --filter "FullyQualifiedName~Integration"
dotnet test DIYHelper2.slnx --filter "FullyQualifiedName!~Integration"
dotnet test DIYHelper2.slnx --collect:"XPlat Code Coverage"
dotnet build DIYHelper2.slnx --configuration Release
```

## CI

Three workflows in `.github/workflows/`:

| File | When | Jobs | Goal |
|---|---|---|---|
| `pr.yml` | every push + PR | `frontend`, `backend` | Fast pass/fail; target <5 min. Lint + full Jest + full xUnit (no coverage). |
| `full.yml` | push to `main` + manual | `frontend-coverage`, `backend-coverage`, `build-verify-backend` | Coverage artifacts + `dotnet publish` smoke. |
| `nightly.yml` | 07:00 UTC + manual | `flaky-detect-*` (x3) | Runs the suites 3 times back-to-back to expose flakiness. |
| `e2e-maestro.yml` | Manual dispatch | `maestro` (macOS + Android emu) | Smoke + nav + theme flows; opt-in golden-path. |

Coverage artifacts from `full.yml`:
- `frontend-coverage`: `lcov.info`, `cobertura-coverage.xml`, `coverage-summary.json`
- `backend-coverage`: `coverage.cobertura.xml` + `.trx` test results

### Required secrets

None — the test suites are hermetic. The API key required to run the app
end-to-end is **never** loaded in CI. If you ever add E2E tests that need
a real OpenAI call, gate them behind a `workflow_dispatch` input so the
key is not exposed on every push.

## Coverage thresholds (frontend)

Set in `app/jest.config.js`:

| Metric | Threshold | Current |
|---|---|---|
| Statements | 70% | 74% |
| Branches | 55% | 57% |
| Functions | 65% | 78% |
| Lines | 70% | 77% |

Thresholds are **floors tied to current reality**, not aspirations. When
coverage *genuinely improves* we raise them; we do not start above the line
and chase tests to meet it.

The backend does not enforce a coverage gate — `dotnet test --collect
"XPlat Code Coverage"` produces the artifact, and we review trends rather
than fail a build on an arbitrary number. This can be tightened once the
coverage ratchet feels stable.

## Anti-flakiness rules

These are enforced by code review, not tooling:

1. **No arbitrary sleeps.** Use `act`/`await` for React Native state flushes
   and `IAsyncLifetime` for xUnit async setup/teardown.
2. **No real network.** `global.fetch` is mocked in `jest.setup.js`.
   `HttpClient` calls in the backend go through typed clients that take
   `HttpClient` via DI so a test can inject a handler if needed.
3. **No test-order dependencies.** Each test must pass in isolation. xUnit
   classes that mutate environment variables implement `IDisposable` and
   restore the prior value; see `FeatureFlagsTests`, `AttomClientTests`.
4. **Stable fixtures.** The integration `ApiFactory` is class-scoped via
   `IClassFixture<ApiFactory>` — one SQLite connection per test class,
   reset between tests via `Guid.NewGuid()` in row data where the test
   needs uniqueness. Tests that need cross-class isolation get their own
   fixture.
5. **Snapshot tests — none.** Snapshot tests rot and encourage "push to
   update". If a test wants to assert a string, it asserts the exact string.

## Known gaps & future work

- **Maestro golden-path depends on a live backend.** `describe-analyze-save`
  is gated behind a manual-dispatch flag because it talks to the real
  `/api/analyze`. Hermetic E2E would require running the ASP.NET test
  host on the emulator's localhost and pointing the app at it — worth
  doing when there's a repeatable failure we can't catch at the unit or
  integration layer.
- **Maestro iOS coverage.** Flows target the Android `appId` only. Once
  the iOS bundle ID is reserved and `eas.json` fills in the Apple fields,
  add a second emulator matrix job.
- **Other AI endpoints still wire ChatClient directly.** `/api/analyze`
  was migrated to `IAIVisionClient` + DI, but `/api/ask-helper`,
  `/api/verify-step`, `/api/diagnose`, `/api/clarify` still build a
  `ChatClient` inline. Each should follow the analyze pattern — stub
  the AI client, assert the prompt shape.
- **Lint warning baseline.** Lint errors are a hard CI gate (`pr.yml` fails
  on any new error). Warnings are capped at 200 via `--max-warnings` to
  preserve the current baseline (~163 mostly stylistic) without blocking;
  drop the cap as warnings are cleaned up.
- **Rate limiter test uses wall-clock bucket.** `RateLimiterTests.cs`
  assumes the `ai` policy drains in under a minute. If the suite ever runs
  on a box slow enough that 25 requests take >60 s, the window replenishes
  and the assertion fails. Runs in under a second today; revisit if that
  ever changes.

## Adding new tests

### Frontend

1. Pick a home: `app/src/__tests__/MyThing.test.js`.
2. Suite name matches `*.test.js` (Jest already discovers it).
3. Use `@testing-library/react-native` — prefer `render` + role/label
   queries over `ReactTestRenderer` snapshots.
4. Mock only what you must. `jest.setup.js` already stubs every native
   module; reach for `jest.mock()` only for production code that the test
   is not exercising.
5. For context/hook tests, `jest.unmock('../path')` + `jest.requireActual`
   is the pattern — see `I18nContext.test.js`.

### Backend

1. Unit tests in `backend/DIYHelper2.Tests/FooTests.cs`.
2. Integration tests in `backend/DIYHelper2.Tests/Integration/FooEndpointTests.cs`
   — use `IClassFixture<ApiFactory>` to host the real pipeline.
3. If a test mutates environment variables, implement `IDisposable` and
   restore them.
4. xUnit `[Theory]` + `[InlineData]` beats multiple near-identical `[Fact]`s;
   see `AttomClientTests.EstimateAsync_UsesCorrectMultiplier`.
