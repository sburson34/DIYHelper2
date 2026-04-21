# Maestro E2E flows

Black-box flows that drive the installed app through a real device or emulator.
Live above the Jest suites as the top tier of the testing shape. Owned by this
repo, not by a third-party cloud service.

## What's here

| Flow | Purpose | Network required? |
|---|---|---|
| `smoke-launch.yaml` | App launches, first screen renders, no crash banner | No |
| `drawer-navigation.yaml` | Drawer routes all mount without throwing | No |
| `settings-theme.yaml` | Dark-mode toggle round-trips through AsyncStorage | No |
| `describe-analyze-save.yaml` | Golden path: describe → analyze → save to Honey Do | **Yes** |

`config.yaml` holds the shared `appId`. Individual flows repeat `appId`
at the top because Maestro CLI can invoke single files directly and that
only works if the flow is self-contained.

## Running locally

1. Install the Maestro CLI: `brew tap mobile-dev-inc/tap && brew install maestro`
   (macOS/Linux) or follow <https://maestro.mobile.dev/getting-started/installing-maestro>.
2. Build and install a debug APK on an emulator or connected device:
   ```bash
   cd app
   npm run android
   ```
   (This takes a while the first time — ~5 min on a cold gradle cache.)
3. Run a single flow:
   ```bash
   maestro test maestro/smoke-launch.yaml
   ```
   Or all flows:
   ```bash
   maestro test maestro/
   ```
4. For the golden-path flow, the backend must be reachable. Either:
   - Run a local backend: `cd backend/DIYHelper2.Api && dotnet run`,
     plus `adb reverse tcp:5206 tcp:5206` (or use `setup-phone-proxy.ps1`).
   - Or point the app at the deployed backend (default in release builds).

## Watching a run

`maestro studio` opens an inspector that mirrors your device's screen and
lets you click elements to generate YAML — useful when tightening selectors
(`id: "foo"` beats text matching once you add testIDs).

## testIDs

Flows prefer `id:` over text matching where possible. testIDs are optional
and gated with `optional: true` so flows keep working before they're wired.
When you add a testID to a screen, update the matching flow to drop the
text fallback.

Seeds to add:

| Screen | testID | Purpose |
|---|---|---|
| CaptureScreen | `project-description-input` | Description TextInput |
| CaptureScreen | `analyze-button` | Primary CTA |
| Settings | `dark-mode-switch` | Theme toggle |
| App shell | `open-drawer` | Hamburger menu icon |

Once testIDs are wired, these flows stop depending on translated strings
and become locale-stable.

## CI

The CI workflow `.github/workflows/e2e-maestro.yml` runs these flows on an
Android emulator under manual dispatch. It is **not** on every PR because
Android emulators on GitHub-hosted runners take 10–20 minutes to boot and
are prone to unrelated failures. Dispatch manually before each release or
merge to main.

## Known limitations

- Camera flow is not covered: Maestro can't reliably dismiss native
  permission dialogs across Android API levels. Camera capture is exercised
  at the unit level via the `CaptureScreen.nav.test.js` suite instead.
- Dynamic-language translation (fetching a French table through the backend
  translate proxy) isn't covered here. `I18nContext.test.js` covers it at
  the unit level, and the contract is stable.
- iOS flows aren't wired. Once EAS produces an iOS build, add `.ipa` install
  to the CI workflow and duplicate each flow with `appId: <ios-bundle-id>`.
