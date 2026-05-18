// Button-press assertion tests for the screens whose primary CTAs were
// previously only covered by render-only smoke tests. The goal is one
// "press the button → expected service call happens" test per screen so
// the matrix in docs/TEST-COVERAGE.md has zero yellow rows.
//
// Each describe-block mocks the same set of dependencies the existing
// screens.smoke.test.js mocks, then exercises a specific CTA and asserts
// against the mock (`expect(serviceMock).toHaveBeenCalledWith(...)`).
//
// We deliberately re-mock per-screen rather than relying on the
// screens.smoke shared mock because each suite needs to track its own
// fresh `jest.fn()` for the service it cares about — otherwise stale
// call counts from earlier suites leak through.

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({
    navigate: jest.fn(),
    goBack: jest.fn(),
    addListener: jest.fn(() => jest.fn()),
    setOptions: jest.fn(),
  }),
  useNavigationState: (selector) => (selector ? selector({ routes: [{ name: 'Test' }], index: 0 }) : null),
  useRoute: () => ({ params: {} }),
  useFocusEffect: (cb) => { const cleanup = cb && cb(); return cleanup; },
}));

jest.mock('../utils/storage', () => ({
  getUserProfile: jest.fn(() => Promise.resolve({ name: '', email: '', phone: '' })),
  saveLocalHelpRequest: jest.fn(() => Promise.resolve()),
  getToolInventory: jest.fn(() => Promise.resolve([])),
  addToInventory: jest.fn(() => Promise.resolve()),
  removeFromInventory: jest.fn(() => Promise.resolve()),
  findInventoryByBarcode: jest.fn(() => Promise.resolve(null)),
  setAiConsent: jest.fn(() => Promise.resolve()),
  getAppPrefs: jest.fn(() => Promise.resolve({})),
  setAppPrefs: jest.fn(() => Promise.resolve()),
  clearAllUserData: jest.fn(() => Promise.resolve()),
}));

jest.mock('../api/backendClient', () => ({
  diagnoseProblem: jest.fn(() => Promise.resolve({ possible_causes: [], urgency: 'low' })),
  askHelper: jest.fn(() => Promise.resolve({ answer: 'stub answer' })),
  analyzeProject: jest.fn(() => Promise.resolve({ title: 'Stub', steps: [] })),
  liveDiyAnalyze: jest.fn(() => Promise.resolve({ answer: 'stub' })),
}));

jest.mock('../services/feedback', () => ({
  submitFeedback: jest.fn(() => Promise.resolve()),
}));

jest.mock('../services/monitoring', () => ({
  reportError: jest.fn(),
  reportHandledError: jest.fn(),
  reportWarning: jest.fn(),
  addBreadcrumb: jest.fn(),
}));

jest.mock('../services/sentry', () => ({
  Sentry: { captureException: jest.fn(), captureMessage: jest.fn() },
  navigationIntegration: { registerNavigationContainer: jest.fn() },
}));

jest.mock('../ThemeContext', () => ({
  useAppTheme: () => ({ isDark: false, toggleDark: () => {} }),
  ThemeProvider: ({ children }) => children,
}));

// Stub Linking by patching it on the react-native module object. The
// path-based jest.mock target depends on RN version internals; this
// approach is portable across versions.

jest.mock('expo-camera', () => ({
  CameraView: () => null,
  useCameraPermissions: () => [{ granted: true }, jest.fn(() => Promise.resolve({ granted: true }))],
}));

jest.mock('../components/BarcodeScannerModal', () => () => null);

// Silence the alert side-channel — RN's Alert.alert isn't a jest fn by default.
import { Alert, Linking } from 'react-native';
jest.spyOn(Alert, 'alert').mockImplementation(() => {});
jest.spyOn(Linking, 'openURL').mockImplementation(() => Promise.resolve());

const { fireEvent, waitFor, act } = require('@testing-library/react-native');
const { renderScreen } = require('./helpers/renderWithNav');

