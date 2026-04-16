/**
 * @format
 */

import 'react-native-gesture-handler';
// Initialize Sentry as early as possible so it can install its native crash
// handler and global JS error handler before any app code runs. This MUST stay
// above the App import.
//
// Wrapped in try/catch because a Sentry init failure (bad DSN, native bridge
// not linked, etc.) must NEVER prevent the app from booting. We can live
// without crash reporting; we can't live without the app launching.
import {initSentry, Sentry} from './src/services/sentry';
try { initSentry(); } catch (e) {
  // eslint-disable-next-line no-console
  console.warn('[sentry] init failed:', e?.message);
}

import {AppRegistry} from 'react-native';
import App from './App';
import {name as appName} from './app.json';

// Sentry.wrap installs an error boundary, touch breadcrumb tracking, and
// (when traces are enabled) the root performance transaction. Fall back to
// the raw App component if wrap throws (e.g. missing native Sentry module).
const wrapped = (() => {
  try { return Sentry.wrap(App); } catch { return App; }
})();

// Register under BOTH "main" and the app.json name. MainActivity.kt asks for
// "main" by default after `expo prebuild`, while older React Native templates
// register by the app.json name. Registering twice is cheap and avoids a
// blank-splash hang if these two ever drift apart again.
AppRegistry.registerComponent('main', () => wrapped);
AppRegistry.registerComponent(appName, () => wrapped);
