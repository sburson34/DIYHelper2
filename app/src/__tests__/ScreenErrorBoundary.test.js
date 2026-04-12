// Test the ScreenErrorBoundary class component logic directly

jest.mock('../services/monitoring', () => ({
  reportError: jest.fn(),
}));
jest.mock('../theme', () => ({
  colors: {
    background: '#FFF',
    danger: '#FF0000',
    text: '#000',
    textSecondary: '#666',
    primary: '#FCA004',
  },
  roundness: { medium: 8 },
}));

const ScreenErrorBoundary = require('../components/ScreenErrorBoundary').default;
const { reportError } = require('../services/monitoring');

beforeEach(() => {
  jest.clearAllMocks();
});

describe('ScreenErrorBoundary', () => {
  it('is a React component class', () => {
    expect(typeof ScreenErrorBoundary).toBe('function');
    expect(ScreenErrorBoundary.getDerivedStateFromError).toBeDefined();
  });

  it('getDerivedStateFromError returns error state', () => {
    const error = new Error('test');
    const state = ScreenErrorBoundary.getDerivedStateFromError(error);
    expect(state).toEqual({ error });
  });

  it('componentDidCatch reports error with screenName', () => {
    const instance = new ScreenErrorBoundary({ screenName: 'CaptureScreen' });
    const error = new Error('render crash');
    const info = { componentStack: 'at Foo\nat Bar' };

    instance.componentDidCatch(error, info);

    expect(reportError).toHaveBeenCalledWith(error, {
      source: 'CaptureScreen',
      operation: 'render',
      extra: { componentStack: 'at Foo\nat Bar' },
    });
  });

  it('componentDidCatch uses default name when screenName not provided', () => {
    const instance = new ScreenErrorBoundary({});
    const error = new Error('test');
    instance.componentDidCatch(error, {});

    expect(reportError).toHaveBeenCalledWith(error, expect.objectContaining({
      source: 'ScreenErrorBoundary',
    }));
  });

  it('componentDidCatch truncates componentStack to 1000 chars', () => {
    const instance = new ScreenErrorBoundary({ screenName: 'Test' });
    const longStack = 'x'.repeat(2000);
    instance.componentDidCatch(new Error('test'), { componentStack: longStack });

    const reported = reportError.mock.calls[0][1].extra.componentStack;
    expect(reported.length).toBe(1000);
  });

  it('reset method clears error state and calls onReset', () => {
    const onReset = jest.fn();
    const instance = new ScreenErrorBoundary({ onReset });
    instance.setState = jest.fn();

    instance.reset();

    expect(instance.setState).toHaveBeenCalledWith({ error: null });
    expect(onReset).toHaveBeenCalled();
  });

  it('reset works without onReset prop', () => {
    const instance = new ScreenErrorBoundary({});
    instance.setState = jest.fn();

    // Should not throw
    instance.reset();
    expect(instance.setState).toHaveBeenCalledWith({ error: null });
  });

  it('initial state has no error', () => {
    const instance = new ScreenErrorBoundary({});
    expect(instance.state).toEqual({ error: null });
  });
});
