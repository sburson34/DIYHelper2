// Dev-only triggers for verifying the Sentry pipeline end-to-end.
// Wired into Settings under a __DEV__-gated section.

import { captureException, Sentry } from './sentry';

export function triggerHandledException() {
  try {
    throw new Error('[sentry-test] handled exception @ ' + new Date().toISOString());
  } catch (e) {
    captureException(e, { tags: { sentryTest: 'handled' } });
  }
}

export function triggerUnhandledException() {
  // Throwing on the next tick lets RN's global error handler catch it,
  // which is what Sentry hooks into for "unhandled" reporting.
  setTimeout(() => {
    throw new Error('[sentry-test] unhandled exception @ ' + new Date().toISOString());
  }, 0);
}

export function triggerNativeCrash() {
  // Hard guard — never expose this outside dev builds.
  if (!__DEV__) return;
  // eslint-disable-next-line no-console
  console.warn('[sentry-test] forcing native crash in 1s — app will exit');
  setTimeout(() => {
    try {
      Sentry.nativeCrash();
    } catch (_) {
      // nativeCrash is intentionally fatal; ignore.
    }
  }, 1000);
}
