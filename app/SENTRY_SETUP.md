# Sentry — DIYHelper2 mobile app

This app uses **`@sentry/react-native`** (the correct package for an Expo
prebuild / bare RN project — `sentry-expo` is deprecated).

## What was wired up

| File | Change |
| --- | --- |
| `app/src/utils/sentry.js` | New. Central init + helpers (`captureException`, `captureMessage`, `setUserContext`, `setAppContext`, `wrap`). beforeSend scrubs auth tokens, API keys, base64 images, and large strings. |
| `app/src/utils/sentryTest.js` | New. `triggerHandledException`, `triggerUnhandledException`, `triggerNativeCrash` (the last is `__DEV__`-gated). |
| `app/index.js` | Calls `initSentry()` before `App` is registered. |
| `app/App.js` | Imports `wrap` + `navigationIntegration`, attaches a `useNavigationContainerRef()` to `NavigationContainer`, registers it on `onReady`, and exports `Sentry.wrap(App)` so JS errors hit the boundary. |
| `app/app.json` | Adds the `@sentry/react-native/expo` plugin and an `extra` block with `sentryDsn` / `sentryEnvironment` / `sentryRelease` slots. **No real DSN is committed.** |
| `app/package.json` | Adds `@sentry/react-native` dependency. |
| `app/src/screens/Settings.js` | Adds a `__DEV__`-gated "Sentry Test" section with the three trigger buttons. |

## Manual steps you still need to do

### 1. Install the package

```bash
cd app
npm install
# (or: npm install @sentry/react-native@^6.10.0)
```

### 2. Provide the DSN (no secrets in git)

Pick **one** of these:

- **Recommended for CI / EAS:** export at build time
  ```bash
  export SENTRY_DSN="https://<key>@oXXXX.ingest.sentry.io/<project>"
  export SENTRY_ENVIRONMENT="beta"          # or production
  export SENTRY_RELEASE="diyhelper2@1.0.0+12"
  ```
  These are read by `src/utils/sentry.js` via `process.env.*`.

- **For local dev only:** put it in `app.json` under `expo.extra.sentryDsn`.
  Do **not** commit a production DSN this way.

### 3. Provide the source-map upload credentials

Create `app/sentry.properties` (already gitignored by most RN templates —
verify it is in your `.gitignore`):

```
defaults.url=https://sentry.io/
defaults.org=YOUR_ORG_SLUG
defaults.project=YOUR_PROJECT_SLUG
auth.token=YOUR_INTERNAL_INTEGRATION_TOKEN
```

Or, equivalently, export `SENTRY_ORG`, `SENTRY_PROJECT`, `SENTRY_AUTH_TOKEN`
in your build environment. The `@sentry/react-native/expo` config plugin
picks these up and wires source-map upload into both Android and iOS
release builds during `expo prebuild` / native build time.

### 4. Re-run prebuild so the plugin patches native projects

Because `android/` is committed, you need to re-run the Expo prebuild step
once after adding the plugin so it can install:

- the `sentry.gradle` apply line in `android/app/build.gradle`
- the `Upload Debug Symbols to Sentry` build phase in the iOS project

```bash
cd app
npx expo prebuild --clean
```

> If you prefer to keep your existing native edits, you can instead add
> these lines manually:
>
> **`android/app/build.gradle`** (top of file, before `android { ... }`):
> ```gradle
> apply from: new File(["node", "--print", "require.resolve('@sentry/react-native/package.json')"].execute(null, rootDir).text.trim()).getParentFile(), "sentry.gradle"
> ```
>
> **iOS:** open the Xcode project, select the app target → Build Phases →
> add a new "Run Script" phase containing
> `../node_modules/@sentry/react-native/scripts/sentry-xcode.sh "$PROJECT_DIR/../node_modules/react-native/scripts/react-native-xcode.sh"`
> and an "Upload Debug Symbols" phase pointing at
> `../node_modules/@sentry/react-native/scripts/sentry-xcode-debug-files.sh`.

### 5. Build a beta and verify

```bash
cd app
SENTRY_ENVIRONMENT=beta SENTRY_RELEASE="diyhelper2@1.0.0+beta" npm run android
```

Then in the running app:

1. Open the drawer → **Settings**.
2. Scroll to **Sentry Test (dev only)**.
3. Tap **Send handled exception** — should appear in Sentry within ~10s.
4. Tap **Throw unhandled JS exception** — should appear under the same project.
5. Tap **Force native crash** → confirm. The app will close. Re-open it; the
   crash event uploads on next launch.

In Sentry's UI you should see:

- environment = `development` / `beta` / `production`
- release tag matching `SENTRY_RELEASE`
- breadcrumbs showing navigation transitions (because of the
  `reactNavigationIntegration`)
- tags `platform.os`, `platform.version`, `app.version`
- device context populated by the native SDK

## Using the helper from app code

```js
import { captureException, captureMessage, setUserContext, setAppContext } from '../utils/sentry';

try {
  await analyze(payload);
} catch (err) {
  captureException(err, { tags: { area: 'analyze' }, extra: { mediaCount: media.length } });
  throw err;
}

captureMessage('user enabled community opt-in', 'info');
setUserContext({ id: anonymousId });          // pass null to clear
setAppContext('lastAnalyze', { ok: true });
```

All helpers are no-ops if no DSN was configured, so they are safe to call
from anywhere without conditional guards.

## What is filtered before send

- Any object key matching
  `authorization | api[_-]?key | access[_-]?token | refresh[_-]?token | token | password | secret | cookie`
  is replaced with `[Filtered]`.
- Strings starting with `data:image/` over 1 KB are replaced with
  `[Filtered base64 image]` (so user-captured photos never leave the device).
- Strings over 8 KB are truncated to 256 chars + a marker.
- HTTP breadcrumbs have `?token=` / `?api_key=` query params filtered.
- `sendDefaultPii: false` so IPs aren't attached.