// ── AiConsentScreen ───────────────────────────────────────────────────

describe('AiConsentScreen', () => {
  const { setAiConsent } = require('../utils/storage');

  beforeEach(() => {
    setAiConsent.mockClear();
  });

  it('accept button calls setAiConsent(true) and invokes onAccept', async () => {
    const AiConsentScreen = require('../screens/AiConsentScreen').default;
    const onAccept = jest.fn();
    const { getByLabelText } = renderScreen(AiConsentScreen, { onAccept });

    await act(async () => {
      fireEvent.press(getByLabelText('I understand and accept'));
    });

    expect(setAiConsent).toHaveBeenCalledWith(true);
    await waitFor(() => expect(onAccept).toHaveBeenCalled());
  });

  it('decline button surfaces a confirmation Alert', () => {
    const AiConsentScreen = require('../screens/AiConsentScreen').default;
    const { getByLabelText } = renderScreen(AiConsentScreen, {
      onAccept: jest.fn(),
      onDecline: jest.fn(),
    });

    fireEvent.press(getByLabelText('Continue without AI features'));

    // The decline path always pops an Alert before persisting — that
    // confirms users can't accidentally lock themselves out of AI features.
    expect(Alert.alert).toHaveBeenCalled();
    const [title] = Alert.alert.mock.calls[Alert.alert.mock.calls.length - 1];
    expect(title).toMatch(/without AI/i);
  });
});

// ── Diagnose ──────────────────────────────────────────────────────────

describe('Diagnose', () => {
  const { diagnoseProblem } = require('../api/backendClient');

  beforeEach(() => {
    diagnoseProblem.mockClear();
  });

  it('Diagnose button calls backendClient.diagnoseProblem with the description', async () => {
    const Diagnose = require('../screens/Diagnose').default;
    const { getByTestId } = renderScreen(Diagnose);

    // Use stable testIDs added to the input + run button so this test
    // doesn't break if the i18n string or the screen header copy changes.
    const description = 'water under the sink, smells musty';
    fireEvent.changeText(getByTestId('diagnose-description-input'), description);

    await act(async () => { fireEvent.press(getByTestId('diagnose-run-button')); });

    await waitFor(() => expect(diagnoseProblem).toHaveBeenCalledTimes(1));
    expect(diagnoseProblem.mock.calls[0][0]).toMatchObject({ description, language: 'en' });
  });

  it('Diagnose button does NOT call the API when description is empty', async () => {
    const Diagnose = require('../screens/Diagnose').default;
    const { getByTestId } = renderScreen(Diagnose);

    await act(async () => { fireEvent.press(getByTestId('diagnose-run-button')); });

    // No network call when validation rejects — important for not burning
    // OpenAI tokens on accidental taps with an empty field.
    expect(diagnoseProblem).not.toHaveBeenCalled();
    expect(Alert.alert).toHaveBeenCalled();
  });
});

// ── ReportProblem ─────────────────────────────────────────────────────

describe('ReportProblem', () => {
  const { submitFeedback } = require('../services/feedback');

  beforeEach(() => {
    submitFeedback.mockClear();
  });

  it('Submit button calls submitFeedback with the typed description', async () => {
    const ReportProblem = require('../screens/ReportProblem').default;
    const { getByLabelText } = renderScreen(ReportProblem);

    fireEvent.changeText(
      getByLabelText(/what went wrong/i),
      'crashed on startup',
    );

    await act(async () => { fireEvent.press(getByLabelText(/submit report/i)); });

    await waitFor(() => expect(submitFeedback).toHaveBeenCalledTimes(1));
    expect(submitFeedback.mock.calls[0][0]).toMatchObject({
      description: 'crashed on startup',
    });
  });

  it('Submit button does NOT call submitFeedback when description is empty', async () => {
    const ReportProblem = require('../screens/ReportProblem').default;
    const { getByLabelText } = renderScreen(ReportProblem);

    await act(async () => { fireEvent.press(getByLabelText(/submit report/i)); });

    expect(submitFeedback).not.toHaveBeenCalled();
    expect(Alert.alert).toHaveBeenCalled();
  });
});

