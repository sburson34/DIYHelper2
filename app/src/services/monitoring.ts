// Production-ready error reporting & monitoring utility.
//
// This is the public API that feature code should import. It delegates to
// Sentry (via ./sentry.ts) when available and falls back to console logging
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
  Sentry,
  SeverityLevel,
  UserContext,
} from './sentry';
import { SENTRY_ENABLED } from '../config/sentry';

// ── Helpers ──────────────────────────────────────────────────────────────

type ConsoleMethod = 'log' | 'warn' | 'error' | 'debug' | 'info';

const log = (method: ConsoleMethod, ...args: unknown[]): void => {
  // eslint-disable-next-line no-console
  (console[method] || console.log)(...args);
};

// ── Public API ───────────────────────────────────────────────────────────

export interface ReportErrorOptions {
  /** where the error originated (e.g. "CaptureScreen") */
  source?: string;
  /** what was happening (e.g. "analyzeProject") */
  operation?: string;
  /** arbitrary key/values attached to the event */
  extra?: Record<string, unknown>;
  /** Sentry severity ("error" | "fatal"), default "error" */
  level?: SeverityLevel;
}

/**
 * Report an unhandled or unexpected error.
 */
export function reportError(error: unknown, options: ReportErrorOptions = {}): void {
  const { source, operation, extra, level } = options;

  const context: Record<string, unknown> = {
    ...(source && { source }),
    ...(operation && { operation }),
    ...extra,
  };

  if (level === 'fatal' && SENTRY_ENABLED) {
    try {
      Sentry.withScope((scope) => {
        (scope as unknown as { setLevel: (l: SeverityLevel) => void }).setLevel('fatal');
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
 */
export function reportHandledError(
  name: string,
  error: unknown,
  extra?: Record<string, unknown>,
): void {
  captureException(error, {
    handled: true,
    handlerName: name,
    ...extra,
  });
}

/**
 * Report a warning-level message (not an Error object).
 */
export function reportWarning(message: string, extra?: Record<string, unknown>): void {
  captureMessage(message, 'warning', extra);
}

/**
 * Add a breadcrumb that will be attached to the next error/event.
 * Use this before risky operations so the timeline shows what the user did.
 */
export function addBreadcrumb(
  message: string,
  category = 'app',
  data?: Record<string, unknown>,
): void {
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
 */
export function setMonitoringUser(userInfo: UserContext): void {
  setUserContext(userInfo);
}

/**
 * Clear the monitoring user (e.g. on logout).
 */
export function clearMonitoringUser(): void {
  clearUserContext();
}

/**
 * Set a global tag on all future events. Tags are indexed and searchable
 * in Sentry (unlike extras).
 */
export function setMonitoringTag(key: string, value: string): void {
  if (!SENTRY_ENABLED) return;
  try {
    Sentry.setTag(key, value);
  } catch {
    // ignore
  }
}
