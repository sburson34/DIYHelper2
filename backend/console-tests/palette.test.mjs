// Parity: the console's hand-ported palette.js must reproduce the SAME shared
// fixtures that app/src/__tests__/brandPalette.test.js asserts against the TS
// original. Drift in either port fails its side's CI.
import { describe, it, expect } from 'vitest';
import {
  normalizeHex,
  contrastRatio,
  onColor,
  generateBrandColors,
} from '../DIYHelper2.Api/wwwroot/admin/js/palette.js';
import fixtures from '../../app/src/__tests__/fixtures/brandPalette.fixtures.json';

describe('fixture parity with app/src/brandPalette.ts', () => {
  it('normalizeHex reproduces every fixture', () => {
    for (const { input, expected } of fixtures.normalizeHex) {
      expect(normalizeHex(input)).toBe(expected);
    }
  });

  it('contrastRatio reproduces every fixture', () => {
    for (const { input, expected } of fixtures.contrastRatio) {
      expect(contrastRatio(input[0], input[1])).toBeCloseTo(expected, 6);
    }
  });

  it('onColor reproduces every fixture', () => {
    for (const { input, expected } of fixtures.onColor) {
      const got = input.darkInk
        ? onColor(input.background, input.darkInk, input.lightInk)
        : onColor(input.background);
      expect(got).toBe(expected);
    }
  });

  it('generateBrandColors reproduces every fixture', () => {
    for (const { input, expected } of fixtures.generateBrandColors) {
      expect(generateBrandColors(input.seed, input.mode, input.base)).toEqual(expected);
    }
  });
});
