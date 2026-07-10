import { fmtDateTime, fmtWhen } from '../utils/datetime';

describe('datetime helpers', () => {
  test('fmtDateTime formats a valid ISO timestamp', () => {
    const out = fmtDateTime('2026-07-09T14:30:00Z');
    // Locale-dependent output — assert shape, not exact string.
    expect(out).toBeTruthy();
    expect(out).toMatch(/Jul|7/);
  });

  test('fmtDateTime returns null for missing or garbage input', () => {
    expect(fmtDateTime(null)).toBeNull();
    expect(fmtDateTime(undefined)).toBeNull();
    expect(fmtDateTime('not-a-date')).toBeNull();
  });

  test('fmtWhen falls back to the preferred window, then empty string', () => {
    expect(fmtWhen(null, 'morning')).toBe('morning');
    expect(fmtWhen('garbage', 'afternoon')).toBe('afternoon');
    expect(fmtWhen(null, null)).toBe('');
    expect(fmtWhen('2026-07-09T14:30:00Z', 'morning')).not.toBe('morning');
  });
});
