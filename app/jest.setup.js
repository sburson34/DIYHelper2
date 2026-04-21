// Global mocks for React Native and Expo modules

// AsyncStorage mock
jest.mock('@react-native-async-storage/async-storage', () => {
  const store = {};
  return {
    __esModule: true,
    default: {
      getItem: jest.fn((key) => Promise.resolve(store[key] || null)),
      setItem: jest.fn((key, value) => {
        store[key] = value;
        return Promise.resolve();
      }),
      removeItem: jest.fn((key) => {
        delete store[key];
        return Promise.resolve();
      }),
      clear: jest.fn(() => {
        Object.keys(store).forEach((key) => delete store[key]);
        return Promise.resolve();
      }),
      _store: store,
      _reset: () => {
        Object.keys(store).forEach((key) => delete store[key]);
      },
    },
  };
});

// React Native Platform mock — expose both default and named shapes so both
// `import Platform from '...'` and `require('...').OS` work.
jest.mock('react-native/Libraries/Utilities/Platform', () => {
  const platform = {
    OS: 'android',
    Version: 33,
    constants: { reactNativeVersion: { major: 0, minor: 83, patch: 0 } },
    select: jest.fn((obj) => (obj ? obj.android ?? obj.native ?? obj.default : undefined)),
    isTV: false,
    isTesting: true,
  };
  return { __esModule: true, default: platform, ...platform };
});

// Expo Constants mock
jest.mock('expo-constants', () => ({
  __esModule: true,
  default: {
    expoConfig: {
      version: '1.0.0',
      android: { versionCode: 1 },
      ios: { buildNumber: '1' },
      extra: {},
    },
    manifest: null,
    nativeBuildVersion: '1',
  },
}));

// Expo Notifications mock
jest.mock('expo-notifications', () => ({
  getPermissionsAsync: jest.fn(() => Promise.resolve({ status: 'granted' })),
  requestPermissionsAsync: jest.fn(() => Promise.resolve({ status: 'granted' })),
  setNotificationChannelAsync: jest.fn(() => Promise.resolve()),
  scheduleNotificationAsync: jest.fn(() => Promise.resolve('notif-id-123')),
  cancelScheduledNotificationAsync: jest.fn(() => Promise.resolve()),
  setNotificationHandler: jest.fn(),
  AndroidImportance: { DEFAULT: 3 },
}));

// Sentry mock
jest.mock('@sentry/react-native', () => ({
  init: jest.fn(),
  captureException: jest.fn(),
  captureMessage: jest.fn(),
  setUser: jest.fn(),
  setTag: jest.fn(),
  setContext: jest.fn(),
  addBreadcrumb: jest.fn(),
  withScope: jest.fn((cb) => {
    const scope = {
      setLevel: jest.fn(),
      setTag: jest.fn(),
      setExtra: jest.fn(),
    };
    cb(scope);
  }),
  wrap: jest.fn((component) => component),
  reactNavigationIntegration: jest.fn(() => ({
    registerNavigationContainer: jest.fn(),
  })),
  Severity: { Warning: 'warning', Error: 'error', Info: 'info', Fatal: 'fatal' },
}));

// react-native-safe-area-context — stub to plain View/passthrough
jest.mock('react-native-safe-area-context', () => {
  const React = require('react');
  const { View } = require('react-native');
  const pass = ({ children, ...rest }) => React.createElement(View, rest, children);
  return {
    SafeAreaProvider: pass,
    SafeAreaView: pass,
    SafeAreaInsetsContext: { Consumer: ({ children }) => children({ top: 0, bottom: 0, left: 0, right: 0 }) },
    useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
    useSafeAreaFrame: () => ({ x: 0, y: 0, width: 390, height: 844 }),
  };
});

// @expo/vector-icons — render icons as empty Views so name/size don't matter.
jest.mock('@expo/vector-icons', () => {
  const React = require('react');
  const { View } = require('react-native');
  const stub = (props) => React.createElement(View, { accessibilityLabel: props.accessibilityLabel || 'icon' });
  return new Proxy({}, { get: () => stub });
});

