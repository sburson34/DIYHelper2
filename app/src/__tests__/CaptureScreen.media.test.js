// The capture screen's two media guards:
//   (a) "Record Video" is only offered when the backend can actually process a
//       clip. FeatureFlags.VideoAnalysis is off by default, and /api/analyze
//       rejects video items with 400 video_not_supported — so an always-visible
//       button was a path that could only ever fail.
//   (b) Photos are capped at 3, matching MediaValidation.MaxMediaItems. Past
//       that the backend 400s the whole analyze call, so the 4th photo used to
//       cost the user their entire request with no warning.

jest.mock('expo-camera', () => ({
  CameraView: () => null,
  useCameraPermissions: () => [{ granted: true }, jest.fn()],
}));

jest.mock('../utils/storage', () => ({
  getUserProfile: jest.fn(() => Promise.resolve({ name: 'Tester', email: 't@example.com', phone: '' })),
  saveLocalHelpRequest: jest.fn(() => Promise.resolve()),
  getMostRecentProject: jest.fn(() => Promise.resolve(null)),
}));

jest.mock('../api/backendClient', () => ({
  analyzeProject: jest.fn(() => Promise.resolve({ title: 'Stub', steps: [] })),
  submitHelpRequest: jest.fn(() => Promise.resolve({ id: 1 })),
  getClarifyingQuestions: jest.fn(() => Promise.resolve({ questions: [] })),
  getFeatures: jest.fn(() => Promise.resolve({})),
}));

jest.mock('../services/monitoring', () => ({
  reportError: jest.fn(),
  reportHandledError: jest.fn(),
  addBreadcrumb: jest.fn(),
}));

jest.mock('../mlkit/imageLabeling', () => ({ labelImage: jest.fn(() => Promise.resolve([])) }));
jest.mock('../mlkit/entityExtraction', () => ({ extractEntities: jest.fn(() => Promise.resolve([])) }));
jest.mock('../components/ImageLabelsChip', () => () => null);
jest.mock('../components/ExtractedEntitiesBar', () => () => null);
jest.mock('../utils/captureBus', () => ({ subscribeReset: jest.fn(() => jest.fn()), requestCaptureReset: jest.fn() }));

// The flag value under test. Overridden per-test via mockFeatures.
let mockFeatures = {};
jest.mock('../config/features', () => ({
  useFeatures: () => mockFeatures,
  DEFAULT_FEATURES: {},
}));

const { renderWithNav: renderScreen } = require('@sburson34/mobile-shared/testing');
// Required once at module scope on purpose: re-requiring under jest.resetModules()
// would load a second copy of React and every render would fail as an invalid
// hook call. The mock factory closes over `mockFeatures`, so varying the flag
// between tests needs no module reset.
const CaptureScreen = require('../screens/CaptureScreen').default;

describe('CaptureScreen media guards', () => {
  beforeEach(() => {
    mockFeatures = {};
  });

  const render = () => renderScreen(CaptureScreen);

  it('hides Record Video when videoAnalysis is off', () => {
    mockFeatures = { videoAnalysis: false };
    const { queryByText } = render();
    expect(queryByText('Record Video')).toBeNull();
    // The photo path is unaffected — this gate is video-only.
    expect(queryByText('Take Photo')).not.toBeNull();
  });

  it('shows Record Video when videoAnalysis is on', () => {
    mockFeatures = { videoAnalysis: true };
    const { queryByText } = render();
    expect(queryByText('Record Video')).not.toBeNull();
  });

  it('leaves the photo button enabled with no media attached', () => {
    mockFeatures = { videoAnalysis: false };
    const { queryByLabelText } = render();
    const photo = queryByLabelText('Take a photo of your repair issue');
    expect(photo).not.toBeNull();
    // accessibilityState mirrors the disabled prop, so this is the same signal a
    // screen reader gets.
    expect(photo.props.accessibilityState?.disabled).toBeFalsy();
  });
});
