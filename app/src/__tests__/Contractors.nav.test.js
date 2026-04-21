jest.mock('../utils/storage', () => ({
  getContractorList: jest.fn(() => Promise.resolve([
    {
      id: 'c-1',
      title: 'Install new water heater',
      difficulty: 'hard',
      estimated_time: '1 day',
      estimated_cost: '$2000',
      tools_and_materials: [],
      photos: [],
      steps: [],
    },
  ])),
  removeFromContractorList: jest.fn(() => Promise.resolve(true)),
  getAppPrefs: jest.fn(() => Promise.resolve({})),
}));

jest.mock('../api/backendClient', () => ({
  getPropertyValueImpact: jest.fn(() => Promise.resolve(null)),
}));

jest.mock('../utils/notifications', () => ({
  cancelForProject: jest.fn(() => Promise.resolve()),
}));

const Contractors = require('../screens/Contractors').default;
const { renderScreen, fireEvent, act } = require('./helpers/renderWithNav');

describe('Contractors list screen', () => {
  it('tapping a project navigates to nested ProjectDetail with contractor listType', async () => {
    const { navigation, findByText } = renderScreen(Contractors);

    await act(async () => { navigation.emit('focus'); });

    fireEvent.press(await findByText('Install new water heater'));

    expect(navigation.navigate).toHaveBeenCalledWith(
      'NewProject',
      expect.objectContaining({
        screen: 'ProjectDetail',
        params: expect.objectContaining({ listType: 'contractor' }),
      }),
    );
    expect(navigation.navigate.mock.calls[0][1].params.project.id).toBe('c-1');
  });
});
