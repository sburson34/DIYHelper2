import AsyncStorage from '@react-native-async-storage/async-storage';

// Must mock these before importing backendClient
jest.mock('../config/api', () => ({ API_BASE_URL: 'http://test-api:5206' }));
jest.mock('../config/appInfo', () => ({ RELEASE: 'test@1.0.0+1', APP_INFO: {} }));
jest.mock('../config/sentry', () => ({ SENTRY_ENABLED: false }));
jest.mock('../services/monitoring', () => ({
  reportError: jest.fn(),
  reportHandledError: jest.fn(),
  addBreadcrumb: jest.fn(),
}));

const {
  analyzeProject,
  analyzeLive,
  askHelper,
  verifyStep,
  diagnoseProblem,
  getClarifyingQuestions,
  submitHelpRequest,
  getHelpRequest,
  updateHelpRequestStatus,
  listHelpRequests,
  submitCommunityProject,
  browseCommunityProjects,
  getFeatures,
  getWeather,
  getRedditDiscussions,
  getSafetyData,
  getPropertyValueImpact,
  uploadReceipt,
  matchPaintColor,
  registerPushToken,
  unregisterPushToken,
  submitBooking,
  respondToQuote,
  getAvailability,
  listMyAssets,
  createMyAsset,
  getAssetHistory,
  createMyProperty,
} = require('../api/backendClient');

const { reportError, reportHandledError, addBreadcrumb } = require('../services/monitoring');

beforeEach(async () => {
  jest.clearAllMocks();
  AsyncStorage._reset();
  global.fetch.mockReset();
  // AI-using endpoints short-circuit without stored consent. Grant it
  // implicitly for the test suite (the consent flow has its own tests).
  await AsyncStorage.setItem('@ai_consent', JSON.stringify({ granted: true, version: 1 }));
});

const mockJsonResponse = (data, status = 200) => {
  global.fetch.mockResolvedValueOnce({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(data),
  });
};

const mockNetworkError = () => {
  global.fetch.mockRejectedValueOnce(new Error('Network request failed'));
};

// ── analyzeProject ──────────────────────────────────────────────
describe('analyzeProject', () => {
  it('sends description, media, and preferences', async () => {
    mockJsonResponse({ title: 'Fix sink', steps: ['Step 1'] });
    const result = await analyzeProject('leaky faucet', [{ base64: 'abc', mimeType: 'image/jpeg' }], 'en');
    expect(result.title).toBe('Fix sink');
    expect(global.fetch).toHaveBeenCalledTimes(1);
    const [url, opts] = global.fetch.mock.calls[0];
    expect(url).toBe('http://test-api:5206/api/analyze');
    expect(opts.method).toBe('POST');
    const body = JSON.parse(opts.body);
    expect(body.description).toBe('leaky faucet');
    expect(body.media).toHaveLength(1);
    expect(body.language).toBe('en');
  });

  it('includes correlation ID and app version headers', async () => {
    mockJsonResponse({ title: 'Test' });
    await analyzeProject('test', []);
    const headers = global.fetch.mock.calls[0][1].headers;
    expect(headers['X-Correlation-ID']).toBeDefined();
    expect(headers['X-App-Version']).toBe('test@1.0.0+1');
  });

  it('falls back to cache on network error', async () => {
    // First, populate cache
    mockJsonResponse({ title: 'Cached Result', steps: [] });
    await analyzeProject('test query', []);

    // Now simulate failure
    mockNetworkError();
    const result = await analyzeProject('test query', []);
    expect(result._fromCache).toBe(true);
    expect(result.title).toBe('Cached Result');
    expect(reportHandledError).toHaveBeenCalledWith('AnalysisFallbackToCache', expect.any(Error), expect.any(Object));
  });

  it('throws descriptive error on network failure with no cache', async () => {
    mockNetworkError();
    await expect(analyzeProject('new query', [])).rejects.toThrow('Network error');
    expect(reportError).toHaveBeenCalled();
  });

  it('adds breadcrumbs for analyze call', async () => {
    mockJsonResponse({ title: 'Test' });
    await analyzeProject('desc', [{ base64: 'x' }], 'es');
    expect(addBreadcrumb).toHaveBeenCalledWith('AI: analyze project', 'ai', expect.objectContaining({
      action: 'analyze',
      descriptionLength: 4,
      mediaCount: 1,
      language: 'es',
    }));
  });
});

