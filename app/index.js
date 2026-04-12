/**
 * @format
 */

import 'react-native-gesture-handler';
// Initialize Sentry as early as possible so it can catch errors during
// module evaluation and the first render. This is a no-op when no DSN
// is configured (see src/utils/sentry.js).
import {initSentry} from './src/utils/sentry';
initSentry();

import {AppRegistry} from 'react-native';
import App from './App';
import {name as appName} from './app.json';

AppRegistry.registerComponent(appName, () => App);
