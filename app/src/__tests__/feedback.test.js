import AsyncStorage from '@react-native-async-storage/async-storage';

jest.mock('../config/api', () => ({ API_BASE_URL: 'http://test-api:5206' }));
jest.mock('../config/appInfo', () => ({
  APP_INFO: {
    appVersion: '1.0.0',
    buildNumber: '1',
    platform: 'android',
    osVersion: '33',
    environment: 'development',
    release: 'test@1.0.0+1',
    gitCommit: null,
  },
}));
jest.mock('../config/sentry', () => ({ SENTRY_ENABLED: false }));
jest.mock('../services/sentry', () => ({
  captureMessage: jest.fn(),
  Sentry: {
    withScope: jest.fn((cb) => cb({ setLevel: jest.fn(), setTag: jest.fn(), setExtra: jest.fn() })),
    captureMessage: jest.fn(),
  },
}));

const { submitFeedback, getLocalFeedback } = require('../services/feedback');

beforeEach(() => {
  jest.clearAllMocks();
  AsyncStorage._reset();
  global.fetch.mockReset();
});

describe('submitFeedback', () => {
  it('returns a feedback ID', async () => {
    global.fetch.mockResolvedValueOnce({ ok: true });
    const id = await submitFeedback({ description: 'Bug report' });
    expect(id).toMatch(/^fb-/);
  });

  it('saves feedback locally', async () => {
    global.fetch.mockResolvedValueOnce({ ok: true });
    await submitFeedback({ description: 'Test bug', whatYouWereDoing: 'Testing' });
    const local = await getLocalFeedback();
    expect(local).toHaveLength(1);
    expect(local[0].description).toBe('Test bug');
    expect(local[0].metadata.appVersion).toBe('1.0.0');
  });

  it('limits local storage to 50 entries', async () => {
    global.fetch.mockResolvedValue({ ok: true });
    for (let i = 0; i < 55; i++) {
      await submitFeedback({ description: `Bug ${i}` });
    }
    const local = await getLocalFeedback();
    expect(local.length).toBeLessThanOrEqual(50);
  });

  it('fires and forgets backend POST', async () => {
    global.fetch.mockRejectedValueOnce(new Error('network fail'));
    // Should not throw even if backend fails
    const id = await submitFeedback({ description: 'Offline bug' });
    expect(id).toMatch(/^fb-/);
  });

  it('posts to backend /api/feedback', async () => {
    global.fetch.mockResolvedValueOnce({ ok: true });
    await submitFeedback({ description: 'Test' });
    expect(global.fetch).toHaveBeenCalledWith(
      'http://test-api:5206/api/feedback',
      expect.objectContaining({ method: 'POST' }),
    );
  });
});

describe('getLocalFeedback', () => {
  it('returns empty array when nothing stored', async () => {
    const result = await getLocalFeedback();
    expect(result).toEqual([]);
  });
});
