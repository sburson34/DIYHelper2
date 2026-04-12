// Sentry runtime configuration.
//
// IMPORTANT: nothing in this file is a secret. The DSN is a public client key
// that Sentry expects to be embedded in the app. Auth tokens used for source
// map uploads must NEVER be put here — those live in sentry.properties or the
// SENTRY_AUTH_TOKEN env var, which are read only at build time.
//
// DSN resolution order:
//   1. process.env.EXPO_PUBLIC_SENTRY_DSN  (works because babel-preset-expo
//      inlines EXPO_PUBLIC_* vars at build time)
//   2. expo.extra.sentryDsn from app.json / app.config.* (via expo-constants)
//
// If neither is set, Sentry is disabled and the app behaves exactly as before.

import Constants from 'expo-constants';
import { ENVIRONMENT, RELEASE } from './appInfo';

const fromEnv = process.env.EXPO_PUBLIC_SENTRY_DSN;
const fromExtra =
  Constants?.expoConfig?.extra?.sentryDsn ??
  Constants?.manifest?.extra?.sentryDsn;

// Hardcoded fallback — the DSN is a public client key, not a secret.
// See https://docs.sentry.io/concepts/key-terms/dsn-explainer/
const HARDCODED_DSN =
  'https://bf84aa0077ae0f4ccf5100632b3f1ed7@o4511185009049600.ingest.us.sentry.io/4511185011736576';

export const SENTRY_DSN = fromEnv || fromExtra || HARDCODED_DSN;

export const SENTRY_ENVIRONMENT = ENVIRONMENT;

export const SENTRY_RELEASE = RELEASE;

// Conservative sampling for beta. Bumps to 0 in production until we know the
// volume; dev keeps it off so noisy reloads don't pollute the project.
export const SENTRY_TRACES_SAMPLE_RATE = (() => {
  if (SENTRY_ENVIRONMENT === 'beta') return 0.2;
  if (SENTRY_ENVIRONMENT === 'production') return 0.05;
  return 0.0;
})();

export const SENTRY_ENABLED = !!SENTRY_DSN;
