jest.mock('../api/backendClient', () => ({
  browseCommunityProjects: jest.fn(() => Promise.resolve([
    { id: 'com-1', title: 'Patch drywall', description: 'Small hole fix', difficulty: 'easy' },
  ])),
}));

const Community = require('../screens/Community').default;
const { renderScreen, fireEvent, waitFor } = require('./helpers/renderWithNav');

describe('Community screen', () => {
  it('tapping a community post navigates into NewProject > Result with the project', async () => {
    const { navigation, findByText } = renderScreen(Community);

    fireEvent.press(await findByText('Patch drywall'));

    expect(navigation.navigate).toHaveBeenCalledWith(
      'NewProject',
      expect.objectContaining({
        screen: 'Result',
        params: expect.objectContaining({ project: expect.objectContaining({ id: 'com-1' }) }),
      }),
    );
  });
});
