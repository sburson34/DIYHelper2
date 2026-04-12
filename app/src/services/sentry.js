// Centralized Sentry helper.
//
// Why this file exists:
//   - One place to call Sentry.init so index.js stays small.
//   - One place that scrubs sensitive payloads (auth tokens, API keys,
//     base64 image/video bodies) before anything is sent.
//   - Safe wrappers (captureException / captureMessage / setUserContext /
//     setAppContext) that no-op when the DSN isn't configured, so feature
//     code can call them unconditionally.
//
// Anything Sentry-specific outside of this file should import from here, NOT
// from '@sentry/react-native' directly. That keeps scrubbing/guards in one
// place and makes it easy to swap providers later.

import * as Sentry from '@sentry/react-native';
import {
  SENTRY_DSN,
  SENTRY_ENABLED,
  SENTRY_ENVIRONMENT,
  SENTRY_RELEASE,
  SENTRY_TRACES_SAMPLE_RATE,
} from '../config/sentry';
import { APP_VERSION, BUILD_NUMBER, GIT_COMMIT, APP_PLATFORM, OS_VERSION } from '../config/appInfo';

// Single shared navigation integration instance. We hand its
// `registerNavigationContainer` method to the NavigationContainer's onReady
// callback in App.js so route changes become breadcrumbs/transactions.
export const navigationIntegration = Sentry.reactNavigationIntegration({
  enableTimeToInitialDisplay: false,
});

// ── Scrubbing ─────────────────────────────────────────────────────────────
// Keys whose values should never leave the device. Compared case-insensitively
// against header names, body keys, and breadcrumb data keys.
const SENSITIVE_KEYS = [
  'authorization',
  'auth',
  'token',
  'access_token',
  'refresh_token',
  'api_key',
  'apikey',
  'x-api-key',
  'openai_api_key',
  'password',
  'secret',
  'cookie',
  'set-cookie',
];

// Body fields that may contain raw user media (base64 photos/video frames the
// app sends to /api/analyze). These are large and privacy-sensitive — strip.
const MEDIA_KEYS = ['media', 'image', 'images', 'photo', 'photos', 'video', 'videos', 'base64', 'data'];

const REDACTED = '[redacted]';

const isSensitiveKey = (key) => {
  if (typeof key !== 'string') return false;
  const k = key.toLowerCase();
  return SENSITIVE_KEYS.some((s) => k === s || k.includes(s));
};

const isMediaKey = (key) => {
  if (typeof key !== 'string') return false;
  const k = key.toLowerCase();
  return MEDIA_KEYS.includes(k);
};

// Recursively scrub an arbitrary object. Bounded depth so we never blow the
// stack on a circular structure.
const scrub = (value, depth = 0) => {
  if (value == null || depth > 6) return value;
  if (Array.isArray(value)) return value.map((v) => scrub(v, depth + 1));
  if (typeof value === 'string') {
    // Heuristic: very long strings that look like base64 image payloads.
    if (value.length > 2000 && /^[A-Za-z0-9+/=]+$/.test(value.slice(0, 64))) {
      return `${REDACTED}:base64(${value.length}b)`;
    }
    return value;
  }
  if (typeof value !== 'object') return value;

  const out = {};
  for (const [k, v] of Object.entries(value)) {
    if (isSensitiveKey(k)) {
      out[k] = REDACTED;
    } else if (isMediaKey(k)) {
      out[k] = Array.isArray(v) ? `${REDACTED}:media[${v.length}]` : REDACTED;
    } else {
      out[k] = scrub(v, depth + 1);
    }
  }
  return out;
};

// beforeSend / beforeBreadcrumb hooks that apply scrubbing to anything Sentry
// is about to transmit.
const beforeSend = (event) => {
  try {
    if (event.request) {
      if (event.request.headers) event.request.headers = scrub(event.request.headers);
      if (event.request.data) event.request.data = scrub(event.request.data);
      if (event.request.cookies) event.request.cookies = REDACTED;
    }
    if (event.extra) event.extra = scrub(event.extra);
    if (event.contexts) event.contexts = scrub(event.contexts);
    if (event.tags) event.tags = scrub(event.tags);
  } catch {
    // Never let scrubbing errors block delivery.
  }
  return event;
};

