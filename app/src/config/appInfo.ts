// Single source of truth for app identity at runtime.
//
// All values come from existing config (app.json via expo-constants, env vars,
// build.gradle via native constants). Nothing is hardcoded here — bump versions
// in app.json and build.gradle, and this module picks them up automatically.

import { Platform } from 'react-native';
import Constants from 'expo-constants';

// expo-constants shape is loose across SDK versions; cast to a partial record
// so optional-chain access compiles without depending on the specific runtime.
type ExpoConfigShape = {
  version?: string;
  android?: { versionCode?: number | string };
  ios?: { buildNumber?: string };
  extra?: { sentryDsn?: string };
};

const C = Constants as unknown as {
  expoConfig?: ExpoConfigShape;
  manifest?: ExpoConfigShape;
  nativeBuildVersion?: string | number;
};

const expoConfig: ExpoConfigShape = C.expoConfig ?? C.manifest ?? {};

// ── Version ───────────────────────────────────────────────────────────
// app.json "version" is the user-facing version string.
export const APP_VERSION: string = expoConfig.version ?? '0.0.0';

// Native build number: android.versionCode / ios.buildNumber from app.json,
// or the native-layer value that expo-constants exposes at runtime.
export const BUILD_NUMBER: string = (() => {
  if (Platform.OS === 'android') {
    return String(
      expoConfig.android?.versionCode
        ?? C.nativeBuildVersion
        ?? '0',
    );
  }
  return String(
    expoConfig.ios?.buildNumber
      ?? C.nativeBuildVersion
      ?? '0',
  );
})();

// ── Git commit ────────────────────────────────────────────────────────
// Injected at build time via EXPO_PUBLIC_GIT_COMMIT env var.
// Set it in your build script: EXPO_PUBLIC_GIT_COMMIT=$(git rev-parse --short HEAD)
export const GIT_COMMIT: string | null = process.env.EXPO_PUBLIC_GIT_COMMIT || null;

// ── Environment ───────────────────────────────────────────────────────
export const ENVIRONMENT: string = (() => {
  if (__DEV__) return 'development';
  const envTag = process.env.EXPO_PUBLIC_APP_ENV;
  if (envTag && typeof envTag === 'string') return envTag;
  return 'production';
})();

// ── Platform ──────────────────────────────────────────────────────────
export const APP_PLATFORM: typeof Platform.OS = Platform.OS;
export const OS_VERSION: string = String(Platform.Version);

// ── Release identifier ────────────────────────────────────────────────
// Format: diyhelper2@1.0.0+3 (version+buildNumber, matches Sentry convention)
export const RELEASE: string = GIT_COMMIT
  ? `diyhelper2@${APP_VERSION}+${BUILD_NUMBER} (${GIT_COMMIT})`
  : `diyhelper2@${APP_VERSION}+${BUILD_NUMBER}`;

// ── Legal URLs ────────────────────────────────────────────────────────
// Single source of truth for the privacy policy link. The same URL must go
// into Play Console → Store listing → Privacy Policy and App Store Connect
// → App Information → Privacy Policy URL, so keep this constant aligned
// with whatever you paste there.
//
// The HTML source lives at backend/DIYHelper2.Api/wwwroot/privacy-policy.html
// and is served by the API host's static-files middleware.
export const PRIVACY_POLICY_URL: string = 'https://api.diyhelper.org/privacy-policy.html';

// Terms of Service — same deploy mechanism as the privacy policy. Source HTML
// lives at backend/DIYHelper2.Api/wwwroot/terms-of-service.html.
export const TERMS_OF_SERVICE_URL: string = 'https://api.diyhelper.org/terms-of-service.html';

export interface AppInfo {
  appVersion: string;
  buildNumber: string;
  gitCommit: string | null;
  environment: string;
  platform: typeof Platform.OS;
  osVersion: string;
  release: string;
}

// Flat object for easy consumption by monitoring.setAppInfo().
export const APP_INFO: AppInfo = {
  appVersion: APP_VERSION,
  buildNumber: BUILD_NUMBER,
  gitCommit: GIT_COMMIT,
  environment: ENVIRONMENT,
  platform: APP_PLATFORM,
  osVersion: OS_VERSION,
  release: RELEASE,
};
