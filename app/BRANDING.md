# White-label branding

One codebase, many companies. Each company ships as **its own app** in the
stores — own icon, name, bundle id, colors, splash — built from this same
`app/` source. Nothing under `src/` changes per brand.

## How it works

```
brands/
  diyhelper/        ← the flagship (default)
    brand.json      ← all the values that vary per company
    icon.png        ← app/launcher icon source
    splash.png      ← splash-screen image source
  acme-home/        ← a client
    brand.json  icon.png  splash.png
```

The active brand is chosen by the `BRAND` env var (default `diyhelper`).

- **Native identity** (icon, name, bundle id / package, splash, deep-link
  scheme, iOS permission copy) is stamped into the native project by
  **`app.config.js`**, which reads `brands/$BRAND/brand.json`. `expo prebuild`
  applies it and generates every icon density itself — no image tooling needed
  on your machine.
- **Runtime brand values** (theme colors, company name, privacy/terms URLs, the
  `X-Brand` API header) ride along in `expo.extra.brand` and are read at runtime
  via `expo-constants`:
  - `src/theme.ts` — `primary` / `secondary` / `accent` override the palette in
    both light and dark mode.
  - `src/config/appInfo.ts` — `BRAND_ID`, the Sentry `RELEASE` prefix, and the
    legal URLs.
  - `src/api/backendClient.ts` — sends `X-Brand: <id>` on every request so the
    shared backend can segment usage/analytics per company.

`app.json` still holds everything that does **not** vary (plugins, permissions,
EAS project id, version, Sentry DSN); `app.config.js` layers the brand on top.

## Building a brand

Builds run through Git Bash (like the other `npm run` scripts), so inline env
works:

```bash
# 1. Regenerate the native project for the brand (rewrites android/)
BRAND=acme-home npm run prebuild

# 2. Build its APK / bundle
BRAND=acme-home npm run build:beta          # APK
BRAND=acme-home npm run build:beta:bundle    # AAB for Play

# Dev run on a device
BRAND=acme-home npm run android
```

`npm run brands` lists every brand and its bundle id.

> **Native folder is regenerated.** `npm run prebuild` runs
> `expo prebuild --clean`, which **overwrites `android/`**. `android/` is
> committed as the `diyhelper` baseline, so to get back to the default after
> building another brand: `git checkout android` (or
> `BRAND=diyhelper npm run prebuild`). Treat `android/` as generated output for
> brand builds — don't hand-edit it.

## Adding a new company

1. `cp -r brands/diyhelper brands/<new-id>`
2. Edit `brands/<new-id>/brand.json`:
   - `name` — store display name
   - `slug`, `scheme` — unique, lowercase, no spaces
   - `bundleId` — **must be globally unique** (`com.company.app`); this is the
     store identity and can never be reused across listings
   - `companyShortName` — used in the iOS permission prompts
   - `colors.primary/secondary/accent`, `splashBackground`, `iconBackground`
   - `privacyPolicyUrl`, `termsUrl` — each store listing needs its own
3. Replace `icon.png` (square, ≥1024×1024) and `splash.png` with the company's
   art. `icon.png` doubles as the Android adaptive-icon foreground, so keep the
   logo centered with padding.
4. `BRAND=<new-id> npm run prebuild && BRAND=<new-id> npm run build:beta`

## Not yet automated (follow-ups)

- **Backend `X-Brand` consumption** — the app sends the header; the API doesn't
  read it yet. Wire it into the telemetry/usage tables to get per-company
  dashboards.
- **Per-brand Sentry project** — all brands currently report to the shared
  Sentry project (distinguishable by `RELEASE` prefix). Split into separate
  projects only if a client needs isolated error data.
- **CI matrix** — `.github/workflows` builds the default brand. Add a brand
  matrix when you want cloud builds per company.
