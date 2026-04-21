jest.mock('../utils/storage', () => ({
  saveToHoneyDoList: jest.fn(() => Promise.resolve('h-1')),
  saveToContractorList: jest.fn(() => Promise.resolve('c-1')),
  getUserProfile: jest.fn(() => Promise.resolve({})),
  saveUserProfile: jest.fn(() => Promise.resolve()),
  saveLocalHelpRequest: jest.fn(() => Promise.resolve()),
  getCommunityOptIn: jest.fn(() => Promise.resolve(false)),
  getAppPrefs: jest.fn(() => Promise.resolve({})),
  getToolInventory: jest.fn(() => Promise.resolve([])),
  addToInventory: jest.fn(() => Promise.resolve()),
  removeFromInventory: jest.fn(() => Promise.resolve()),
}));

jest.mock('../api/backendClient', () => ({
  submitCommunityProject: jest.fn(() => Promise.resolve()),
  submitHelpRequest: jest.fn(() => Promise.resolve({ id: 1 })),
  getRedditDiscussions: jest.fn(() => Promise.resolve({ threads: [] })),
  getPropertyValueImpact: jest.fn(() => Promise.resolve(null)),
}));

jest.mock('../services/monitoring', () => ({
  reportError: jest.fn(),
  addBreadcrumb: jest.fn(),
}));

const ResultScreen = require('../screens/ResultScreen').default;
const { renderScreen, fireEvent, act, waitFor } = require('./helpers/renderWithNav');

const sampleProject = {
  title: 'Fix sink',
  steps: ['Turn off water', 'Replace washer'],
  tools_and_materials: ['wrench'],
  difficulty: 'easy',
  estimated_time: '15 min',
  estimated_cost: '$10',
  youtube_links: [],
  shopping_links: [],
  safety_tips: [],
  when_to_call_pro: [],
};

describe('ResultScreen', () => {
  it('Start Building navigates to Safety with project', () => {
    const { navigation, getByText } = renderScreen(ResultScreen, {
      params: { project: sampleProject, originalRequest: { description: 'x', mediaUrls: [] } },
    });

    fireEvent.press(getByText('Start Building! 🏗️'));

    expect(navigation.navigate).toHaveBeenCalledWith('Safety', { project: sampleProject });
  });

  it('Refine Blueprint navigates back to Capture with existing project', () => {
    const original = { description: 'x', mediaUrls: [] };
    const { navigation, getByText } = renderScreen(ResultScreen, {
      params: { project: sampleProject, originalRequest: original },
    });

    fireEvent.press(getByText('Refine Blueprint ✏️'));

    expect(navigation.navigate).toHaveBeenCalledWith('Capture', {
      existingProject: { project: sampleProject, originalRequest: original },
    });
  });
});
