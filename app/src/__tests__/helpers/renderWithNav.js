// Test helper: render a screen component with a mock `navigation` prop and a
// configurable `route.params`. Returns the @testing-library/react-native
// render result plus the mock navigation so tests can assert
// `navigate`/`push`/etc. calls.
//
// We deliberately do NOT wire up a real NavigationContainer — the static
// scanner (scripts/check-navigation.js) already verifies that every target
// string resolves to a reachable route. These tests only need to confirm
// each screen fires the expected navigation call when the user taps.

const React = require('react');
const { render, fireEvent, waitFor, act } = require('@testing-library/react-native');

function makeNavigation(overrides = {}) {
  const listeners = {};
  return {
    navigate: jest.fn(),
    push: jest.fn(),
    replace: jest.fn(),
    goBack: jest.fn(),
    reset: jest.fn(),
    dispatch: jest.fn(),
    setOptions: jest.fn(),
    setParams: jest.fn(),
    openDrawer: jest.fn(),
    closeDrawer: jest.fn(),
    toggleDrawer: jest.fn(),
    canGoBack: jest.fn(() => true),
    isFocused: jest.fn(() => true),
    addListener: jest.fn((event, cb) => {
      listeners[event] = cb;
      return () => { delete listeners[event]; };
    }),
    removeListener: jest.fn(),
    emit: (event, data) => { if (listeners[event]) listeners[event](data); },
    _listeners: listeners,
    ...overrides,
  };
}

function renderScreen(Component, { params = {}, navigation: navOverrides, ...extraProps } = {}) {
  const navigation = makeNavigation(navOverrides);
  const route = { key: 'test-route', name: 'TestRoute', params };
  let utils;
  try {
    utils = render(React.createElement(Component, { navigation, route, ...extraProps }));
  } catch (e) {
    // React collapses render errors into AggregateError with an opaque message.
    // Surface the underlying cause(s) so test failures are debuggable.
    if (e && Array.isArray(e.errors) && e.errors.length > 0) {
      const first = e.errors[0];
      const msg = (first && (first.stack || first.message)) || String(first);
      const err = new Error(`Render failed: ${msg}`);
      err.stack = msg;
      throw err;
    }
    throw e;
  }
  return { ...utils, navigation, route };
}

module.exports = { renderScreen, makeNavigation, fireEvent, waitFor, act };
