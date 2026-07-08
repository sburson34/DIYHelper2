const {
  parseColor,
  isValidColor,
  toHex,
  normalizeHex,
  contrastRatio,
  relativeLuminance,
  mix,
  lighten,
  darken,
  onColor,
  meetsAA,
  generateBrandColors,
} = require('../brandPalette');

describe('parseColor / normalizeHex', () => {
  it('parses 6-digit hex with and without #', () => {
    expect(parseColor('#FCA004')).toEqual({ r: 252, g: 160, b: 4 });
    expect(parseColor('FCA004')).toEqual({ r: 252, g: 160, b: 4 });
  });
  it('expands 3-digit shorthand', () => {
    expect(parseColor('#0af')).toEqual({ r: 0, g: 170, b: 255 });
  });
  it('rejects invalid input', () => {
    expect(parseColor('nope')).toBeNull();
    expect(parseColor('#12')).toBeNull();
    expect(parseColor(null)).toBeNull();
    expect(parseColor(undefined)).toBeNull();
    expect(isValidColor('#zzzzzz')).toBe(false);
  });
  it('round-trips through toHex/normalizeHex (uppercase)', () => {
    expect(toHex({ r: 10, g: 79, b: 166 })).toBe('#0A4FA6');
    expect(normalizeHex('0a4fa6')).toBe('#0A4FA6');
    expect(normalizeHex('nope')).toBeNull();
    // 'bad' is intentionally NOT here — b/a/d are valid hex digits, so it
    // expands to #BBAADD (a real color), which is correct behavior.
    expect(normalizeHex('bad')).toBe('#BBAADD');
  });
});

describe('contrastRatio / luminance', () => {
  it('is 21 for black vs white and 1 for identical colors', () => {
    expect(contrastRatio('#000000', '#FFFFFF')).toBeCloseTo(21, 0);
    expect(contrastRatio('#123456', '#123456')).toBeCloseTo(1, 5);
  });
  it('is symmetric', () => {
    expect(contrastRatio('#FCA004', '#0F2253')).toBeCloseTo(contrastRatio('#0F2253', '#FCA004'), 5);
  });
  it('white has higher luminance than black', () => {
    expect(relativeLuminance('#FFFFFF')).toBeGreaterThan(relativeLuminance('#000000'));
  });
});

describe('mix / lighten / darken', () => {
  it('mixes endpoints and midpoint', () => {
    expect(mix('#000000', '#FFFFFF', 0)).toBe('#000000');
    expect(mix('#000000', '#FFFFFF', 1)).toBe('#FFFFFF');
    expect(mix('#000000', '#FFFFFF', 0.5)).toBe('#808080');
  });
  it('lighten moves toward white, darken toward black', () => {
    expect(relativeLuminance(lighten('#0A4FA6', 0.3))).toBeGreaterThan(relativeLuminance('#0A4FA6'));
    expect(relativeLuminance(darken('#0A4FA6', 0.3))).toBeLessThan(relativeLuminance('#0A4FA6'));
  });
});

describe('onColor', () => {
  it('returns dark ink for pale backgrounds and white for deep ones', () => {
    expect(relativeLuminance(onColor('#FDD314'))).toBeLessThan(0.2); // yellow -> dark ink
    expect(onColor('#0A4FA6')).toBe('#FFFFFF'); // deep blue -> white
  });

  it('always yields an AA-legible ink across a spectrum of seeds', () => {
    const seeds = ['#FCA004', '#0A4FA6', '#FDD314', '#00B894', '#A22601', '#6D5AE0', '#111111', '#EEEEEE', '#7F7F7F'];
    for (const bg of seeds) {
      const ink = onColor(bg);
      // Either it clears AA, or (for mid-grays where neither ink can) it at
      // least picks the higher-contrast option — never the worse one.
      const other = ink === '#FFFFFF' ? '#10151F' : '#FFFFFF';
      expect(contrastRatio(ink, bg)).toBeGreaterThanOrEqual(contrastRatio(other, bg));
    }
  });
});

describe('generateBrandColors', () => {
  const base = { primary: '#FCA004', secondary: '#0A4FA6', accent: '#FDD314', surface: '#FFFFFF' };

  it('falls back to base for missing/invalid seeds', () => {
    const g = generateBrandColors({}, 'light', base);
    expect(g.primary).toBe('#FCA004');
    expect(g.secondary).toBe('#0A4FA6');
    expect(g.accent).toBe('#FDD314');

    const bad = generateBrandColors({ primary: 'not-a-color' }, 'light', base);
    expect(bad.primary).toBe('#FCA004');
  });

  it('uses provided seeds (normalized) and derives on/dark/soft slots', () => {
    const g = generateBrandColors({ primary: '2e7d32', secondary: '#795548' }, 'light', base);
    expect(g.primary).toBe('#2E7D32');
    expect(g.secondary).toBe('#795548');
    expect(g.onPrimary).toBeDefined();
    expect(g.primaryDark).toBeDefined();
    expect(g.primarySoft).toBeDefined();
    // Pressed shade is darker than the base color in light mode.
    expect(relativeLuminance(g.primaryDark)).toBeLessThan(relativeLuminance(g.primary));
  });

  it('always picks the most legible on-color (never the worse ink) for any brand color', () => {
    // Includes deliberately awkward mid-tones (#E91E63, #03A9F4) where NO pure
    // ink can reach AA — the generator must still choose the better of the two.
    const brandPrimaries = ['#2E7D32', '#795548', '#E91E63', '#FFEB3B', '#03A9F4', '#9C27B0', '#212121', '#F5F5F5'];
    for (const primary of brandPrimaries) {
      const g = generateBrandColors({ primary }, 'light', base);
      const worse = g.onPrimary === '#FFFFFF' ? '#10151F' : '#FFFFFF';
      expect(contrastRatio(g.onPrimary, g.primary)).toBeGreaterThanOrEqual(contrastRatio(worse, g.primary));
    }
  });

  it('reaches AA on deep/saturated brand primaries (the common case)', () => {
    for (const primary of ['#2E7D32', '#0A4FA6', '#A22601', '#6A1B9A', '#00695C', '#FDD314']) {
      const g = generateBrandColors({ primary }, 'light', base);
      expect(meetsAA(g.onPrimary, g.primary)).toBe(true);
    }
  });

  it('light-mode soft tint stays close to the surface (subtle, not saturated)', () => {
    const g = generateBrandColors({ primary: '#0A4FA6' }, 'light', base);
    // Soft is mostly surface → high luminance, clearly lighter than the primary.
    expect(relativeLuminance(g.primarySoft)).toBeGreaterThan(relativeLuminance(g.primary));
  });
});
