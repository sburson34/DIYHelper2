'use strict';

/* ── Brand palette generator ───────────────────────────────────────────────
   Hand-port of app/src/brandPalette.ts — SAME exported names, same math, so
   the Brand Studio preview matches exactly what the mobile app will render.
   Parity is enforced by the shared fixture file
   app/src/__tests__/fixtures/brandPalette.fixtures.json, asserted by BOTH the
   app's jest suite and backend/console-tests (vitest). If you change one
   port, regenerate the fixtures and the other side's test will tell you. */

/** Parses "#rgb", "#rrggbb" (with or without '#'). Returns null if invalid. */
export function parseColor(input) {
  if (typeof input !== 'string') return null;
  let hex = input.trim().replace(/^#/, '');
  if (hex.length === 3) {
    hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
  }
  if (!/^[0-9a-fA-F]{6}$/.test(hex)) return null;
  return {
    r: parseInt(hex.slice(0, 2), 16),
    g: parseInt(hex.slice(2, 4), 16),
    b: parseInt(hex.slice(4, 6), 16),
  };
}

export function isValidColor(input) {
  return parseColor(input) !== null;
}

const clampByte = (n) => Math.max(0, Math.min(255, Math.round(n)));

export function toHex(rgb) {
  const h = (n) => clampByte(n).toString(16).padStart(2, '0');
  return `#${h(rgb.r)}${h(rgb.g)}${h(rgb.b)}`.toUpperCase();
}

/** Normalizes any accepted input to "#RRGGBB" (uppercase), or null if invalid. */
export function normalizeHex(input) {
  const rgb = parseColor(input);
  return rgb ? toHex(rgb) : null;
}

/** WCAG relative luminance (0..1). */
export function relativeLuminance(color) {
  const rgb = typeof color === 'string' ? parseColor(color) : color;
  if (!rgb) return 0;
  const lin = (c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * lin(rgb.r) + 0.7152 * lin(rgb.g) + 0.0722 * lin(rgb.b);
}

/** WCAG contrast ratio between two colors (1..21). */
export function contrastRatio(a, b) {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const lighter = Math.max(la, lb);
  const darker = Math.min(la, lb);
  return (lighter + 0.05) / (darker + 0.05);
}

/** Linear sRGB mix of two colors; weight 0 = a, 1 = b. */
export function mix(a, b, weight) {
  const ca = parseColor(a);
  const cb = parseColor(b);
  if (!ca || !cb) return a;
  const w = Math.max(0, Math.min(1, weight));
  return toHex({
    r: ca.r + (cb.r - ca.r) * w,
    g: ca.g + (cb.g - ca.g) * w,
    b: ca.b + (cb.b - ca.b) * w,
  });
}

export const lighten = (hex, amount) => mix(hex, '#FFFFFF', amount);
export const darken = (hex, amount) => mix(hex, '#000000', amount);

const DARK_INK = '#10151F';
const LIGHT_INK = '#FFFFFF';

/**
 * Picks the text/icon color to place ON a background so it stays readable.
 * Returns whichever of the ink options has the higher contrast (so a pale
 * brand color yields dark ink, a deep one yields white). AA is 4.5:1.
 */
export function onColor(background, darkInk = DARK_INK, lightInk = LIGHT_INK) {
  const cDark = contrastRatio(background, darkInk);
  const cLight = contrastRatio(background, lightInk);
  // Prefer white on ties for a more vivid look, but only when it's actually AA.
  if (cLight >= 4.5 && cLight >= cDark) return lightInk;
  if (cDark >= 4.5) return darkInk;
  return cDark >= cLight ? darkInk : lightInk;
}

/** True when `fg` on `bg` clears WCAG AA (4.5:1) for normal text. */
export const meetsAA = (fg, bg) => contrastRatio(fg, bg) >= 4.5;

/**
 * Derives the full set of brand-driven slots from a seed. Any missing/invalid
 * seed color falls back to the corresponding base hue, so partial brands (e.g.
 * just a primary) still produce a complete, coherent palette.
 */
export function generateBrandColors(seed, mode, base) {
  const s = seed || {};
  const primary = normalizeHex(s.primary) ?? base.primary;
  const secondary = normalizeHex(s.secondary) ?? base.secondary;
  const accent = normalizeHex(s.accent) ?? base.accent;

  // Pressed/hover shade: darken in light mode, lighten slightly in dark mode so
  // the state is still visible against a dark background.
  const shade = (hex) => (mode === 'light' ? darken(hex, 0.16) : lighten(hex, 0.12));
  // Tinted background (badges, active rows): mostly the surface with a hint of brand.
  const soft = (hex) => mix(base.surface, hex, mode === 'light' ? 0.12 : 0.2);

  return {
    primary,
    onPrimary: onColor(primary),
    primaryDark: shade(primary),
    primarySoft: soft(primary),
    secondary,
    onSecondary: onColor(secondary),
    secondaryDark: shade(secondary),
    accent,
    onAccent: onColor(accent),
  };
}