const beforeBreadcrumb = (breadcrumb) => {
  try {
    if (breadcrumb?.data) breadcrumb.data = scrub(breadcrumb.data);
    // Drop console.debug noise; keep warn/error.
    if (breadcrumb?.category === 'console' && breadcrumb?.level === 'debug') {
      return null;
    }
  } catch {
    // ignore
  }
  return breadcrumb;
};

// ── Init ──────────────────────────────────────────────────────────────────
let initialized = false;

export const initSentry = () => {
  if (initialized) return;
  if (!SENTRY_ENABLED) {
    if (__DEV__) {
      // eslint-disable-next-line no-console
      console.log('[sentry] disabled — no DSN configured');
    }
    return;
  }

  Sentry.init({
    dsn: SENTRY_DSN,
    environment: SENTRY_ENVIRONMENT,
    release: SENTRY_RELEASE,
    tracesSampleRate: SENTRY_TRACES_SAMPLE_RATE,
    attachStacktrace: true,
    // Don't ship raw IPs / cookies.
    sendDefaultPii: false,
    // Native crash capture is on by default in @sentry/react-native; we just
    // pass the integrations we want to add on top.
    integrations: [navigationIntegration],
    beforeSend,
    beforeBreadcrumb,
    // Beta-friendly: keep auto session tracking so we get crash-free-users.
    enableAutoSessionTracking: true,
  });

  // Persistent tags — indexed and searchable on every event.
  Sentry.setTag('app.version', APP_VERSION);
  Sentry.setTag('app.build', BUILD_NUMBER);
  Sentry.setTag('app.platform', APP_PLATFORM);
  if (GIT_COMMIT) Sentry.setTag('app.commit', GIT_COMMIT);

  // Structured context — visible in the event detail sidebar.
  Sentry.setContext('app', {
    app_version: APP_VERSION,
    build_number: BUILD_NUMBER,
    git_commit: GIT_COMMIT,
    platform: APP_PLATFORM,
    os_version: OS_VERSION,
    environment: SENTRY_ENVIRONMENT,
  });

  initialized = true;
};

// ── Public helpers (safe to call before init or with no DSN) ─────────────

export const captureException = (error, context) => {
  if (!SENTRY_ENABLED) {
    // Preserve existing logging behavior in dev/no-DSN builds.
    // eslint-disable-next-line no-console
    console.error('[captureException]', error, context || '');
    return;
  }
  try {
    Sentry.withScope((scope) => {
      if (context && typeof context === 'object') {
        for (const [k, v] of Object.entries(context)) {
          scope.setExtra(k, v);
        }
      }
      Sentry.captureException(error);
    });
  } catch {
    // swallow — telemetry must never crash the app
  }
};

export const captureMessage = (message, level = 'info', extra) => {
  if (!SENTRY_ENABLED) {
    // eslint-disable-next-line no-console
    console.log(`[captureMessage:${level}]`, message, extra || '');
    return;
  }
  try {
    Sentry.withScope((scope) => {
      scope.setLevel(level);
      if (extra && typeof extra === 'object') {
        for (const [k, v] of Object.entries(extra)) {
          scope.setExtra(k, v);
        }
      }
      Sentry.captureMessage(message);
    });
  } catch {
    // ignore
  }
};

// id is required; everything else is optional. Email/username are only set if
// the caller explicitly opted in (we don't pull them from storage by default).
export const setUserContext = ({ id, email, username, ...rest } = {}) => {
  if (!SENTRY_ENABLED) return;
  try {
    Sentry.setUser({
      id: id ? String(id) : undefined,
      email,
      username,
      ...rest,
    });
  } catch {
    // ignore
  }
};

export const clearUserContext = () => {
  if (!SENTRY_ENABLED) return;
  try {
    Sentry.setUser(null);
  } catch {
    // ignore
  }
};

// App-level context — locale, theme, skill level, feature flags, etc. Anything
// that helps reproduce a bug but is not user-identifying.
export const setAppContext = (key, value) => {
  if (!SENTRY_ENABLED) return;
  try {
    Sentry.setContext(key, scrub(value));
  } catch {
    // ignore
  }
};

// Re-export the underlying SDK for the few cases (e.g. Sentry.wrap in
// index.js) where we need direct access. Prefer the helpers above for normal
// feature code.
export { Sentry };