// ── analyzeLive ─────────────────────────────────────────────────
describe('analyzeLive', () => {
  it('posts task, step, question, and image to /api/live-diy/analyze', async () => {
    mockJsonResponse({
      currentAssessment: 'Faucet base',
      nextInstruction: 'Turn off water',
      safetyWarnings: [],
      confidenceScore: 0.8,
      shouldEscalateToProfessional: false,
      suggestedTools: ['wrench'],
      sessionId: 'session-1',
    });

    const result = await analyzeLive({
      taskDescription: 'Replace faucet',
      currentStep: 2,
      userQuestion: 'Where is the shutoff?',
      imageBase64: 'abc',
      mimeType: 'image/jpeg',
      sessionId: 'session-1',
    });

    expect(result.nextInstruction).toBe('Turn off water');
    expect(result.shouldEscalateToProfessional).toBe(false);

    const [url, opts] = global.fetch.mock.calls[0];
    expect(url).toBe('http://test-api:5206/api/live-diy/analyze');
    expect(opts.method).toBe('POST');
    const body = JSON.parse(opts.body);
    expect(body.taskDescription).toBe('Replace faucet');
    expect(body.currentStep).toBe(2);
    expect(body.userQuestion).toBe('Where is the shutoff?');
    expect(body.imageBase64).toBe('abc');
    expect(body.mimeType).toBe('image/jpeg');
    expect(body.sessionId).toBe('session-1');
  });

  it('passes through escalation result without modification', async () => {
    mockJsonResponse({
      currentAssessment: 'Looks like a gas line',
      nextInstruction: 'Stop and call a licensed plumber.',
      safetyWarnings: ['Gas work requires a professional.'],
      confidenceScore: 0.95,
      shouldEscalateToProfessional: true,
      escalationReason: 'gas hazard',
      suggestedTools: [],
      sessionId: 's',
    });

    const result = await analyzeLive({ taskDescription: 'fix gas valve' });
    expect(result.shouldEscalateToProfessional).toBe(true);
    expect(result.safetyWarnings).toHaveLength(1);
  });

  it('emits ai breadcrumb with action live-diy-analyze', async () => {
    mockJsonResponse({});
    await analyzeLive({ taskDescription: 'x', imageBase64: 'b' });
    expect(addBreadcrumb).toHaveBeenCalledWith('AI: live diy', 'ai', expect.objectContaining({
      action: 'live-diy-analyze',
      hasImage: true,
    }));
  });

  it('surfaces backend error message on non-OK response', async () => {
    global.fetch.mockResolvedValueOnce({
      ok: false,
      status: 503,
      json: () => Promise.resolve({ error: 'AI features are temporarily unavailable.' }),
    });
    await expect(analyzeLive({ taskDescription: 'x' })).rejects.toThrow('AI features are temporarily unavailable.');
  });
});

// ── askHelper ───────────────────────────────────────────────────
describe('askHelper', () => {
  it('posts question and project context', async () => {
    mockJsonResponse({ answer: 'Use a wrench' });
    const result = await askHelper('How do I fix this?', { title: 'Sink' }, 'en');
    expect(result.answer).toBe('Use a wrench');
    const body = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(body.question).toBe('How do I fix this?');
    expect(body.projectContext.title).toBe('Sink');
  });
});

// ── verifyStep ──────────────────────────────────────────────────
describe('verifyStep', () => {
  it('posts step data with image', async () => {
    mockJsonResponse({ passed: true });
    await verifyStep({ stepText: 'Tighten bolt', projectTitle: 'Sink', base64Image: 'img', mimeType: 'image/jpeg' });
    const body = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(body.stepText).toBe('Tighten bolt');
    expect(body.base64Image).toBe('img');
  });
});

// ── diagnoseProblem ─────────────────────────────────────────────
describe('diagnoseProblem', () => {
  it('posts diagnosis request', async () => {
    mockJsonResponse({ causes: ['pipe leak'] });
    const result = await diagnoseProblem({ description: 'Water on floor' });
    expect(result.causes).toEqual(['pipe leak']);
  });
});

// ── getClarifyingQuestions ───────────────────────────────────────
describe('getClarifyingQuestions', () => {
  it('posts clarify request', async () => {
    mockJsonResponse({ questions: ['Where is the leak?'] });
    const result = await getClarifyingQuestions({ description: 'Leak' });
    expect(result.questions).toHaveLength(1);
  });
});

