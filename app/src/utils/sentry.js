// Centralized Sentry wrapper.
//
// Why this lives here:
//   * Keeps the DSN/config resolution in one place (no secrets in source).
//   * Gives the rest of the app a tiny, stable surface (captureException,
//     captureMessage, setUserContext, setAppContext) so call sites don't
//     have to import @sentry/react-native directly.
//   * All outgoing events run through a beforeSend scrubber that strips
//     auth tokens, API keys, and large base64 media payloads.
//
// This file is a no-op when no DSN is configured, so importing it from
// index.js / App.js is always safe.

import * as Sentry from '@sentry/react-native';
import Constants from 'expo-constants';
import { Platform } from 'react-native';

// ---------------------------------------------------------------------------
// Config resolution
// ---------------------------------------------------------------------------
// DSN precedence:
//   1. process.env.SENTRY_DSN  (injected at build time, e.g. via EAS secrets)
//   2. expoConfig.extra.sentryDsn  (app.json / app.config.js — never commit
//      a real DSN here for prod; use it for local dev only)
const expoExtra =
  (Constants.expoConfig && Constants.expoConfig.extra) ||
  (Constants.manifest && Constants.manifest.extra) ||
  {};

const DSN = process.env.SENTRY_DSN || expoExtra.sentryDsn || '';

const ENV = __DEV__
  ? 'development'
  : process.env.SENTRY_ENVIRONMENT ||
    expoExtra.sentryEnvironment ||
    'production';

// Release: prefer an explicit override, otherwise let the native SDK
// auto-detect from the app bundle (recommended for source-map matching).
const RELEASE =
  process.env.SENTRY_RELEASE ||
  expoExtra.sentryRelease ||
  (Constants.expoConfig && Constants.expoConfig.version) ||
  undefined;

// React Navigation integration is created up-front so AppContent can
// register the NavigationContainer ref with it on mount.
export const navigationIntegration = Sentry.reactNavigationIntegration({
  enableTimeToInitialDisplay: true,
});

// ---------------------------------------------------------------------------
// Scrubbing
// ---------------------------------------------------------------------------
const SENSITIVE_KEY_RE =
  /(authorization|api[_-]?key|access[_-]?token|refresh[_-]?token|token|password|secret|cookie|set-cookie)/i;

function scrubObject(obj, depth) {
  if (!obj || typeof obj !== 'object' || depth > 6) return obj;
  for (const key of Object.keys(obj)) {
    const val = obj[key];
    if (SENSITIVE_KEY_RE.test(key)) {
      obj[key] = '[Filtered]';
      continue;
    }
    if (typeof val === 'string') {
      // Drop embedded base64 images / large media — these are user content
      // we never want to ship to Sentry.
      if (val.length > 1024 && /^data:image\//i.test(val)) {
        obj[key] = '[Filtered base64 image]';
      } else if (val.length > 8192) {
        obj[key] = val.slice(0, 256) + `…[truncated ${val.length} chars]`;
      }
    } else if (val && typeof val === 'object') {
      scrubObject(val, depth + 1);
    }
  }
  return obj;
}

function scrubEvent(event) {
  try {
    if (event.request) scrubObject(event.request, 0);
    if (event.extra) scrubObject(event.extra, 0);
    if (event.contexts) scrubObject(event.contexts, 0);
    if (Array.isArray(event.breadcrumbs)) {
      for (const b of event.breadcrumbs) {
        if (b && b.data) scrubObject(b.data, 0);
        // Strip query strings on http breadcrumbs that might contain tokens.
        if (b && b.category === 'http' && b.data && typeof b.data.url === 'string') {
          b.data.url = b.data.url.replace(/([?&](?:token|api[_-]?key|access[_-]?token)=)[^&]+/gi, '$1[Filtered]');
        }
      }
    }
  } catch (_) {
    // Never let the scrubber itself crash the app.
  }
  return event;
}

// ---------------------------------------------------------------------------
// init
// ---------------------------------------------------------------------------
let initialized = false;

export function initSentry() {
  if (initialized) return;
  if (!DSN) {
    if (__DEV__) {
      // eslint-disable-next-line no-console
      console.log('[sentry] No DSN configured — Sentry is disabled.');
    }
    return;
  }

  Sentry.init({
    dsn: DSN,
    environment: ENV,
    release: RELEASE,
    enableNative: true,
    enableNativeCrashHandling: true,
    enableAutoSessionTracking: true,
    attachStacktrace: true,
    // Conservative tracing for beta — raise later once volume is understood.
    tracesSampleRate: ENV === 'production' ? 0.05 : 0.2,
    // Don't ship IPs / PII by default.
    sendDefaultPii: false,
    integrations: [navigationIntegration],
    beforeSend(event) {
      return scrubEvent(event);
    },
    beforeBreadcrumb(breadcrumb) {
      if (breadcrumb && breadcrumb.data) scrubObject(breadcrumb.data, 0);
      return breadcrumb;
    },
  });

  // Lightweight device/app tags. Anything richer (model, OS build) is
  // already populated by the native layer's device context.
  Sentry.setTag('platform.os', Platform.OS);
  Sentry.setTag('platform.version', String(Platform.Version));
  if (Constants.expoConfig && Constants.expoConfig.version) {
    Sentry.setTag('app.version', Constants.expoConfig.version);
  }

  initialized = true;
}

// ---------------------------------------------------------------------------
// Public helpers
// ---------------------------------------------------------------------------

/**
 * Report a handled exception.
 *   captureException(err);
 *   captureException(err, { tags: { area: 'analyze' }, extra: { id }, level: 'error' });
 */
export function captureException(error, context) {
  if (!initialized) {
    if (__DEV__) {
      // eslint-disable-next-line no-console
      console.warn('[sentry] captureException before init:', error);
    }
    return;
  }
  Sentry.withScope((scope) => {
    if (context && typeof context === 'object') {
      if (context.tags) scope.setTags(context.tags);
      if (context.extra) scope.setExtras(context.extra);
      if (context.level) scope.setLevel(context.level);
      if (context.fingerprint) scope.setFingerprint(context.fingerprint);
    }
    Sentry.captureException(error);
  });
}

/**
 * Report a freeform message.
 *   captureMessage('user opted into beta', 'info', { source: 'settings' });
 */
export function captureMessage(message, level = 'info', extra) {
  if (!initialized) return;
  Sentry.withScope((scope) => {
    if (extra) scope.setExtras(extra);
    Sentry.captureMessage(message, level);
  });
}

/**
 * Identify the current user. Pass `null` to clear.
 * Only pass non-PII identifiers (e.g. an opaque user id) by default.
 */
export function setUserContext(user) {
  Sentry.setUser(user || null);
}

/**
 * Attach a structured context block (shows up under `Additional Data` in
 * the Sentry UI). Use for things like current screen, feature flags, etc.
 *   setAppContext('analyze', { hasImage: true, mediaCount: 2 });
 */
export function setAppContext(key, value) {
  Sentry.setContext(key, value);
}

/** Wrap the root component so unhandled JS errors are auto-captured. */
export function wrap(component) {
  return Sentry.wrap(component);
}

export { Sentry };
