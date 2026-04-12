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

// React Native Platform mock
jest.mock('react-native/Libraries/Utilities/Platform', () => ({
  OS: 'android',
  Version: 33,
  select: jest.fn((obj) => obj.android || obj.default),
}));

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
