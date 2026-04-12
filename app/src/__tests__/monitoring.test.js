jest.mock('../config/sentry', () => ({ SENTRY_ENABLED: true }));
jest.mock('../services/sentry', () => ({
  captureException: jest.fn(),
  captureMessage: jest.fn(),
  setUserContext: jest.fn(),
  clearUserContext: jest.fn(),
  setAppContext: jest.fn(),
  Sentry: {
    addBreadcrumb: jest.fn(),
    setTag: jest.fn(),
    withScope: jest.fn((cb) => {
      const scope = { setLevel: jest.fn(), setExtra: jest.fn() };
      cb(scope);
    }),
    captureException: jest.fn(),
  },
}));

const {
  reportError,
  reportHandledError,
  reportWarning,
  addBreadcrumb,
  setMonitoringUser,
  clearMonitoringUser,
  setMonitoringTag,
} = require('../services/monitoring');
const { captureException, captureMessage, setUserContext, clearUserContext, Sentry } = require('../services/sentry');

beforeEach(() => {
  jest.clearAllMocks();
});

describe('reportError', () => {
  it('calls captureException with context', () => {
    const err = new Error('test');
    reportError(err, { source: 'TestScreen', operation: 'load', extra: { foo: 'bar' } });
    expect(captureException).toHaveBeenCalledWith(err, expect.objectContaining({
      source: 'TestScreen',
      operation: 'load',
      foo: 'bar',
    }));
  });

  it('handles fatal level via Sentry.withScope', () => {
    const err = new Error('fatal');
    reportError(err, { level: 'fatal', source: 'App' });
    expect(Sentry.withScope).toHaveBeenCalled();
    expect(Sentry.captureException).toHaveBeenCalledWith(err);
  });
});

describe('reportHandledError', () => {
  it('includes handled flag and handler name', () => {
    const err = new Error('handled');
    reportHandledError('CacheFallback', err, { cacheAge: 100 });
    expect(captureException).toHaveBeenCalledWith(err, expect.objectContaining({
      handled: true,
      handlerName: 'CacheFallback',
      cacheAge: 100,
    }));
  });
});

describe('reportWarning', () => {
  it('calls captureMessage with warning level', () => {
    reportWarning('something odd', { detail: 'x' });
    expect(captureMessage).toHaveBeenCalledWith('something odd', 'warning', { detail: 'x' });
  });
});

describe('addBreadcrumb', () => {
  it('calls Sentry.addBreadcrumb when enabled', () => {
    addBreadcrumb('user clicked button', 'user.action', { screen: 'Home' });
    expect(Sentry.addBreadcrumb).toHaveBeenCalledWith(expect.objectContaining({
      message: 'user clicked button',
      category: 'user.action',
      level: 'info',
      data: { screen: 'Home' },
    }));
  });

  it('uses default category "app"', () => {
    addBreadcrumb('test');
    expect(Sentry.addBreadcrumb).toHaveBeenCalledWith(expect.objectContaining({
      category: 'app',
    }));
  });
});

describe('setMonitoringUser', () => {
  it('delegates to setUserContext', () => {
    setMonitoringUser({ id: '123', email: 'test@t.com' });
    expect(setUserContext).toHaveBeenCalledWith({ id: '123', email: 'test@t.com' });
  });
});

describe('clearMonitoringUser', () => {
  it('delegates to clearUserContext', () => {
    clearMonitoringUser();
    expect(clearUserContext).toHaveBeenCalled();
  });
});

describe('setMonitoringTag', () => {
  it('calls Sentry.setTag', () => {
    setMonitoringTag('skillLevel', 'advanced');
    expect(Sentry.setTag).toHaveBeenCalledWith('skillLevel', 'advanced');
  });
});
