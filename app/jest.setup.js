// Jest setup — shared mocks from @sburson34/mobile-shared/testing plus the
// DIY-specific stubs the shared package doesn't know about (DIY i18n context,
// react-native-tts, expo-speech-recognition, expo-audio).
//
// The shared call installs jest.mock(...) for:
//   - @react-native-async-storage/async-storage (stateful in-memory)
//   - expo-secure-store, expo-notifications, expo-constants
//   - @sentry/react-native
//   - react-native-safe-area-context (real React contexts, zero insets)
//   - @expo/vector-icons (every family becomes a no-op host)
//   - react-native-gesture-handler (passthrough)
//   - react-native-reanimated (passthrough)
//
// Anything else DIY relies on stays below.

const { setupSharedJestMocks } = require('@sburson34/mobile-shared/testing');
setupSharedJestMocks();

// AsyncStorage — override the shared package's Map-backed mock with one
// backed by a plain object exposed as `_store`. DIY's storage.test.js asserts
// directly against `AsyncStorage._store['@analyze_cache']` (a dict, not a
// Map), so the shared mock breaks the cache-eviction assertion. Same
// jest.doMock dance as below: we run AFTER setupSharedJestMocks() so this
// registration wins.
jest.doMock('@react-native-async-storage/async-storage', () => {
  const store = {};
  return {
    __esModule: true,
    default: {
      getItem: jest.fn((key) => Promise.resolve(store[key] ?? null)),
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
      getAllKeys: jest.fn(() => Promise.resolve(Object.keys(store))),
      multiGet: jest.fn((keys) =>
        Promise.resolve(keys.map((k) => [k, store[k] ?? null])),
      ),
      multiSet: jest.fn((pairs) => {
        for (const [k, v] of pairs) store[k] = v;
        return Promise.resolve();
      }),
      multiRemove: jest.fn((keys) => {
        for (const k of keys) delete store[k];
        return Promise.resolve();
      }),
      _store: store,
      _reset: () => {
        Object.keys(store).forEach((key) => delete store[key]);
      },
    },
  };
}, { virtual: true });

// expo-secure-store — override the shared package's stateless stub with a
// stateful in-memory store + a `_reset()` escape hatch. DIY's storage.test.js
// + several other suites call SecureStore._reset() in beforeEach to start
// clean, so the shared mock (which lacks _reset) would NPE every test.
//
// jest.doMock (NOT jest.mock) is required here: jest.mock gets hoisted to
// the top of the file by Babel and would run BEFORE setupSharedJestMocks(),
// letting the shared mock overwrite it. jest.doMock isn't hoisted, so it
// runs after the shared call and its registration wins.
jest.doMock('expo-secure-store', () => {
  const store = {};
  return {
    __esModule: true,
    getItemAsync: jest.fn((key) => Promise.resolve(store[key] ?? null)),
    setItemAsync: jest.fn((key, value) => {
      store[key] = value;
      return Promise.resolve();
    }),
    deleteItemAsync: jest.fn((key) => {
      delete store[key];
      return Promise.resolve();
    }),
    _reset: () => {
      Object.keys(store).forEach((key) => delete store[key]);
    },
  };
}, { virtual: true });

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

// DIY i18n — resolve keys against the English catalogue so tests can match the
// same user-visible strings that the app renders. Fall back to the key name
// when a key isn't in the catalogue, so pre-existing tests that asserted on
// key strings continue to work. The shared package doesn't ship this because
// each app owns its own translations module.
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

// react-native-tts — DIY-only; module loads under Jest (native side missing),
// so mock explicitly to prevent runtime crashes when screens call Tts.stop().
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

// expo-speech-recognition — provide the hook + module shapes screens use.
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

// expo-audio — DIY uses the recorder API; stub it.
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

// Global fetch mock — resilience.test.tsx replaces this on a per-test basis.
global.fetch = jest.fn();

// __DEV__ global
global.__DEV__ = true;

// Silence console noise in tests
jest.spyOn(console, 'error').mockImplementation(() => {});
jest.spyOn(console, 'warn').mockImplementation(() => {});
jest.spyOn(console, 'log').mockImplementation(() => {});
jest.spyOn(console, 'debug').mockImplementation(() => {});

// Asset mock (for image imports — jest.config.js moduleNameMapper points at
// this file for .png/.jpg/etc.)
module.exports = 'test-asset-stub';
