// Verify the local ScreenErrorBoundary wrapper passes the app's theme to
// the shared boundary and forwards other props. The shared boundary's
// internal behavior (componentDidCatch, fallback rendering, reset) is
// tested in @sburson34/mobile-shared and not re-tested here.

jest.mock('@sburson34/mobile-shared/error-boundary', () => ({
  ScreenErrorBoundary: jest.fn(({ children }) => children ?? null),
}));
jest.mock('../theme', () => ({
  __esModule: true,
  default: {
    colors: {
      background: '#FFF',
      danger: '#FF0000',
      text: '#000',
      textSecondary: '#666',
      primary: '#FCA004',
    },
    roundness: { medium: 8 },
  },
}));

const React = require('react');
const { render } = require('@testing-library/react-native');
const ScreenErrorBoundary = require('../components/ScreenErrorBoundary').default;
const { ScreenErrorBoundary: SharedScreenErrorBoundary } = require('@sburson34/mobile-shared/error-boundary');

beforeEach(() => {
  jest.clearAllMocks();
});

describe('ScreenErrorBoundary (wrapper)', () => {
  it('renders the shared ScreenErrorBoundary with theme derived from app theme', () => {
    render(
      React.createElement(ScreenErrorBoundary, { screenName: 'CaptureScreen' }, 'child'),
    );

    expect(SharedScreenErrorBoundary).toHaveBeenCalled();
    const props = SharedScreenErrorBoundary.mock.calls[0][0];
    expect(props.screenName).toBe('CaptureScreen');
    expect(props.theme).toEqual({
      background: '#FFF',
      text: '#000',
      textSecondary: '#666',
      danger: '#FF0000',
      primary: '#FCA004',
      buttonText: '#FFFFFF',
      roundness: 8,
    });
  });

  it('forwards onReset and fallback props', () => {
    const onReset = jest.fn();
    const fallback = jest.fn();
    render(
      React.createElement(ScreenErrorBoundary, { onReset, fallback }, 'child'),
    );

    const props = SharedScreenErrorBoundary.mock.calls[0][0];
    expect(props.onReset).toBe(onReset);
    expect(props.fallback).toBe(fallback);
  });

  it('forwards children', () => {
    render(
      React.createElement(ScreenErrorBoundary, {}, 'hello'),
    );

    const props = SharedScreenErrorBoundary.mock.calls[0][0];
    expect(props.children).toBe('hello');
  });
});
