# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

DIYHelper2 is a full-stack mobile app for AI-powered DIY project assistance. Users capture photos/videos of home repair issues, describe problems via voice or text, and receive AI-generated step-by-step repair guides (powered by OpenAI GPT-4o).

## Architecture

**Monorepo with two independent projects:**

- **`app/`** — React Native 0.83 + Expo SDK 55 mobile app (JavaScript, not TypeScript enforced)
- **`backend/DIYHelper2.Api/`** — ASP.NET Core 10.0 minimal API (C#)

The frontend sends base64-encoded images + text descriptions to the backend, which forwards them to OpenAI's GPT-4o vision model and returns structured JSON (title, steps, tools, difficulty, cost, YouTube links, shopping links, safety tips).

### Frontend Architecture (app/)

- **Entry:** `index.js` → `App.js` (navigation setup)
- **Navigation:** Drawer (root) containing a Stack navigator. Drawer routes: NewProject (CaptureStack), HoneyDoList, ContractorList. Stack routes: Capture → Result → Safety → ProjectDetail → WorkshopSteps
- **API layer:** `src/api/backendClient.js` — main HTTP client using fetch. `src/config/api.js` — base URL config (dev uses local IP, prod uses `api.diyhelper.org`)
- **Storage:** AsyncStorage with two keys: `@honey_do_list` (DIY projects) and `@contractor_list` (pro projects). CRUD helpers in `src/utils/storage.js`
- **Theme:** Centralized design tokens in `src/theme.js` — colors (primary: #FCA004 orange, secondary: #0A4FA6 blue), spacing, border radius
- **Media:** react-native-image-picker for photos/video, expo-speech-recognition for voice-to-text, expo-audio for recording, react-native-tts for text-to-speech

### Backend Architecture (backend/DIYHelper2.Api/)

- **Single-file API:** `Program.cs` contains all route handlers (minimal API pattern, no separate controller classes for main routes)
- **Endpoints:** `POST /api/analyze` (image+text → AI guide), `POST /api/ask-helper` (contextual follow-up questions), `GET /api/health`
- **Config:** OpenAI key via `OPENAI_API_KEY` env var. 50MB max request body. 2-minute timeout for OpenAI calls
- **Deployment:** AWS Elastic Beanstalk (`.ebextensions/`)

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