// ── Help Requests ───────────────────────────────────────────────
describe('Help Requests', () => {
  it('submitHelpRequest posts correct payload', async () => {
    mockJsonResponse({ id: 1 });
    await submitHelpRequest({
      customerName: 'John',
      customerEmail: 'j@t.com',
      customerPhone: '555',
      projectTitle: 'Roof',
      userDescription: 'Leaking',
      projectData: { steps: [] },
    });
    const body = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(body.customerName).toBe('John');
    expect(body.projectData).toBe(JSON.stringify({ steps: [] }));
  });

  it('getHelpRequest calls correct URL', async () => {
    mockJsonResponse({ id: 5 });
    await getHelpRequest(5);
    expect(global.fetch.mock.calls[0][0]).toBe('http://test-api:5206/api/help-requests/5');
  });

  it('updateHelpRequestStatus sends PUT', async () => {
    mockJsonResponse({ id: 5 });
    await updateHelpRequestStatus(5, 'accepted', 'notes');
    expect(global.fetch.mock.calls[0][1].method).toBe('PUT');
  });

  it('listHelpRequests supports optional status filter', async () => {
    mockJsonResponse([]);
    await listHelpRequests('new');
    expect(global.fetch.mock.calls[0][0]).toContain('status=new');

    mockJsonResponse([]);
    await listHelpRequests();
    expect(global.fetch.mock.calls[1][0]).toBe('http://test-api:5206/api/help-requests');
  });
});

// ── Community Projects ──────────────────────────────────────────
describe('Community Projects', () => {
  it('submits community project', async () => {
    mockJsonResponse({ id: '1' });
    await submitCommunityProject({ title: 'Shelf' });
    expect(global.fetch.mock.calls[0][1].method).toBe('POST');
  });

  it('browses with optional query', async () => {
    mockJsonResponse([]);
    await browseCommunityProjects('shelf');
    expect(global.fetch.mock.calls[0][0]).toContain('q=shelf');

    mockJsonResponse([]);
    await browseCommunityProjects();
    expect(global.fetch.mock.calls[1][0]).toBe('http://test-api:5206/api/community-projects');
  });
});

// ── getFeatures ─────────────────────────────────────────────────
describe('getFeatures', () => {
  it('returns features from backend', async () => {
    mockJsonResponse({ youtube: true, weather: true });
    const features = await getFeatures();
    expect(features.youtube).toBe(true);
  });

  it('returns safe defaults on failure', async () => {
    mockNetworkError();
    const features = await getFeatures();
    expect(features.reddit).toBe(true);
    expect(features.pubchem).toBe(true);
    expect(features.amazonPa).toBe(false);
  });
});

// ── External integrations ───────────────────────────────────────
describe('External API calls', () => {
  it('getWeather calls correct URL', async () => {
    mockJsonResponse({ forecast: [] });
    await getWeather('90210', 3);
    expect(global.fetch.mock.calls[0][0]).toContain('zip=90210');
    expect(global.fetch.mock.calls[0][0]).toContain('days=3');
  });

  it('getRedditDiscussions calls correct URL', async () => {
    mockJsonResponse([]);
    await getRedditDiscussions('fix faucet');
    expect(global.fetch.mock.calls[0][0]).toContain('query=fix%20faucet');
  });

  it('getSafetyData calls correct URL', async () => {
    mockJsonResponse({});
    await getSafetyData('bleach');
    expect(global.fetch.mock.calls[0][0]).toContain('chemical=bleach');
  });

  it('getPropertyValueImpact sends all params', async () => {
    mockJsonResponse({});
    await getPropertyValueImpact({ zip: '90210', repairType: 'kitchen', estimatedCost: 5000 });
    const url = global.fetch.mock.calls[0][0];
    expect(url).toContain('zip=90210');
    expect(url).toContain('repairType=kitchen');
    expect(url).toContain('estimatedCost=5000');
  });

  it('uploadReceipt posts image data', async () => {
    mockJsonResponse({ items: [] });
    await uploadReceipt({ base64Image: 'abc', mimeType: 'image/png', projectId: '1' });
    expect(global.fetch.mock.calls[0][1].method).toBe('POST');
  });

  it('matchPaintColor posts image data', async () => {
    mockJsonResponse({ dominantHex: '#FF0000' });
    await matchPaintColor({ base64Image: 'abc', mimeType: 'image/jpeg' });
    const body = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(body.base64Image).toBe('abc');
  });
});

