// Thin shim over @sburson34/mobile-shared/sentry. The shared package owns
// the scrubber (sensitive keys, base64 media, PII fields), the Sentry init
// call, and the safe helpers. This file just wires up DIYHelper2's
// app-specific config (DSN, release, app context, tags) and re-exports
// everything else so feature code can keep importing from
// '../services/sentry' unchanged.
//
// Anything Sentry-specific outside this file should still import from here
// (NOT from '@sburson34/mobile-shared/sentry' directly) so per-app
// composition stays in one place.

import {
  initSentry as sharedInit,
  captureException as sharedCapture,
  captureMessage as sharedCaptureMessage,
  setUserContext as sharedSetUser,
  clearUserContext as sharedClearUser,
  setAppContext as sharedSetAppContext,
  navigationIntegration as sharedNavIntegration,
  Sentry as SharedSentry,
} from '@sburson34/mobile-shared/sentry';
import type {
  SeverityLevel as SharedSeverityLevel,
  UserContext as SharedUserContext,
} from '@sburson34/mobile-shared/sentry';

import {
  SENTRY_DSN,
  SENTRY_ENABLED,
  SENTRY_ENVIRONMENT,
  SENTRY_RELEASE,
  SENTRY_TRACES_SAMPLE_RATE,
} from '../config/sentry';
import { APP_VERSION, BUILD_NUMBER, GIT_COMMIT, APP_PLATFORM, OS_VERSION } from '../config/appInfo';

export type SeverityLevel = SharedSeverityLevel;
export type UserContext = SharedUserContext;

export const navigationIntegration = sharedNavIntegration;
export const Sentry = SharedSentry;

export const initSentry = (): void => {
  sharedInit({
    // Forward null when feature-flagged off so the shared init logs the
    // "disabled — no DSN configured" line and skips Sentry.init.
    dsn: SENTRY_ENABLED ? SENTRY_DSN : null,
    environment: SENTRY_ENVIRONMENT,
    release: SENTRY_RELEASE,
    tracesSampleRate: SENTRY_TRACES_SAMPLE_RATE,
    enableAutoSessionTracking: true,
    appContext: {
      app_version: APP_VERSION,
      build_number: BUILD_NUMBER,
      git_commit: GIT_COMMIT,
      platform: APP_PLATFORM,
      os_version: OS_VERSION,
      environment: SENTRY_ENVIRONMENT,
    },
    tags: {
      'app.version': APP_VERSION,
      'app.build': BUILD_NUMBER,
      'app.platform': APP_PLATFORM,
      ...(GIT_COMMIT ? { 'app.commit': GIT_COMMIT } : {}),
    },
  });
};

export const captureException = sharedCapture;
export const captureMessage = sharedCaptureMessage;
export const setUserContext = sharedSetUser;
export const clearUserContext = sharedClearUser;
export const setAppContext = sharedSetAppContext;
