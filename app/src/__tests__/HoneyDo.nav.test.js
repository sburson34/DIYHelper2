// Regression test for the original bug: tapping a project in the Honey Do list
// was calling navigation.navigate('ProjectDetail', ...) from a drawer-level
// screen, which silently no-oped because ProjectDetail lives inside the
// nested CaptureStack. The fix routes through the nested-navigate shape.

jest.mock('../utils/storage', () => ({
  getHoneyDoList: jest.fn(() => Promise.resolve([
    {
      id: 'proj-1',
      title: 'Fix leaky faucet',
      difficulty: 'easy',
      estimated_time: '30 min',
      estimated_cost: '$20',
      tools_and_materials: [],
      photos: [],
      steps: [],
      checkedSteps: [],
    },
  ])),
  removeFromHoneyDoList: jest.fn(() => Promise.resolve(true)),
}));

const HoneyDo = require('../screens/HoneyDo').default;
const { renderScreen, fireEvent, waitFor, act } = require('./helpers/renderWithNav');

describe('HoneyDo list screen', () => {
  it('tapping a project navigates to nested ProjectDetail with correct params', async () => {
    const { navigation, findByLabelText } = renderScreen(HoneyDo);

    // Simulate React Navigation emitting focus so the screen loads items.
    await act(async () => {
      navigation.emit('focus');
    });

    const item = await findByLabelText(/Project: Fix leaky faucet/);
    fireEvent.press(item);

    expect(navigation.navigate).toHaveBeenCalledTimes(1);
    expect(navigation.navigate).toHaveBeenCalledWith(
      'NewProject',
      expect.objectContaining({
        screen: 'ProjectDetail',
        params: expect.objectContaining({ listType: 'honey-do' }),
      }),
    );
    const call = navigation.navigate.mock.calls[0];
    expect(call[1].params.project.id).toBe('proj-1');
  });
});
