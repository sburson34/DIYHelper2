// Single source of truth for app identity at runtime.
//
// All values come from existing config (app.json via expo-constants, env vars,
// build.gradle via native constants). Nothing is hardcoded here — bump versions
// in app.json and build.gradle, and this module picks them up automatically.

import { Platform } from 'react-native';
import Constants from 'expo-constants';

const expoConfig = Constants?.expoConfig ?? Constants?.manifest ?? {};

// ── Version ───────────────────────────────────────────────────────────
// app.json "version" is the user-facing version string.
export const APP_VERSION = expoConfig.version ?? '0.0.0';

// Native build number: android.versionCode / ios.buildNumber from app.json,
// or the native-layer value that expo-constants exposes at runtime.
export const BUILD_NUMBER = (() => {
  if (Platform.OS === 'android') {
    return String(
      expoConfig.android?.versionCode
        ?? Constants?.nativeBuildVersion
        ?? '0'
    );
  }
  return String(
    expoConfig.ios?.buildNumber
      ?? Constants?.nativeBuildVersion
      ?? '0'
  );
})();

// ── Git commit ────────────────────────────────────────────────────────
// Injected at build time via EXPO_PUBLIC_GIT_COMMIT env var.
// Set it in your build script: EXPO_PUBLIC_GIT_COMMIT=$(git rev-parse --short HEAD)
export const GIT_COMMIT = process.env.EXPO_PUBLIC_GIT_COMMIT || null;

// ── Environment ───────────────────────────────────────────────────────
export const ENVIRONMENT = (() => {
  if (__DEV__) return 'development';
  const envTag = process.env.EXPO_PUBLIC_APP_ENV;
  if (envTag && typeof envTag === 'string') return envTag;
  return 'production';
})();

// ── Platform ──────────────────────────────────────────────────────────
export const APP_PLATFORM = Platform.OS;
export const OS_VERSION = String(Platform.Version);

// ── Release identifier ────────────────────────────────────────────────
// Format: diyhelper2@1.0.0+3 (version+buildNumber, matches Sentry convention)
export const RELEASE = GIT_COMMIT
  ? `diyhelper2@${APP_VERSION}+${BUILD_NUMBER} (${GIT_COMMIT})`
  : `diyhelper2@${APP_VERSION}+${BUILD_NUMBER}`;

// Flat object for easy consumption by monitoring.setAppInfo().
export const APP_INFO = {
  appVersion: APP_VERSION,
  buildNumber: BUILD_NUMBER,
  gitCommit: GIT_COMMIT,
  environment: ENVIRONMENT,
  platform: APP_PLATFORM,
  osVersion: OS_VERSION,
  release: RELEASE,
};
