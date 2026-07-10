// Import-graph smoke test: every console module must load under jsdom and all
// cross-module named imports must resolve (ESM throws at link time if an
// imported name doesn't exist — this catches wiring mistakes without a
// browser). main.js only registers a DOMContentLoaded listener at top level,
// which is inert here.
import { describe, it, expect } from 'vitest';

const MODULES = [
  'ui', 'api', 'state', 'router', 'session', 'palette',
  'overview', 'leads', 'quotes', 'assets', 'schedule',
  'technicians', 'pricebook', 'inventory', 'push', 'brandstudio',
  'main',
];

describe('console module graph', () => {
  it.each(MODULES)('js/%s.js imports cleanly', async (name) => {
    const mod = await import(`../DIYHelper2.Api/wwwroot/admin/js/${name}.js`);
    expect(mod).toBeTruthy();
  });
});
