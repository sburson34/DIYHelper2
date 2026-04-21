const React = require('react');
const { act, render } = require('@testing-library/react-native');
const { Text } = require('react-native');

const { ThemeProvider, useAppTheme } = require('../ThemeContext');
const AsyncStorage = require('@react-native-async-storage/async-storage').default;

function Probe({ onReady }) {
  const ctx = useAppTheme();
  React.useEffect(() => { onReady(ctx); }, [ctx, onReady]);
  return React.createElement(Text, null, ctx.isDark ? 'dark' : 'light');
}

describe('ThemeContext', () => {
  beforeEach(() => {
    AsyncStorage._reset();
  });

  it('defaults to light when no preference is stored', async () => {
    let captured;
    render(
      React.createElement(ThemeProvider, null,
        React.createElement(Probe, { onReady: (ctx) => { captured = ctx; } }),
      ),
    );
    await act(async () => { await Promise.resolve(); });
    expect(captured.isDark).toBe(false);
  });

  it('toggleDark flips state and persists to storage', async () => {
    let captured;
    render(
      React.createElement(ThemeProvider, null,
        React.createElement(Probe, { onReady: (ctx) => { captured = ctx; } }),
      ),
    );
    await act(async () => { await Promise.resolve(); });

    await act(async () => { await captured.toggleDark(); });
    expect(captured.isDark).toBe(true);

    const raw = await AsyncStorage.getItem('@app_prefs');
    expect(raw).toBeTruthy();
    expect(JSON.parse(raw).darkMode).toBe(true);
  });

  it('reads persisted darkMode on mount', async () => {
    await AsyncStorage.setItem('@app_prefs', JSON.stringify({
      darkMode: true,
      skillLevel: 'intermediate',
      zip: '',
      remindersEnabled: true,
      reminderDays: 3,
    }));

    let captured;
    render(
      React.createElement(ThemeProvider, null,
        React.createElement(Probe, { onReady: (ctx) => { captured = ctx; } }),
      ),
    );
    await act(async () => { await Promise.resolve(); });
    expect(captured.isDark).toBe(true);
  });
});
