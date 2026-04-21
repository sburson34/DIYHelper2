// Smoke tests: every screen renders without throwing when supplied with
// reasonable stub params. These do not assert any behaviour — they only
// catch regressions like missing imports, destructuring against undefined
// params, or bad hook setup. Combined with the static navigation scan and
// the per-screen navigation tests, this gives us full screen coverage.

jest.mock('../utils/storage', () => {
  const noop = () => Promise.resolve();
  const empty = () => Promise.resolve([]);
  return {
    getHoneyDoList: empty,
    getContractorList: empty,
    removeFromHoneyDoList: noop,
    removeFromContractorList: noop,
    updateHoneyDoList: noop,
    updateContractorList: noop,
    saveToHoneyDoList: noop,
    saveToContractorList: noop,
    getUserProfile: () => Promise.resolve({}),
    saveUserProfile: noop,
    saveLocalHelpRequest: noop,
    getLocalHelpRequests: empty,
    updateLocalHelpRequest: noop,
    getCommunityOptIn: () => Promise.resolve(false),
    setCommunityOptIn: noop,
    getAppPrefs: () => Promise.resolve({}),
    setAppPrefs: noop,
    getToolInventory: empty,
    addToInventory: noop,
    removeFromInventory: noop,
    findInventoryByBarcode: () => Promise.resolve(null),
    getShoppingBought: () => Promise.resolve({}),
    setShoppingBought: noop,
    getMostRecentProject: () => Promise.resolve(null),
    clearAllUserData: noop,
  };
});

jest.mock('../api/backendClient', () => ({
  diagnoseProblem: jest.fn(() => Promise.resolve({ causes: [] })),
  getWeather: jest.fn(() => Promise.resolve(null)),
  uploadReceipt: jest.fn(() => Promise.resolve({})),
  matchPaintColor: jest.fn(() => Promise.resolve(null)),
  getPropertyValueImpact: jest.fn(() => Promise.resolve(null)),
  getRedditDiscussions: jest.fn(() => Promise.resolve({ threads: [] })),
  submitCommunityProject: jest.fn(() => Promise.resolve()),
  submitHelpRequest: jest.fn(() => Promise.resolve({ id: 1 })),
  askHelper: jest.fn(() => Promise.resolve({ answer: 'stub' })),
  analyzeProject: jest.fn(() => Promise.resolve({ title: 'Stub', steps: [] })),
  browseCommunityProjects: jest.fn(() => Promise.resolve([])),
  getClarifyingQuestions: jest.fn(() => Promise.resolve({ questions: [] })),
  verifyStep: jest.fn(() => Promise.resolve({ rating: 'good', score: 10 })),
}));

jest.mock('../utils/notifications', () => ({
  cancelForProject: jest.fn(() => Promise.resolve()),
  requestPermissions: jest.fn(() => Promise.resolve({ status: 'granted' })),
}));

jest.mock('../services/feedback', () => ({ submitFeedback: jest.fn(() => Promise.resolve()) }));

jest.mock('../services/monitoring', () => ({
  reportError: jest.fn(), reportHandledError: jest.fn(), reportWarning: jest.fn(), addBreadcrumb: jest.fn(),
}));

jest.mock('../services/sentry', () => ({
  Sentry: { captureException: jest.fn(), captureMessage: jest.fn() },
  navigationIntegration: { registerNavigationContainer: jest.fn() },
}));

jest.mock('../ThemeContext', () => ({
  useAppTheme: () => ({ isDark: false, toggleDark: () => {} }),
  ThemeProvider: ({ children }) => children,
}));

jest.mock('../mlkit/TranslationProvider', () => ({
  TranslationProvider: ({ children }) => children,
  useMLTranslation: () => ({ available: false, isModelReady: false, isDownloading: false, downloadModel: jest.fn() }),
}));

jest.mock('../components/BarcodeScannerModal', () => () => null);

jest.mock('expo-camera', () => ({
  CameraView: () => null,
  useCameraPermissions: () => [{ granted: true }, jest.fn()],
}));

jest.mock('expo-image-picker', () => ({
  launchCameraAsync: jest.fn(() => Promise.resolve({ canceled: true })),
  launchImageLibraryAsync: jest.fn(() => Promise.resolve({ canceled: true })),
  MediaTypeOptions: { Images: 'Images' },
  requestCameraPermissionsAsync: jest.fn(() => Promise.resolve({ status: 'granted' })),
  requestMediaLibraryPermissionsAsync: jest.fn(() => Promise.resolve({ status: 'granted' })),
}));

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({
    navigate: jest.fn(),
    goBack: jest.fn(),
    addListener: jest.fn(() => jest.fn()),
    setOptions: jest.fn(),
  }),
  useNavigationState: (selector) => selector ? selector({ routes: [{ name: 'Test' }], index: 0 }) : null,
  useRoute: () => ({ params: {} }),
  useFocusEffect: (cb) => { const cleanup = cb && cb(); return cleanup; },
}));

const { renderScreen } = require('./helpers/renderWithNav');

const sampleProject = {
  title: 'Test project',
  steps: ['One', 'Two'],
  tools_and_materials: [],
  difficulty: 'easy',
  estimated_time: '1 hr',
  estimated_cost: '$10',
  youtube_links: [],
  shopping_links: [],
  safety_tips: [],
  when_to_call_pro: [],
  checkedSteps: [false, false],
};

// Each entry renders a screen and verifies the render returns a tree.
const cases = [
  { name: 'Diagnose',     module: '../screens/Diagnose',          params: {} },
  { name: 'Quotes',       module: '../screens/Quotes',            params: {} },
  { name: 'ReportProblem',module: '../screens/ReportProblem',     params: {} },
  { name: 'ProjDet',      module: '../screens/ProjDet',           params: { project: sampleProject, listType: 'honey-do' } },
  // Object-shaped steps ({text, image_annotations, reference_image_search}) crashed
  // ProjDet.js in prod on 2026-04-17 — rendering them as React children threw
  // "Objects are not valid as a React child". Keep this case to prevent regression.
  {
    name: 'ProjDet (object-shaped steps)',
    module: '../screens/ProjDet',
    params: {
      project: {
        ...sampleProject,
        steps: [
          { text: 'Turn off water', image_annotations: [], reference_image_search: 'shutoff valve' },
          { text: 'Unscrew faucet', image_annotations: [] },
        ],
        checkedSteps: [false, false],
      },
      listType: 'honey-do',
    },
  },
  { name: 'Emergency',    module: '../screens/Emergency',         params: {} },
  { name: 'Inventory',    module: '../screens/Inventory',         params: {} },
  { name: 'ShoppingList', module: '../screens/ShoppingList',      params: {} },
  { name: 'PaintMatch',   module: '../screens/PaintMatchScreen',  params: { base64Image: null, mimeType: 'image/jpeg' } },
  { name: 'Onboarding',   module: '../screens/OnboardingScreen',  params: {}, extraProps: { onFinish: jest.fn() } },
  { name: 'Safety',       module: '../screens/SafetyScreen',      params: { project: sampleProject } },
  { name: 'Settings',     module: '../screens/Settings',          params: {} },
];

describe('screen smoke tests', () => {
  for (const c of cases) {
    // eslint-disable-next-line jest/valid-title
    test(`${c.name} renders without throwing`, () => {
      const Component = require(c.module).default;
      const { toJSON } = renderScreen(Component, { params: c.params, ...(c.extraProps || {}) });
      expect(toJSON()).toBeTruthy();
    });
  }
});
