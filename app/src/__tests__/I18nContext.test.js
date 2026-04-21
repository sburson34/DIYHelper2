// Exercises the real I18nContext implementation (bypassing the global stub
// installed in jest.setup.js). Covers the two branches every screen depends on:
// hardcoded locales (en/es render instantly from the bundled table) and
// dynamic locales (fetched from the backend translate proxy, cached per-device).

jest.unmock('../i18n/I18nContext');
jest.mock('../api/backendClient', () => ({
  translateStrings: jest.fn(),
}));

const React = require('react');
const { act, render } = require('@testing-library/react-native');
const { Text } = require('react-native');

const AsyncStorage = require('@react-native-async-storage/async-storage').default;
const { I18nProvider, useTranslation } = jest.requireActual('../i18n/I18nContext');
const { translateStrings } = require('../api/backendClient');

function Probe({ onReady }) {
  const ctx = useTranslation();
  React.useEffect(() => {
    onReady(ctx);
  }, [ctx, onReady]);
  return React.createElement(Text, null, ctx.t('save'));
}

describe('I18nContext', () => {
  beforeEach(() => {
    AsyncStorage._reset();
    translateStrings.mockReset();
  });

  it('t() falls back to key when missing from the English catalog', async () => {
    let captured;
    render(
      React.createElement(I18nProvider, null,
        React.createElement(Probe, { onReady: (ctx) => { captured = ctx; } }),
      ),
    );

    // Flush effects
    await act(async () => { await Promise.resolve(); });

    expect(captured.language).toBe('en');
    expect(captured.t('totally_made_up_key_xyz')).toBe('totally_made_up_key_xyz');
  });

  it('t() returns the English string for a known key by default', async () => {
    let captured;
    render(
      React.createElement(I18nProvider, null,
        React.createElement(Probe, { onReady: (ctx) => { captured = ctx; } }),
      ),
    );
    await act(async () => { await Promise.resolve(); });
    // 'privacy_policy' is a known English string in translations.ts
    expect(captured.t('privacy_policy')).toBe('Privacy Policy');
  });

  it('switching to es serves bundled Spanish strings with no network call', async () => {
    let captured;
    render(
      React.createElement(I18nProvider, null,
        React.createElement(Probe, { onReady: (ctx) => { captured = ctx; } }),
      ),
    );
    await act(async () => { await Promise.resolve(); });

    await act(async () => { await captured.setLanguage('es'); });

    expect(captured.language).toBe('es');
    expect(captured.t('privacy_policy')).toBe('Política de Privacidad');
    expect(translateStrings).not.toHaveBeenCalled();
  });

  it('switching to a dynamic locale calls the translate proxy and caches the result', async () => {
    let captured;
    render(
      React.createElement(I18nProvider, null,
        React.createElement(Probe, { onReady: (ctx) => { captured = ctx; } }),
      ),
    );
    await act(async () => { await Promise.resolve(); });

    // Return one translated string per English key; we check one sentinel below.
    translateStrings.mockImplementation((texts) =>
      Promise.resolve(texts.map((t) => `[fr]${t}`)),
    );

    await act(async () => { await captured.setLanguage('fr'); });

    expect(translateStrings).toHaveBeenCalledTimes(1);
    expect(captured.t('privacy_policy')).toBe('[fr]Privacy Policy');

    // Cached in AsyncStorage under @translations_fr
    const raw = await AsyncStorage.getItem('@translations_fr');
    expect(raw).toBeTruthy();
    const parsed = JSON.parse(raw);
    expect(parsed.privacy_policy).toBe('[fr]Privacy Policy');
  });

  it('falls back to English when the translate proxy throws', async () => {
    let captured;
    render(
      React.createElement(I18nProvider, null,
        React.createElement(Probe, { onReady: (ctx) => { captured = ctx; } }),
      ),
    );
    await act(async () => { await Promise.resolve(); });

    translateStrings.mockRejectedValueOnce(new Error('translate 502'));

    await act(async () => { await captured.setLanguage('de'); });

    expect(captured.translationError).toBe('translate 502');
    // Still serves English as fallback — no broken UI.
    expect(captured.t('privacy_policy')).toBe('Privacy Policy');
  });
});
