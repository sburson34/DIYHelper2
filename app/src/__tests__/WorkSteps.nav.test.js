// ML Kit's useMlKitFeature must report poseDetection ready, otherwise the
// AR Guide button doesn't render. We also stub speech/TTS/image-picker so the
// screen renders without native modules.

jest.mock('../mlkit/useMlKitFeature', () => ({
  useMlKitFeature: (f) => ({ ready: f === 'poseDetection', reason: null }),
}));

jest.mock('../api/backendClient', () => ({
  askHelper: jest.fn(() => Promise.resolve({ answer: 'stub' })),
  verifyStep: jest.fn(() => Promise.resolve({ rating: 'good', score: 10 })),
}));

jest.mock('../utils/storage', () => ({
  updateHoneyDoList: jest.fn(() => Promise.resolve()),
  updateContractorList: jest.fn(() => Promise.resolve()),
}));

jest.mock('expo-image-picker', () => ({
  launchCameraAsync: jest.fn(() => Promise.resolve({ canceled: true })),
  MediaTypeOptions: { Images: 'Images' },
  requestCameraPermissionsAsync: jest.fn(() => Promise.resolve({ status: 'granted' })),
}));

const WorkSteps = require('../screens/WorkSteps').default;
const { renderScreen, fireEvent } = require('./helpers/renderWithNav');

describe('WorkSteps screen', () => {
  it('AR Guide button navigates to WorkshopAR with step payload', () => {
    const project = {
      id: 'p-1',
      title: 'Build shelf',
      steps: ['Cut wood', 'Sand edges'],
      checkedSteps: [false, false],
      stepNotes: {},
      photos: [],
    };

    const { navigation, getAllByText } = renderScreen(WorkSteps, {
      params: { project, listType: 'honey-do' },
    });

    const arBtns = getAllByText('AR Guide');
    fireEvent.press(arBtns[0]);

    expect(navigation.navigate).toHaveBeenCalledWith('WorkshopAR', expect.objectContaining({
      stepText: 'Cut wood',
      stepIndex: 0,
      projectTitle: 'Build shelf',
    }));
  });
});