// ── Inventory ─────────────────────────────────────────────────────────

describe('Inventory', () => {
  const { addToInventory } = require('../utils/storage');

  beforeEach(() => {
    addToInventory.mockClear();
  });

  it('Add button persists the typed tool name via addToInventory', async () => {
    const Inventory = require('../screens/Inventory').default;
    const { getByLabelText } = renderScreen(Inventory);

    fireEvent.changeText(
      getByLabelText(/add a tool or material/i),
      'cordless drill',
    );

    await act(async () => { fireEvent.press(getByLabelText(/add tool to inventory/i)); });

    await waitFor(() => expect(addToInventory).toHaveBeenCalledTimes(1));
    expect(addToInventory.mock.calls[0][0]).toMatchObject({ name: 'cordless drill' });
  });

  it('Add button is a no-op when the input is blank', async () => {
    const Inventory = require('../screens/Inventory').default;
    const { getByLabelText } = renderScreen(Inventory);

    await act(async () => { fireEvent.press(getByLabelText(/add tool to inventory/i)); });

    expect(addToInventory).not.toHaveBeenCalled();
  });
});

// ── Emergency ─────────────────────────────────────────────────────────

describe('Emergency', () => {
  beforeEach(() => {
    Linking.openURL.mockClear();
  });

  it('Call 911 button opens the tel:911 deep link', async () => {
    const Emergency = require('../screens/Emergency').default;
    const { getByTestId } = renderScreen(Emergency);

    // The banner Call 911 CTA gets a stable testID so this test doesn't
    // hinge on which of the three on-screen "Call 911" buttons React Test
    // Renderer happens to return first. The gas + fire scenario CTAs also
    // route through callPro('911'); the banner is the canonical entry point.
    await act(async () => { fireEvent.press(getByTestId('emergency-banner-call-911')); });
    await waitFor(() => expect(Linking.openURL).toHaveBeenCalled());
    expect(Linking.openURL.mock.calls[0][0]).toBe('tel:911');
  });

  it('Find a plumber button opens a Google Maps search', async () => {
    const Emergency = require('../screens/Emergency').default;
    const { getByLabelText } = renderScreen(Emergency);

    const buttons = getByLabelText(/find a plumber/i);
    await act(async () => { fireEvent.press(buttons); });
    await waitFor(() => expect(Linking.openURL).toHaveBeenCalled());
    expect(Linking.openURL.mock.calls[0][0]).toMatch(/google\.com\/maps\/search/);
  });
});

// ── LiveHelpScreen ────────────────────────────────────────────────────
// LiveHelpScreen wires camera + voice + AI streaming. The full happy path
// requires permission-granted camera. We restrict to verifying that the
// "Request permission" CTA (shown when permission is missing) does NOT
// crash and that the screen renders.
//
// The richer permission-granted path is covered indirectly by the
// backendClient.liveDiyAnalyze() unit test and the static navigation scan.

describe('LiveHelpScreen', () => {
  // LiveHelpScreen wires camera + voice + AI streaming. The full happy
  // path requires permission-granted camera. We rely on the shared
  // expo-camera mock at the top of this file (granted: true) and assert
  // that the screen renders without throwing — the richer button paths
  // are too tightly coupled to camera + speech native modules to drive
  // deterministically in Jest, so they live in MANUAL_CHECKLIST.md.
  it('renders without throwing under the default camera-granted mock', () => {
    const LiveHelpScreen = require('../screens/LiveHelpScreen').default;
    const { toJSON } = renderScreen(LiveHelpScreen);
    expect(toJSON()).toBeTruthy();
  });
});
