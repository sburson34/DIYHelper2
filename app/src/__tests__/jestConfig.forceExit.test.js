// Regression: leaked-timer stall in CI.
//
// The react-native jest preset's Animated mock leaks setTimeout handles that
// never drain in the jest environment. Without `forceExit: true`, jest waits
// on those open handles after the test loop finishes until the CI runner kills
// the job at timeout-minutes. One case was a 20-minute stall on a test suite
// that takes 1 minute. These tests pin the fix so that removing, disabling, or
// making the flag conditional fails right away instead of stalling CI.
const path = require('path');

const CONFIG_PATH = path.join(__dirname, '..', '..', 'jest.config.js');

const loadFreshConfig = () => {
  let config;
  jest.isolateModules(() => {
    // eslint-disable-next-line global-require, import/no-dynamic-require
    config = require(CONFIG_PATH);
  });
  return config;
};

describe('jest.config.js leaked-timer guard', () => {
  const originalCI = process.env.CI;

  afterEach(() => {
    if (originalCI === undefined) {
      delete process.env.CI;
    } else {
      process.env.CI = originalCI;
    }
  });

  it('exports forceExit as the strict boolean true (not merely truthy, not absent)', () => {
    const config = loadFreshConfig();
    expect(Object.prototype.hasOwnProperty.call(config, 'forceExit')).toBe(true);
    expect(typeof config.forceExit).toBe('boolean');
    expect(config.forceExit).toBe(true);
  });

  it('keeps forceExit enabled regardless of the CI environment variable', () => {
    // CI is where the stall actually hurts. Gating the flag on the environment
    // would let the bug come back in exactly that place.
    process.env.CI = 'true';
    expect(loadFreshConfig().forceExit).toBe(true);

    process.env.CI = 'false';
    expect(loadFreshConfig().forceExit).toBe(true);

    delete process.env.CI;
    expect(loadFreshConfig().forceExit).toBe(true);
  });

  it('pairs forceExit with the react-native preset whose Animated mock leaks timers', () => {
    // The react-native preset is what leaks the handles. While that preset is
    // in use, forceExit must stay on alongside it.
    const config = loadFreshConfig();
    expect(config.preset).toBe('react-native');
    expect(config).toEqual(expect.objectContaining({ preset: 'react-native', forceExit: true }));
  });
}
);
