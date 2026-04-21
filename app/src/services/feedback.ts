// Beta feedback submission service.
//
// During beta, feedback is:
//   1. Sent to Sentry as a "user_feedback" message (searchable, linked to session)
//   2. Saved to AsyncStorage so it survives app restarts and can be synced later
//
// When a backend endpoint exists, add a POST to /api/feedback here and the rest
// of the app doesn't change.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { APP_INFO } from '../config/appInfo';
import { Sentry } from './sentry';
import { SENTRY_ENABLED } from '../config/sentry';
import { API_BASE_URL } from '../config/api';

const FEEDBACK_KEY = '@beta_feedback';

export interface FeedbackInput {
  description: string;
  whatYouWereDoing?: string | null;
  reproSteps?: string | null;
  currentScreen?: string;
  lastCorrelationId?: string | null;
}

export interface FeedbackEntry {
  id: string;
  timestamp: string;
  description: string;
  whatYouWereDoing: string | null;
  reproSteps: string | null;
  metadata: {
    appVersion: string;
    buildNumber: string;
    platform: string;
    osVersion: string;
    environment: string;
    release: string;
    gitCommit: string | null;
    currentScreen: string;
    lastCorrelationId: string | null;
  };
}

export async function submitFeedback({
  description,
  whatYouWereDoing,
  reproSteps,
  currentScreen,
  lastCorrelationId,
}: FeedbackInput): Promise<string> {
  const timestamp = new Date().toISOString();
  const feedbackId = `fb-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

  const metadata: FeedbackEntry['metadata'] = {
    appVersion: APP_INFO.appVersion,
    buildNumber: APP_INFO.buildNumber,
    platform: APP_INFO.platform,
    osVersion: APP_INFO.osVersion,
    environment: APP_INFO.environment,
    release: APP_INFO.release,
    gitCommit: APP_INFO.gitCommit,
    currentScreen: currentScreen || 'unknown',
    lastCorrelationId: lastCorrelationId || null,
  };

  const entry: FeedbackEntry = {
    id: feedbackId,
    timestamp,
    description,
    whatYouWereDoing: whatYouWereDoing || null,
    reproSteps: reproSteps || null,
    metadata,
  };

  // 1. Send to Sentry so it shows up in the issues dashboard immediately.
  if (SENTRY_ENABLED) {
    try {
      Sentry.withScope((scope) => {
        (scope as unknown as { setLevel: (l: string) => void }).setLevel('info');
        scope.setTag('feedback', 'true');
        scope.setTag('feedback.id', feedbackId);
        scope.setExtra('whatYouWereDoing', whatYouWereDoing || '');
        scope.setExtra('reproSteps', reproSteps || '');
        scope.setExtra('currentScreen', metadata.currentScreen);
        scope.setExtra('lastCorrelationId', metadata.lastCorrelationId);
        Sentry.captureMessage(`Beta feedback: ${description.slice(0, 120)}`);
      });
    } catch {
      // telemetry must never block feedback
    }
  }

  // 2. Persist locally so nothing is lost if Sentry is unreachable.
  try {
    const existing = JSON.parse(
      (await AsyncStorage.getItem(FEEDBACK_KEY)) || '[]',
    ) as FeedbackEntry[];
    existing.unshift(entry);
    // Keep last 50 entries to bound storage.
    await AsyncStorage.setItem(FEEDBACK_KEY, JSON.stringify(existing.slice(0, 50)));
  } catch {
    // storage failure should never block the success path
  }

  // 3. Send to backend. Fire-and-forget — Sentry + local storage are the primary paths.
  try {
    await fetch(`${API_BASE_URL}/api/feedback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(entry),
    });
  } catch {
    // already saved locally and to Sentry — backend sync is best-effort
  }

  return feedbackId;
}

export async function getLocalFeedback(): Promise<FeedbackEntry[]> {
  try {
    return JSON.parse(
      (await AsyncStorage.getItem(FEEDBACK_KEY)) || '[]',
    ) as FeedbackEntry[];
  } catch {
    return [];
  }
}
