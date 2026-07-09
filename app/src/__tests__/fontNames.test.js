const { FONT_KEYS, AVAILABLE_FONTS, fontKeysFor } = require('../fontNames');

describe('fontNames', () => {
  it('offers System first, then the bundled families', () => {
    expect(AVAILABLE_FONTS[0]).toBe('System');
    expect(AVAILABLE_FONTS).toEqual(expect.arrayContaining(['Inter', 'Poppins', 'Montserrat']));
  });

  it('resolves a family to its weight keys', () => {
    expect(fontKeysFor('Poppins')).toEqual({
      label: 'Poppins',
      regular: 'Poppins_400Regular',
      medium: 'Poppins_600SemiBold',
      bold: 'Poppins_700Bold',
    });
    expect(fontKeysFor('Inter').bold).toBe('Inter_700Bold');
  });

  it('returns null for System, unknown, or missing names', () => {
    expect(fontKeysFor('System')).toBeNull();
    expect(fontKeysFor('Comic Sans')).toBeNull();
    expect(fontKeysFor(undefined)).toBeNull();
    expect(fontKeysFor(null)).toBeNull();
  });

  it('every family key matches the "<Family>_<weight>" convention', () => {
    for (const [family, keys] of Object.entries(FONT_KEYS)) {
      expect(keys.regular.startsWith(family + '_')).toBe(true);
      expect(keys.bold.startsWith(family + '_')).toBe(true);
    }
  });
});
