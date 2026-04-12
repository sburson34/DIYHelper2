# Beta monitoring checklist

## What's installed

### Mobile app (React Native)

| Component | What it does |
|---|---|
| `@sentry/react-native` + Expo plugin | Native crash capture, unhandled JS exceptions, session tracking |
| `src/services/sentry.js` | Sentry init with `beforeSend`/`beforeBreadcrumb` scrubbing |
| `src/services/monitoring.js` | Public API: `reportError`, `reportHandledError`, `reportWarning`, `addBreadcrumb` |
| `src/config/appInfo.js` | Runtime metadata: version, build number, git commit, platform, environment |
| `src/api/backendClient.js` | Correlation ID generation, request timing, HTTP breadcrumbs, AI-action breadcrumbs |
| `src/components/ScreenErrorBoundary.js` | React error boundaries on Capture, Result, Diagnose screens |
| `src/services/feedback.js` | "Report a Problem" form → Sentry event + local AsyncStorage |
| `src/screens/Settings.js` | `__DEV__`-only debug panel: test warning, handled exception, unhandled exception, native crash |

### Backend (.NET)

| Component | What it does |
|---|---|
| `CorrelationIdMiddleware` | Reads `X-Correlation-ID` from mobile app, generates one if missing, pushes to log scope, echoes in response |
| `RequestLoggingMiddleware` | Structured log per API request: method, path, status, duration |
| `ExceptionHandlerMiddleware` | Classifies exceptions, logs full details, returns safe JSON with correlation ID |
| `AiWorkflow.cs` | Wraps all OpenAI calls with structured start/success/failure logging and error classification |
| `ApiError.cs` | Standardized error response format: `{ error, code, correlationId }` |
| OpenTelemetry | Traces (ASP.NET Core + HttpClient) and metrics (runtime, HTTP), OTLP-ready |
| JSON console logging | Structured one-line JSON per event in production, CloudWatch-parseable |
| `appsettings.Production.json` | Tight levels: app code at Information, framework noise at Warning |

---

## Required environment variables

### Mobile app (build-time)

| Variable | Required? | Purpose |
|---|---|---|
| `EXPO_PUBLIC_SENTRY_DSN` | No (hardcoded fallback in app.json) | Sentry DSN override |
| `EXPO_PUBLIC_APP_ENV` | Yes for beta builds | Set to `beta` for 20% trace sample rate |
| `EXPO_PUBLIC_GIT_COMMIT` | Optional | `$(git rev-parse --short HEAD)` — tagged in Sentry release |
| `SENTRY_AUTH_TOKEN` | Yes for release builds | Uploads source maps. Scopes: `project:releases`, `org:read` |
| `SENTRY_ORG` | Yes for release builds | Sentry organization slug |
| `SENTRY_PROJECT` | Yes for release builds | Sentry project slug |

### Backend (runtime)

| Variable | Required? | Purpose |
|---|---|---|
| `ASPNETCORE_ENVIRONMENT` | Yes | Set to `Production` on EB (controls JSON logging, log levels) |
| `SECRET_ARN` or `OPENAI_API_KEY` | Yes | OpenAI API key |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | No | Set to `http://localhost:4317` when ADOT sidecar is running |
| `OTEL_SERVICE_NAME` | No | Defaults to `diyhelper2-api` |

---

## Sensitive data exclusions

The following are intentionally never sent to Sentry, logs, or telemetry:

| Data | Where excluded |
|---|---|
| OpenAI API key | Never referenced in any log or telemetry call |
| Auth tokens / `Authorization` headers | Scrubbed by `sentry.js` `beforeSend`; not logged in backend middleware |
| Base64 image/video payloads | Replaced with `[redacted]:base64(Nb)` in Sentry; backend logs only `imageCount` |
| Full user descriptions/prompts | Backend logs only `descriptionLength`; Sentry scrubs large strings |
| Full AI response text | Backend logs only `responseLength` |
| Raw request/response bodies | Not captured in HTTP breadcrumbs; `backendClient.js` only logs path/status/duration |
| User email/phone | Only sent if user explicitly enters it in feedback; not auto-attached |
| Stack traces in client responses | Backend returns safe `{ error, code, correlationId }` in beta/prod; `debug` field only in Development |

---

## Test plan

### 1. Handled client exception

