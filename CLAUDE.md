# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

DIYHelper2 is a full-stack mobile app for AI-powered DIY project assistance. Users capture photos/videos of home repair issues, describe problems via voice or text, and receive AI-generated step-by-step repair guides. The backend can route vision requests to either OpenAI (GPT-4o) or Anthropic Claude — selected at runtime via the `AI_PROVIDER` env var; see `AI/AIClientFactory.cs`.

## Architecture

**Monorepo with two independent projects:**

- **`app/`** — React Native 0.83 + Expo SDK 55 mobile app (JavaScript, not TypeScript enforced)
- **`backend/DIYHelper2.Api/`** — ASP.NET Core 10.0 minimal API (C#)

The frontend sends base64-encoded images + text descriptions to the backend, which forwards them to OpenAI's GPT-4o vision model and returns structured JSON (title, steps, tools, difficulty, cost, YouTube links, shopping links, safety tips).

### Frontend Architecture (app/)

- **Entry:** `index.js` → `App.js` (navigation setup)
- **Navigation:** Drawer (root) containing a Stack navigator. Drawer routes: NewProject (CaptureStack), HoneyDoList, ContractorList, Inventory, ShoppingList, Diagnose, LiveCoach, Quotes, Community, Emergency, ReportProblem, Settings. CaptureStack routes: Capture → Result → Safety → ProjectDetail → WorkshopSteps → PaintMatch → Annotate → WorkshopAR → LiveHelp. An `OnboardingGate` in `App.js` wraps everything to handle first-launch onboarding + AI consent before mounting the navigator.
- **API layer:** `src/api/backendClient.js` — main HTTP client using fetch. `src/config/api.js` — base URL config (dev uses local IP, prod uses `api.diyhelper.org`)
- **Storage:** AsyncStorage with two keys: `@honey_do_list` (DIY projects) and `@contractor_list` (pro projects). CRUD helpers in `src/utils/storage.js`
- **Theme:** Centralized design tokens in `src/theme.js` — colors (primary: #FCA004 orange, secondary: #0A4FA6 blue), spacing, border radius
- **Media:** react-native-image-picker for photos/video, expo-speech-recognition for voice-to-text, expo-audio for recording, react-native-tts for text-to-speech

### Backend Architecture (backend/DIYHelper2.Api/)

- **Single-file API:** `Program.cs` contains most route handlers (minimal API pattern). Supporting code lives in `AI/`, `Integrations/`, `Middleware/`, `Models/`, `Data/`, `Services/`, and `Validation/`.
- **Core endpoints:** `POST /api/analyze` (image+text → AI guide), `POST /api/ask-helper` (contextual follow-up), `POST /api/verify-step`, `POST /api/diagnose`, `POST /api/clarify`, `POST /api/live-diy/analyze`, `POST /api/translate`, plus help-request, feedback, community-projects, delete-user-data, weather, reddit-discussions, safety-data, property-value-impact, receipt-ocr, paint-color-match, emergency, and features endpoints. Liveness: `GET /healthz` (Docker/Caddy probe); app health: `GET /api/health`.
- **Database:** EF Core. Postgres in production (`DATABASE_URL` env, typically loaded from AWS Secrets Manager via `SECRET_ARN`), SQLite locally. Migrations live in `Migrations/` and run via `db.Database.Migrate()` on startup; provider selection is in `Data/DatabaseConfig.cs`.
- **Config:** OpenAI key via `OPENAI_API_KEY` (or JSON-wrapped in Secrets Manager via `SECRET_ARN`); optional `ANTHROPIC_API_KEY`; `AI_PROVIDER` picks the backend. 50MB max request body. Per-IP rate-limiting buckets (`ai`, `translate`, `submit`). `ALLOWED_ORIGINS` whitelists web origins (empty by default — mobile doesn't need CORS).
- **Middleware pipeline** (order matters, set in `Program.cs`): `CorrelationIdMiddleware`, `SecurityHeadersMiddleware`, `AdminAuthMiddleware` (gates `/admin/*` + admin GETs), static files, CORS, rate limiter, `AppKeyMiddleware` (shared-secret header check, no-op if unset), `ExceptionHandlerMiddleware`, `RequestLoggingMiddleware`.
- **Observability:** OpenTelemetry traces + metrics (OTLP exporter when `OTEL_EXPORTER_OTLP_ENDPOINT` is set, console exporter in dev). Structured JSON logs to stdout in non-dev.
- **SSRF protection:** Every typed `HttpClient` for an external integration is wired with `SsrfGuardHandler` so DNS rebinding can't hit instance metadata or loopback.
- **Deployment:** Docker. `Dockerfile` builds a multi-stage `dotnet/aspnet:10.0-alpine` image (non-root, `EXPOSE 8080`). `.github/workflows/deploy.yml` builds linux/amd64+arm64 on push to main and pushes to `ghcr.io/sburson34/diyhelper-api:{latest,sha}`. Runs on the shared EC2 host (Caddy + docker-compose, managed in the `infrastructure-shared` repo) — not Elastic Beanstalk.

## Common Commands

### Frontend (run from `app/`)

```bash
npm install                    # install dependencies
npm start                      # start Metro bundler
npm run android                # build and run on Android
npm run ios                    # build and run on iOS
npm test                       # run Jest tests
npm run lint                   # run ESLint
```

### Backend (run from `backend/DIYHelper2.Api/`)

```bash
dotnet run                     # start API on http://localhost:5206
dotnet build                   # build without running
dotnet test                    # run tests (if test project exists)
```

### Phone Proxy for Local Dev

```bash
adb reverse tcp:5206 tcp:5206  # forward phone's localhost:5206 to PC
# or run setup-phone-proxy.ps1
```

## API Response Shape

The `/api/analyze` endpoint returns this JSON structure (important when modifying screens that display results):

```json
{
  "title": "", "steps": [], "tools_and_materials": [],
  "difficulty": "easy|medium|hard", "estimated_time": "", "estimated_cost": "",
  "youtube_links": [], "shopping_links": [{"item": "", "url": ""}],
  "safety_tips": [], "when_to_call_pro": []
}
```

## Key Patterns

- Navigation params carry data between screens (e.g., analysis results from Capture → Result → Safety)
- Projects saved to AsyncStorage include a `checkedSteps` map for tracking workshop progress
- The backend extracts JSON from GPT-4o responses by finding first `{` to last `}` (handles markdown code fences)
- Video media items are currently skipped in analysis (OpenAI vision API limitation)