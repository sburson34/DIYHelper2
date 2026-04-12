# Sentry setup for DIYHelper2

This app is **Expo prebuilt** (Expo SDK 55 + React Native 0.83 with a checked-in
`android/` folder, built via `react-native run-android`). The integration uses
`@sentry/react-native` together with the `@sentry/react-native/expo` config
plugin.

## What was changed

| File | Change |
|---|---|
| `package.json` | Added `@sentry/react-native` dependency |
| `app.json` | Added `@sentry/react-native/expo` to `expo.plugins` |
| `metro.config.js` | Wrapped config with `getSentryExpoConfig` so source maps get a debug-id |
| `index.js` | `initSentry()` runs before `App` import; root is wrapped with `Sentry.wrap` |
| `App.js` | `NavigationContainer` `ref` + `onReady` hand off to `navigationIntegration` for breadcrumbs |
| `src/config/sentry.js` | DSN / environment / release / sample-rate resolution (no secrets) |
| `src/services/sentry.js` | `initSentry`, `captureException`, `captureMessage`, `setUserContext`, `clearUserContext`, `setAppContext` + scrubbing |
| `src/screens/Settings.js` | `__DEV__`-only debug panel with 4 test buttons |
| `sentry.properties.example` | Template for the build-time auth token file |
| `.gitignore` | Excludes `sentry.properties`, source maps, `.sentryclirc` |

Existing `console.log` / `console.error` calls were left in place. The helpers
fall back to `console` when no DSN is configured, so feature code can call
`captureException` unconditionally.

## One-time install

```bash
cd app
npm install
# Optional but recommended after editing app.json plugins for a prebuilt project:
npx expo prebuild --platform android
```

`@sentry/react-native` includes a postinstall step that installs CocoaPods on
macOS for iOS — no-op on Windows.

## Configure secrets (manual steps)

1. **Create a Sentry project** (`react-native` platform). Copy the DSN.
2. **Local dev** — set in your shell or in `app/.env.local`:
   ```
   EXPO_PUBLIC_SENTRY_DSN=https://xxxx@oXXXX.ingest.sentry.io/XXXX
   EXPO_PUBLIC_APP_ENV=development   # or beta / production
   ```
   The DSN is read by `src/config/sentry.js` via `process.env.EXPO_PUBLIC_*`,
   which `babel-preset-expo` inlines at build time. You can also put it under
   `expo.extra.sentryDsn` in `app.json` if you'd rather not use env vars.
3. **Release / beta builds (source map upload)** — create
   `app/sentry.properties` (and `app/android/sentry.properties`) from
   `sentry.properties.example`, OR set these env vars before building:
   ```
   SENTRY_AUTH_TOKEN=...   # internal token, project:releases + org:read scopes
   SENTRY_ORG=your-org
   SENTRY_PROJECT=diyhelper2
   ```
   The `@sentry/react-native/expo` plugin reads these during `assembleRelease`
   and uploads source maps + native debug symbols automatically. Source maps
   are emitted with debug-ids by the wrapped Metro config.
4. **Beta tagging** — for a beta build set `EXPO_PUBLIC_APP_ENV=beta` so events
   are tagged `environment=beta` and the conservative 20% trace sample rate is
   used. Production defaults to 5%.

## What's captured

| Event type | How |
|---|---|
| Native crashes (Android) | Sentry's native Android SDK is auto-installed by the config plugin |
| Unhandled JS exceptions | Installed by `Sentry.init` global handler |
| Unhandled promise rejections | Same |
| Handled exceptions | Call `captureException(err, {...context})` |
| Navigation breadcrumbs | `navigationIntegration.registerNavigationContainer(navigationRef)` in `App.js` |
| Touch breadcrumbs | `Sentry.wrap(App)` in `index.js` |
| Release tag | `diyhelper2@<version>` from `app.json` (overridden by plugin in release builds) |
| Environment tag | `development` / `beta` / `production` |
| Device + app metadata | Default Sentry RN integrations (no PII) |

## Privacy / scrubbing

`src/services/sentry.js` runs every event through `beforeSend` and every
breadcrumb through `beforeBreadcrumb`:

- Header / body / extra / context keys matching `authorization`, `token`,
  `api_key`, `openai_api_key`, `password`, `cookie`, etc. → `[redacted]`
- Body keys named `media`, `image(s)`, `photo(s)`, `video(s)`, `base64`,
  `data` → replaced with a placeholder so raw user media never leaves the
  device. This matters because the app sends base64-encoded photos to
  `/api/analyze`.
- Strings >2 KB that look like base64 → replaced with `[redacted]:base64(Nb)`
- `sendDefaultPii: false`, cookies dropped, `console.debug` breadcrumbs dropped
- `setUserContext` only sets fields the caller passes — nothing is auto-pulled
  from `getUserProfile()`

## How to verify it works

1. Install and run the app:
   ```bash
   cd app
   EXPO_PUBLIC_SENTRY_DSN=... npm run android
   ```
2. Open the **drawer → Settings**, scroll to **"Sentry debug"**.
3. Tap each button in order:
   - **Send test message** → check Sentry → Issues filtered by `level:info`
     for `Sentry test message from Settings`.
   - **Throw handled exception** → look for `Sentry test: handled JS exception`.
     Should have an `extra: { source: settings_debug_panel }`.
   - **Throw unhandled exception** → app shows the red box in dev (expected);
     issue arrives in Sentry as `Sentry test: unhandled JS exception`.
   - **Trigger native crash** → confirms the native Android SDK is wired. The
     app will hard-crash; relaunch and check Sentry — the crash should appear
     within ~30 seconds with a native stack trace. **Only do this on a debug
     build you don't mind killing.**
4. Navigate around the drawer and stack a few times before triggering an
   exception, then confirm the breadcrumb timeline on the issue shows
   `navigation` entries like `Capture → Result → Safety`.
5. For source-map verification: build a release APK
   (`cd android && ./gradlew assembleRelease`) with `SENTRY_AUTH_TOKEN` /
   `SENTRY_ORG` / `SENTRY_PROJECT` set. The Gradle build should print
   `[sentry] Uploading source maps...`. Then trigger an exception in the
   release build and confirm the Sentry stack trace shows original
   filenames/line numbers (not minified `index.android.bundle:1:12345`).

## Manual steps still required

- [ ] Create the Sentry project and grab the DSN
- [ ] Set `EXPO_PUBLIC_SENTRY_DSN` (and `EXPO_PUBLIC_APP_ENV` for non-dev)
- [ ] Create `sentry.properties` from the example, OR set
      `SENTRY_AUTH_TOKEN` / `SENTRY_ORG` / `SENTRY_PROJECT` in your build env
- [ ] Run `cd app && npm install`
- [ ] Run `npx expo prebuild --platform android` so the new config plugin
      patches `android/app/build.gradle` with the Sentry Gradle plugin
      (this is what makes release builds upload symbols)
- [ ] (Optional) Configure Sentry alert rules / Slack integration
- [ ] (Optional, iOS later) When `ios/` is generated, copy `sentry.properties`
      there too and add `use_frameworks!` to the Podfile if needed

## Using the helper from feature code

```js
import { captureException, captureMessage, setUserContext, setAppContext } from '../services/sentry';

try {
  await analyzeProject(...);
} catch (e) {
  captureException(e, { description, mediaCount: media.length });
  throw e;
}

// On login / profile load:
setUserContext({ id: profile.id }); // do NOT pass email unless user opted in
setAppContext('prefs', { skillLevel, language });
```