1. Open the app in dev mode.
2. Drawer → Settings → scroll to "Sentry debug".
3. Tap **Throw handled exception**.
4. Confirm alert says "Handled exception captured".
5. In Sentry → Issues, search for `Sentry test: handled JS exception`.
6. Verify the event has `extra.source = settings_debug_panel` and `extra.handled = true`.

### 2. Unhandled client exception

1. In the same debug panel, tap **Throw unhandled exception**.
2. The app shows a red box in dev (expected).
3. In Sentry → Issues, search for `Sentry test: unhandled JS exception`.
4. Verify the breadcrumb timeline shows navigation and touch events leading up to it.

### 3. Failed API request

1. Stop the backend (or disconnect `adb reverse`).
2. In the app, enter a description and tap **Get DIY Guide**.
3. The app shows a network error alert.
4. In Sentry, find the error event. Verify it includes:
   - `extra.correlationId` (e.g. `m1abc-xf9k-1`)
   - `extra.operation = analyzeProject`
   - Breadcrumb timeline: `[ai] AI: analyze project` → `[http] POST /api/analyze` → `[http] POST /api/analyze network error`

### 4. Verify correlation IDs

1. Start the backend and connect via `adb reverse tcp:5206 tcp:5206`.
2. Submit an analysis request from the app.
3. In the backend logs, find the structured log line:
   ```
   AI call started: analyze model=gpt-4o ... correlationId=<ID>
   ```
4. In the mobile app's HTTP breadcrumbs (visible in Sentry on the next error), confirm the same `correlationId` appears in the `[http] POST /api/analyze` breadcrumb data.
5. Confirm the response header `X-Correlation-ID` matches (visible in dev tools or by logging `response.headers` temporarily).

### 5. Error boundary test

1. Temporarily add `throw new Error('boundary test')` to the first line of `ResultScreen`'s render.
2. Navigate to Result. The error boundary should show "Something went wrong" with a "Try again" button.
3. In Sentry, verify the event has `source = ResultScreen` and includes `componentStack`.
4. Remove the test throw.

### 6. Backend exception classification

1. With the backend running, send a malformed JSON body to `/api/analyze`:
   ```bash
   curl -X POST http://localhost:5206/api/analyze -H "Content-Type: application/json" -d "not json"
   ```
2. Verify the response is `{ "error": "The request was malformed...", "code": "bad_request", "correlationId": "..." }`.
3. In backend logs, confirm the structured error log includes the correlation ID and `ErrorCode=bad_request`.

### 7. Beta feedback flow

1. Drawer → Report a Problem.
2. Fill in "Test problem report" and tap Submit.
3. In Sentry → Issues, filter by `tag:feedback:true`. Verify the event includes metadata (app version, platform, screen).

---

## Manual setup still needed

### Sentry

- [ ] Create a Sentry project (platform: `react-native`) if not done.
- [ ] Copy the DSN — it's currently hardcoded in `app.json` as the fallback.
- [ ] Create an internal auth token with `project:releases` + `org:read` scopes for source map uploads.
- [ ] (Optional) Set up Sentry alert rules (e.g. Slack notification on new issues, spike in error rate).

### AWS / Elastic Beanstalk

- [ ] Set `ASPNETCORE_ENVIRONMENT=Production` in EB environment properties.
- [ ] Verify IAM instance profile has `logs:CreateLogGroup`, `logs:CreateLogStream`, `logs:PutLogEvents`.
- [ ] After deploy, confirm CloudWatch log group `/aws/elasticbeanstalk/<env>/var/log/web.stdout.log` exists and contains JSON.
- [ ] (Optional) Add ADOT sidecar and set `OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4317` for X-Ray traces.
- [ ] (Optional) Create CloudWatch Logs Insights saved query: errors by correlation ID.
- [ ] (Optional) Create CloudWatch Alarm on metric filter for `"LogLevel":"Error"`.

### Source maps (per release)

Build beta APKs with:
```bash
EXPO_PUBLIC_APP_ENV=beta \
EXPO_PUBLIC_GIT_COMMIT=$(git rev-parse --short HEAD) \
SENTRY_AUTH_TOKEN=... \
SENTRY_ORG=burson-properties \
SENTRY_PROJECT=react-native \
cd app/android && ./gradlew assembleRelease
```
The Sentry Gradle plugin uploads source maps automatically during `assembleRelease`.
