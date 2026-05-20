// Resilience regressions — pin the canonical failure-injection shapes from
// @sburson34/mobile-shared/testing/resilience against DIYHelper2's network
// surface. Each test asserts the backend client surfaces an error rather
// than silently returning stale / undefined data on a partial outage.
//
// Three scenarios — one per fetch helper:
//   1. `offlineFetch`       — device offline (TypeError 'Network request failed')
//   2. `authExpiredFetch`   — 401 + canonical Sburson.Shared.Auth body shape
//   3. `rateLimitedFetch`   — 429 + Retry-After header
//
// These exercise the primary read path (`browseCommunityProjects`) because:
//   - it's anonymous (no Play Integrity round-trip),
//   - it's used on the home Community tab,
//   - one assertion per scenario keeps the suite cheap.
//
// We mock storage + monitoring modules so the test doesn't need AsyncStorage
// or Sentry to be live; the shared mocks already cover those at the global
// level but explicit jest.mock keeps the failure surface tight.

jest.mock('../utils/storage', () => ({
  getCachedAnalysis: jest.fn(async () => null),
  setCachedAnalysis: jest.fn(async () => undefined),
  getAppPrefs: jest.fn(async () => ({})),
  getToolInventory: jest.fn(async () => []),
  getAiConsent: jest.fn(async () => ({ granted: true })),
  getOrCreateDeviceId: jest.fn(async () => 'test-device-id'),
}));

jest.mock('../services/monitoring', () => ({
  reportError: jest.fn(),
  reportHandledError: jest.fn(),
  addBreadcrumb: jest.fn(),
}));

jest.mock('../services/playIntegrity', () => ({
  requestIntegrityToken: jest.fn(async () => null),
}));

jest.mock('../config/appInfo', () => ({ RELEASE: 'test-release' }));

jest.mock('../config/api', () => ({ API_BASE_URL: 'https://test.api.local' }));

const {
  offlineFetch,
  authExpiredFetch,
  rateLimitedFetch,
} = require('@sburson34/mobile-shared/testing/resilience');

describe('Network resilience', () => {
  let handle;

  afterEach(() => {
    if (handle) {
      handle.restore();
      handle = undefined;
    }
  });

  it('offlineFetch — browseCommunityProjects surfaces a network error instead of returning stale data', async () => {
    handle = offlineFetch();
    const { browseCommunityProjects } = require('../api/backendClient');

    await expect(browseCommunityProjects('drywall')).rejects.toThrow(/network|fetch/i);
    expect(handle.calls).toBeGreaterThanOrEqual(1);
  });

  it('authExpiredFetch — backendClient surfaces the 401 rather than swallowing it', async () => {
    handle = authExpiredFetch();
    const { browseCommunityProjects } = require('../api/backendClient');

    // The community-projects route is anonymous in DIY, but the resilience
    // pin is that a 401 from ANY route propagates to a thrown error (callers
    // then route the user to "log in again" — DIY uses anonymous device IDs,
    // so the screen surface is "session expired" copy + retry).
    await expect(browseCommunityProjects()).rejects.toThrow();
    expect(handle.calls).toBe(1);
  });

  it('rateLimitedFetch — 429 surfaces with the canonical body so a banner can render Retry-After', async () => {
    handle = rateLimitedFetch({ retryAfter: 2 });
    const { browseCommunityProjects } = require('../api/backendClient');

    // jsonGet should throw on non-2xx; the 429 must NOT be silently treated
    // as success. We don't pin the exact error shape — the resilience pin is
    // "doesn't return undefined/empty array on a 429," which would mask the
    // outage on the UI.
    await expect(browseCommunityProjects()).rejects.toThrow();
    expect(handle.calls).toBe(1);
  });
});
