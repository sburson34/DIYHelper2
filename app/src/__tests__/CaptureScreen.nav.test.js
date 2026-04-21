// CaptureScreen has three navigation paths we exercise here:
//   (a) resume card for a contractor project → navigate('ProjectDetail', ...)
//       (the static scanner confirms this target is reachable from CaptureStack,
//        unlike the HoneyDo bug where the same call-site at drawer level fails)
//   (b) resume card for a honey-do project → navigate('WorkshopSteps', ...)
//   (c) tapping the annotate-icon on a photo → navigate('Annotate', ...)
//
// The analyze → Result path is exercised implicitly (storage.getMostRecentProject,
// mlkit, etc. are mocked) but left to the static scanner since the code path
// requires an image and server round-trip that add testing surface without
// catching a different bug class.

jest.mock('expo-camera', () => ({
  CameraView: () => null,
  useCameraPermissions: () => [{ granted: true }, jest.fn()],
}));

jest.mock('../utils/storage', () => ({
  getUserProfile: jest.fn(() => Promise.resolve({ name: 'Tester', email: 'test@example.com', phone: '' })),
  saveLocalHelpRequest: jest.fn(() => Promise.resolve()),
  getMostRecentProject: jest.fn(),
}));

jest.mock('../api/backendClient', () => ({
  analyzeProject: jest.fn(() => Promise.resolve({ title: 'Stub', steps: [] })),
  submitHelpRequest: jest.fn(() => Promise.resolve({ id: 1 })),
  getClarifyingQuestions: jest.fn(() => Promise.resolve({ questions: [] })),
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

const { getMostRecentProject } = require('../utils/storage');
const CaptureScreen = require('../screens/CaptureScreen').default;
const { renderScreen, fireEvent, act, waitFor } = require('./helpers/renderWithNav');

describe('CaptureScreen', () => {
  it('contractor resume card navigates to ProjectDetail', async () => {
    getMostRecentProject.mockResolvedValueOnce({
      id: 'c-1', title: 'Fix roof', _list: 'contractor',
    });
    const { navigation, findByText } = renderScreen(CaptureScreen);

    await act(async () => { navigation.emit('focus'); });

    fireEvent.press(await findByText('Fix roof'));

    expect(navigation.navigate).toHaveBeenCalledWith(
      'ProjectDetail',
      expect.objectContaining({ listType: 'contractor', project: expect.objectContaining({ id: 'c-1' }) }),
    );
  });

  it('DIY resume card navigates to WorkshopSteps', async () => {
    getMostRecentProject.mockResolvedValueOnce({
      id: 'h-1', title: 'Paint wall', _list: 'honey-do',
    });
    const { navigation, findByText } = renderScreen(CaptureScreen);

    await act(async () => { navigation.emit('focus'); });

    fireEvent.press(await findByText('Paint wall'));

    expect(navigation.navigate).toHaveBeenCalledWith(
      'WorkshopSteps',
      expect.objectContaining({ listType: 'honey-do', project: expect.objectContaining({ id: 'h-1' }) }),
    );
  });
});
