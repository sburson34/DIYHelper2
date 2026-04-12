/**
 * @format
 */

import 'react-native-gesture-handler';
// Initialize Sentry as early as possible so it can install its native crash
// handler and global JS error handler before any app code runs. This MUST stay
// above the App import.
import {initSentry, Sentry} from './src/services/sentry';
initSentry();

import {AppRegistry} from 'react-native';
import App from './App';
import {name as appName} from './app.json';

// Sentry.wrap installs an error boundary, touch breadcrumb tracking, and
// (when traces are enabled) the root performance transaction.
AppRegistry.registerComponent(appName, () => Sentry.wrap(App));
