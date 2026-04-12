// Test the sentry.js module's scrubbing and helper functions

jest.mock('../config/sentry', () => ({
  SENTRY_DSN: 'https://fake@sentry.io/123',
  SENTRY_ENABLED: true,
  SENTRY_ENVIRONMENT: 'test',
  SENTRY_RELEASE: 'test@1.0.0',
  SENTRY_TRACES_SAMPLE_RATE: 0,
}));
jest.mock('../config/appInfo', () => ({
  APP_VERSION: '1.0.0',
  BUILD_NUMBER: '1',
  GIT_COMMIT: 'abc123',
  APP_PLATFORM: 'android',
  OS_VERSION: '33',
}));

const Sentry = require('@sentry/react-native');

beforeEach(() => {
  jest.clearAllMocks();
  // Reset module registry so initSentry's `initialized` flag is cleared
  jest.resetModules();
});

function loadSentryModule() {
  // Re-mock dependencies after resetModules
  jest.mock('../config/sentry', () => ({
    SENTRY_DSN: 'https://fake@sentry.io/123',
    SENTRY_ENABLED: true,
    SENTRY_ENVIRONMENT: 'test',
    SENTRY_RELEASE: 'test@1.0.0',
    SENTRY_TRACES_SAMPLE_RATE: 0,
  }));
  jest.mock('../config/appInfo', () => ({
    APP_VERSION: '1.0.0',
    BUILD_NUMBER: '1',
    GIT_COMMIT: 'abc123',
    APP_PLATFORM: 'android',
    OS_VERSION: '33',
  }));
  return require('../services/sentry');
}

describe('initSentry', () => {
  it('calls Sentry.init with correct config', () => {
    const { initSentry } = loadSentryModule();
    initSentry();
    const SentryMock = require('@sentry/react-native');
    expect(SentryMock.init).toHaveBeenCalledWith(expect.objectContaining({
      dsn: 'https://fake@sentry.io/123',
      environment: 'test',
      release: 'test@1.0.0',
      tracesSampleRate: 0,
      sendDefaultPii: false,
    }));
  });

  it('sets app tags after init', () => {
    const { initSentry } = loadSentryModule();
    initSentry();
    const SentryMock = require('@sentry/react-native');
    expect(SentryMock.setTag).toHaveBeenCalledWith('app.version', '1.0.0');
    expect(SentryMock.setTag).toHaveBeenCalledWith('app.build', '1');
    expect(SentryMock.setTag).toHaveBeenCalledWith('app.platform', 'android');
    expect(SentryMock.setTag).toHaveBeenCalledWith('app.commit', 'abc123');
  });

  it('sets app context', () => {
    const { initSentry } = loadSentryModule();
    initSentry();
    const SentryMock = require('@sentry/react-native');
    expect(SentryMock.setContext).toHaveBeenCalledWith('app', expect.objectContaining({
      app_version: '1.0.0',
      build_number: '1',
      platform: 'android',
    }));
  });
});

describe('captureException', () => {
  it('calls Sentry.withScope and captureException', () => {
    const { captureException } = loadSentryModule();
    const SentryMock = require('@sentry/react-native');
    const err = new Error('test');
    captureException(err, { source: 'TestScreen' });
    expect(SentryMock.withScope).toHaveBeenCalled();
    expect(SentryMock.captureException).toHaveBeenCalledWith(err);
  });
});

describe('captureMessage', () => {
  it('calls Sentry.withScope with level', () => {
    const { captureMessage } = loadSentryModule();
    const SentryMock = require('@sentry/react-native');
    captureMessage('test message', 'warning', { detail: 'x' });
    expect(SentryMock.withScope).toHaveBeenCalled();
    expect(SentryMock.captureMessage).toHaveBeenCalledWith('test message');
  });
});

describe('setUserContext', () => {
  it('sets user with string id', () => {
    const { setUserContext } = loadSentryModule();
    const SentryMock = require('@sentry/react-native');
    setUserContext({ id: 123, email: 'test@t.com' });
    expect(SentryMock.setUser).toHaveBeenCalledWith(expect.objectContaining({
      id: '123',
      email: 'test@t.com',
    }));
  });
});

describe('clearUserContext', () => {
  it('clears user context', () => {
    const { clearUserContext } = loadSentryModule();
    const SentryMock = require('@sentry/react-native');
    clearUserContext();
    expect(SentryMock.setUser).toHaveBeenCalledWith(null);
  });
});

describe('setAppContext', () => {
  it('sets context with scrubbed data', () => {
    const { setAppContext } = loadSentryModule();
    const SentryMock = require('@sentry/react-native');
    setAppContext('prefs', { theme: 'dark', token: 'secret123' });
    expect(SentryMock.setContext).toHaveBeenCalledWith('prefs', expect.objectContaining({
      theme: 'dark',
      token: '[redacted]',
    }));
  });
});
