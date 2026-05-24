// Thin app binding of the shared anonymous product-usage telemetry pipeline.
//
// Buffering/flush/persist lives in @sburson34/mobile-shared/telemetry
// (createTelemetry). This wires it to DIYHelper2's backend base URL,
// AsyncStorage, platform and app version, and re-exports
// { initTelemetry, track, flushTelemetry }.
//
// Anonymous on the backend (events keyed on a per-install AnonId, never a
// user). No PII flows through here — only event names + small prop bags.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import { createTelemetry } from '@sburson34/mobile-shared/telemetry';
import { API_BASE_URL } from '../config/api';
import { APP_VERSION } from '../config/appInfo';

const telemetry = createTelemetry({
  post: (path: string, body: unknown) =>
    fetch(`${API_BASE_URL}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).then((r) => {
      // Reject on non-2xx so the buffer is retained for the next flush.
      if (!r.ok) throw new Error(`telemetry ${r.status}`);
      return undefined;
    }),
  storage: AsyncStorage,
  platform: Platform.OS,
  appVersion: APP_VERSION,
  storagePrefix: '@diyhelper/telemetry',
});

export const initTelemetry = telemetry.init;
export const track = telemetry.track;
export const flushTelemetry = telemetry.flush;
export default telemetry;