// react-native-gesture-handler — minimal stub.
jest.mock('react-native-gesture-handler', () => {
  const React = require('react');
  const { View } = require('react-native');
  const pass = ({ children, ...rest }) => React.createElement(View, rest, children);
  return {
    GestureHandlerRootView: pass,
    Swipeable: pass,
    DrawerLayout: pass,
    ScrollView: pass,
    TouchableOpacity: require('react-native').TouchableOpacity,
    TouchableWithoutFeedback: require('react-native').TouchableWithoutFeedback,
    TouchableHighlight: require('react-native').TouchableHighlight,
    State: {},
    Directions: {},
    gestureHandlerRootHOC: (c) => c,
  };
});

// react-native-reanimated — use its provided mock when available.
try {
  jest.mock('react-native-reanimated', () => require('react-native-reanimated/mock'));
} catch {
  // If the mock isn't shipped in this version, ignore — tests that need it will opt in per-file.
}

// i18n — resolve keys against the English catalogue so tests can match the
// same user-visible strings that the app renders. Fall back to the key name
// when a key isn't in the catalogue, so pre-existing tests that asserted on
// key strings continue to work.
jest.mock('./src/i18n/I18nContext', () => {
  const React = require('react');
  const { translations } = require('./src/i18n/translations');
  const en = translations.en;
  const ctx = {
    t: (k) => (en[k] !== undefined ? en[k] : k),
    language: 'en',
    setLanguage: () => {},
    isTranslating: false,
    translationError: null,
  };
  return {
    I18nProvider: ({ children }) => children,
    useTranslation: () => ctx,
    I18nContext: React.createContext(ctx),
  };
});

// react-native-tts — module loads under Jest (native side missing), so mock
// explicitly to prevent runtime crashes when screens call Tts.stop() etc.
jest.mock('react-native-tts', () => ({
  __esModule: true,
  default: {
    setDefaultLanguage: jest.fn(() => Promise.resolve()),
    setDefaultRate: jest.fn(() => Promise.resolve()),
    speak: jest.fn(() => Promise.resolve()),
    stop: jest.fn(() => Promise.resolve()),
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
    removeAllListeners: jest.fn(),
    pause: jest.fn(() => Promise.resolve()),
    resume: jest.fn(() => Promise.resolve()),
  },
}));

// expo-speech-recognition — provide the hook and module shapes screens use.
jest.mock('expo-speech-recognition', () => ({
  useSpeechRecognitionEvent: jest.fn(),
  ExpoSpeechRecognitionModule: {
    start: jest.fn(),
    stop: jest.fn(),
    abort: jest.fn(),
    requestPermissionsAsync: jest.fn(() => Promise.resolve({ status: 'granted' })),
  },
  getSupportedLocales: jest.fn(() => Promise.resolve({ locales: [] })),
}));

// expo-audio — stub recorder APIs.
jest.mock('expo-audio', () => ({
  useAudioRecorder: () => ({
    prepare: jest.fn(() => Promise.resolve()),
    record: jest.fn(() => Promise.resolve()),
    stop: jest.fn(() => Promise.resolve()),
    getURI: jest.fn(() => null),
  }),
  AudioModule: {
    requestRecordingPermissionsAsync: jest.fn(() => Promise.resolve({ status: 'granted' })),
  },
  RecordingPresets: { HIGH_QUALITY: {} },
}));

// Individual screen tests mock `src/api/backendClient` themselves if needed —
// we do not stub it globally because `backendClient.test.js` exercises the
// real implementation.

// Global fetch mock
global.fetch = jest.fn();

// __DEV__ global
global.__DEV__ = true;

// Silence console noise in tests
jest.spyOn(console, 'error').mockImplementation(() => {});
jest.spyOn(console, 'warn').mockImplementation(() => {});
jest.spyOn(console, 'log').mockImplementation(() => {});
jest.spyOn(console, 'debug').mockImplementation(() => {});

// Asset mock (for image imports)
module.exports = 'test-asset-stub';
