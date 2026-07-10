import { describe, it, expect } from 'vitest';
import { escapeHtml, safeBase64, fmtDate, fmtDateTime, dayKey } from '../DIYHelper2.Api/wwwroot/admin/js/ui.js';

describe('escapeHtml', () => {
  it('escapes angles and ampersands', () => {
    expect(escapeHtml('<script>alert(1)</script>'))
      .toBe('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(escapeHtml('Fix & flip')).toBe('Fix &amp; flip');
  });

  it('escapes quotes so attribute interpolation cannot break out', () => {
    expect(escapeHtml('" onmouseover="x')).toBe('&quot; onmouseover=&quot;x');
    expect(escapeHtml("O'Brien")).toBe('O&#39;Brien');
  });

  it('handles null/undefined/non-strings', () => {
    expect(escapeHtml(null)).toBe('');
    expect(escapeHtml(undefined)).toBe('');
    expect(escapeHtml(42)).toBe('42');
  });

  it('double-escapes already-escaped text (no entity passthrough)', () => {
    expect(escapeHtml('&lt;b&gt;')).toBe('&amp;lt;b&amp;gt;');
  });
});

describe('safeBase64', () => {
  it('passes real base64 through, stripping whitespace', () => {
    expect(safeBase64('aGVsbG8=')).toBe('aGVsbG8=');
    expect(safeBase64('aGVs\nbG8=\n')).toBe('aGVsbG8=');
  });

  it('rejects markup-injection payloads outright', () => {
    expect(safeBase64('"><img src=x onerror=alert(1)>')).toBe('');
    expect(safeBase64("'><script>alert(1)</script>")).toBe('');
    expect(safeBase64('abc"def')).toBe('');
  });

  it('rejects non-strings', () => {
    expect(safeBase64(null)).toBe('');
    expect(safeBase64(undefined)).toBe('');
    expect(safeBase64(123)).toBe('');
  });
});

describe('fmtDate / fmtDateTime', () => {
  it('returns empty string for missing or invalid input', () => {
    expect(fmtDate('')).toBe('');
    expect(fmtDate(null)).toBe('');
    expect(fmtDate('not-a-date')).toBe('');
    expect(fmtDateTime('')).toBe('');
    expect(fmtDateTime('nope')).toBe('');
  });

  it('formats a valid ISO date (locale-dependent, so just non-empty + year)', () => {
    const out = fmtDate('2026-07-04T12:00:00Z');
    expect(out.length).toBeGreaterThan(0);
    expect(out).toContain('2026');
    expect(fmtDateTime('2026-07-04T12:00:00Z').length).toBeGreaterThan(0);
  });
});

describe('dayKey', () => {
  it('builds a local YYYY-MM-DD key with zero padding', () => {
    expect(dayKey(new Date(2026, 0, 5))).toBe('2026-01-05');
    expect(dayKey(new Date(2026, 11, 31))).toBe('2026-12-31');
  });
});
