// Production-ready error reporting & monitoring utility.
//
// This is the public API that feature code should import. It delegates to
// Sentry (via ./sentry.js) when available and falls back to console logging
// when the DSN isn't configured or in local __DEV__ builds.
//
// Usage:
//   import { reportError, addBreadcrumb } from '../services/monitoring';
//
// Do NOT import from '@sentry/react-native' or './sentry' directly in
// feature code — always go through this module so scrubbing, guards, and
// future provider swaps happen in one place.

import {
  captureException,
  captureMessage,
  setUserContext,
  clearUserContext,
  setAppContext,
  Sentry,
} from './sentry';
import { SENTRY_ENABLED } from '../config/sentry';

// ── Helpers ──────────────────────────────────────────────────────────────

const noop = () => {};

const log = (method, ...args) => {
  // eslint-disable-next-line no-console
  (console[method] || console.log)(...args);
};

// ── Public API ───────────────────────────────────────────────────────────

/**
 * Report an unhandled or unexpected error.
 *
 * @param {Error}  error
 * @param {Object} [options]
 * @param {string} [options.source]    — where the error originated (e.g. "CaptureScreen")
 * @param {string} [options.operation] — what was happening (e.g. "analyzeProject")
 * @param {Object} [options.extra]     — arbitrary key/values attached to the event
 * @param {string} [options.level]     — Sentry severity ("error" | "fatal"), default "error"
 */
export function reportError(error, options = {}) {
  const { source, operation, extra, level } = options;

  const context = {
    ...(source && { source }),
    ...(operation && { operation }),
    ...extra,
  };

  if (level === 'fatal' && SENTRY_ENABLED) {
    try {
      Sentry.withScope((scope) => {
        scope.setLevel('fatal');
        for (const [k, v] of Object.entries(context)) scope.setExtra(k, v);
        Sentry.captureException(error);
      });
    } catch {
      // telemetry must never crash the app
    }
    return;
  }

  captureException(error, context);
}

/**
 * Report an error that was caught and handled (the app recovered).
 * Distinct from reportError so you can filter handled vs unhandled in Sentry.
 *
 * @param {string} name  — short label, e.g. "AnalysisFallbackToCache"
 * @param {Error}  error
 * @param {Object} [extra]
 */
export function reportHandledError(name, error, extra) {
  captureException(error, {
    handled: true,
    handlerName: name,
    ...extra,
  });
}

/**
 * Report a warning-level message (not an Error object).
 *
 * @param {string} message
 * @param {Object} [extra]
 */
export function reportWarning(message, extra) {
  captureMessage(message, 'warning', extra);
}

/**
 * Add a breadcrumb that will be attached to the next error/event.
 * Use this before risky operations so the timeline shows what the user did.
 *
 * @param {string} message
 * @param {string} [category]  — e.g. "user.action", "network", "navigation"
 * @param {Object} [data]      — extra payload (scrubbed by sentry.js beforeBreadcrumb)
 */
export function addBreadcrumb(message, category = 'app', data) {
  if (SENTRY_ENABLED) {
    try {
      Sentry.addBreadcrumb({
        message,
        category,
        level: 'info',
        ...(data && { data }),
      });
    } catch {
      // ignore
    }
  }
  if (__DEV__) {
    log('debug', `[breadcrumb:${category}]`, message, data || '');
  }
}

/**
 * Set the current user for monitoring. Call on login / profile load.
 * Only pass fields the user has consented to share.
 *
 * @param {{ id: string, email?: string, username?: string }} userInfo
 */
export function setMonitoringUser(userInfo) {
  setUserContext(userInfo);
}

/**
 * Clear the monitoring user (e.g. on logout).
 */
export function clearMonitoringUser() {
  clearUserContext();
}

/**
 * Set a global tag on all future events. Tags are indexed and searchable
 * in Sentry (unlike extras).
 *
 * @param {string} key   — e.g. "skillLevel", "language"
 * @param {string} value
 */
export function setMonitoringTag(key, value) {
  if (!SENTRY_ENABLED) return;
  try {
    Sentry.setTag(key, value);
  } catch {
    // ignore
  }
}
