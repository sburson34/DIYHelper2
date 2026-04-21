// The screen renders a camera + pose overlay when vision-camera is available;
// under Jest vision-camera isn't installed (the screen catches the require()
// failure and renders the fallback with a Go Back button). That's fine —
// the navigation behavior we care about (Done → WorkshopSteps) lives in the
// main render path, so we force the happy path by mocking the camera module
// and pose detection hook.

jest.mock('react-native-vision-camera', () => {
  const React = require('react');
  const { View } = require('react-native');
  return { Camera: (props) => React.createElement(View, props) };
});

jest.mock('../components/PoseOverlay', () => () => null);
jest.mock('../components/ARGuideOverlay', () => () => null);

jest.mock('../mlkit/poseDetection', () => ({
  usePoseDetection: () => ({
    pose: null,
    onFrame: jest.fn(),
    start: jest.fn(),
    stop: jest.fn(),
    available: true,
  }),
}));

const WorkshopARScreen = require('../screens/WorkshopARScreen').default;
const { renderScreen, fireEvent } = require('./helpers/renderWithNav');

describe('WorkshopARScreen', () => {
  it('tapping Done navigates back to WorkshopSteps with completedStepIndex', () => {
    const { navigation, getByText } = renderScreen(WorkshopARScreen, {
      params: { stepText: 'Tighten the bolt', stepIndex: 2, projectTitle: 'Test' },
    });

    fireEvent.press(getByText('Done'));

    expect(navigation.navigate).toHaveBeenCalledWith('WorkshopSteps', { completedStepIndex: 2 });
  });

  it('tapping Close goes back', () => {
    const { navigation, getByText } = renderScreen(WorkshopARScreen, {
      params: { stepText: 'Test', stepIndex: 0 },
    });

    fireEvent.press(getByText('Close'));

    expect(navigation.goBack).toHaveBeenCalled();
  });
});