// ── Push notifications ──────────────────────────────────────────
describe('Push notifications', () => {
  it('registerPushToken posts token, platform, and opt-in to /api/push/register', async () => {
    mockJsonResponse({ ok: true });
    await registerPushToken('ExponentPushToken[abc]', 'ios', true);
    const [url, opts] = global.fetch.mock.calls[0];
    expect(url).toBe('http://test-api:5206/api/push/register');
    expect(opts.method).toBe('POST');
    const body = JSON.parse(opts.body);
    expect(body.token).toBe('ExponentPushToken[abc]');
    expect(body.platform).toBe('ios');
    expect(body.marketingOptIn).toBe(true);
  });

  it('unregisterPushToken posts the token to /api/push/unregister', async () => {
    mockJsonResponse({ ok: true });
    await unregisterPushToken('ExponentPushToken[abc]');
    const [url, opts] = global.fetch.mock.calls[0];
    expect(url).toBe('http://test-api:5206/api/push/unregister');
    expect(opts.method).toBe('POST');
    expect(JSON.parse(opts.body).token).toBe('ExponentPushToken[abc]');
  });
});

// ── Booking + F1-F4 feature payloads ────────────────────────────
describe('Booking and feature endpoints', () => {
  it('submitBooking carries address, slotStart, assetId and propertyId', async () => {
    mockJsonResponse({ id: 7 });
    await submitBooking({
      customerName: 'A', customerEmail: 'a@b.c', customerPhone: '555',
      projectTitle: 'Leak', userDescription: 'Drips',
      address: '12 Main St', slotStart: '2026-07-10T14:00:00Z',
      assetId: 3, propertyId: 9,
    });
    const [url, opts] = global.fetch.mock.calls[0];
    expect(url).toBe('http://test-api:5206/api/help-requests');
    const body = JSON.parse(opts.body);
    expect(body.address).toBe('12 Main St');
    expect(body.slotStart).toBe('2026-07-10T14:00:00Z');
    expect(body.assetId).toBe(3);
    expect(body.propertyId).toBe(9);
  });

  it('respondToQuote includes the chosen optionName for tiered quotes', async () => {
    mockJsonResponse({ id: 4, quoteStatus: 'approved' });
    await respondToQuote(4, 'approved', 'Better');
    const [url, opts] = global.fetch.mock.calls[0];
    expect(url).toBe('http://test-api:5206/api/my/requests/4/quote');
    expect(opts.method).toBe('PUT');
    const body = JSON.parse(opts.body);
    expect(body.decision).toBe('approved');
    expect(body.optionName).toBe('Better');
  });

  it('getAvailability encodes the date query param', async () => {
    mockJsonResponse({ date: '2026-07-10', slotMinutes: 120, slots: [] });
    await getAvailability('2026-07-10');
    const [url] = global.fetch.mock.calls[0];
    expect(url).toBe('http://test-api:5206/api/availability?date=2026-07-10');
  });

  it('asset CRUD + history hit the device-scoped /api/my endpoints', async () => {
    mockJsonResponse([]);
    await listMyAssets();
    expect(global.fetch.mock.calls[0][0]).toBe('http://test-api:5206/api/my/assets');

    mockJsonResponse({ id: 1, label: 'Water heater' });
    await createMyAsset({ label: 'Water heater', make: 'Rheem' });
    const [createUrl, createOpts] = global.fetch.mock.calls[1];
    expect(createUrl).toBe('http://test-api:5206/api/my/assets');
    expect(createOpts.method).toBe('POST');
    expect(JSON.parse(createOpts.body).label).toBe('Water heater');

    mockJsonResponse([]);
    await getAssetHistory(1);
    expect(global.fetch.mock.calls[2][0]).toBe('http://test-api:5206/api/my/assets/1/history');

    mockJsonResponse({ id: 2, label: 'Home' });
    await createMyProperty({ label: 'Home', address: '12 Main St' });
    const [propUrl, propOpts] = global.fetch.mock.calls[3];
    expect(propUrl).toBe('http://test-api:5206/api/my/properties');
    expect(JSON.parse(propOpts.body).address).toBe('12 Main St');
  });
});

// ── HTTP error handling ─────────────────────────────────────────
describe('HTTP error handling', () => {
  it('throws with status and message on non-OK response', async () => {
    global.fetch.mockResolvedValueOnce({
      ok: false,
      status: 422,
      json: () => Promise.resolve({ error: 'AI rejected input' }),
    });
    await expect(askHelper('bad', {})).rejects.toThrow('AI rejected input');
  });

  it('throws HTTP status when no error body', async () => {
    global.fetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: () => Promise.reject(new Error('not json')),
    });
    await expect(askHelper('test', {})).rejects.toThrow('HTTP 500');
  });
});
