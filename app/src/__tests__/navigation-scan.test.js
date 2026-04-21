// Gate: the static navigation scanner must pass.
// The scanner verifies every `navigation.navigate('X', ...)` in src/screens/
// resolves to a route reachable from the caller's navigator. It caught the
// original HoneyDo/Contractors ProjectDetail bug where a drawer-level screen
// was navigating to a nested-stack-only route.

const { execFileSync } = require('child_process');
const path = require('path');

describe('navigation static scan', () => {
  it('every navigation.navigate() target is reachable from its caller', () => {
    const script = path.resolve(__dirname, '..', '..', 'scripts', 'check-navigation.js');
    try {
      execFileSync(process.execPath, [script], { stdio: 'pipe' });
    } catch (e) {
      const out = (e.stdout && e.stdout.toString()) || '';
      const err = (e.stderr && e.stderr.toString()) || '';
      throw new Error(`check-navigation.js failed:\n${err}${out}`);
    }
  });
});
