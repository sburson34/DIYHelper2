import Constants from 'expo-constants';
import { generateBrandColors, BrandSeed } from './brandPalette';
import { BRAND_FONT } from './config/appInfo';
import { fontKeysFor } from './fontNames';

// ── White-label brand hues ────────────────────────────────────────────
// The active brand (brands/<id>/brand.json → app.config.js → expo-constants)
// supplies primary/secondary/accent seed colors. From those, brandPalette
// derives a coherent, contrast-safe set — readable on-colors (onPrimary etc.)
// plus pressed (…Dark) and tinted (…Soft) variants — so any brand color stays
// legible. Backgrounds, text, and semantic colors stay neutral per light/dark
// mode (chrome is neutral; the brand shows through accents/buttons/links).
// Falls back to the DIYHelper palette when no brand is present (e.g. Jest,
// where expo-constants exposes no expoConfig).
const C = Constants as unknown as {
  expoConfig?: { extra?: { brand?: { colors?: BrandSeed } } };
  manifest?: { extra?: { brand?: { colors?: BrandSeed } } };
};
const brandHues: BrandSeed =
  C.expoConfig?.extra?.brand?.colors ?? C.manifest?.extra?.brand?.colors ?? {};

// Light theme palette (kept as default export so legacy `import theme from '../theme'` still works)
const baseLight = {
  primary: '#FCA004', // Action Orange
  secondary: '#0A4FA6', // Professional Blue
  accent: '#FDD314', // Construction Yellow
  background: '#FBFBFB',
  surface: '#FFFFFF',
  text: '#0F2253', // Dark Navy
  textSecondary: '#636E72',
  success: '#00B894',
  warning: '#FDD314',
  danger: '#A22601',
  border: '#DFE6E9',
  shadow: '#000000',
};

const baseDark: typeof baseLight = {
  primary: '#FCA004',
  secondary: '#3A82E0',
  accent: '#FDD314',
  background: '#0B1220',
  surface: '#172033',
  text: '#F4F6FB',
  textSecondary: '#9CA9C2',
  success: '#34D399',
  warning: '#FDD314',
  danger: '#F87171',
  border: '#2A3550',
  shadow: '#000000',
};

// Brand seed → full contrast-safe brand slots, layered over the neutral base
// for each mode. This overrides primary/secondary/accent (as before) AND adds
// onPrimary/onSecondary/onAccent + primaryDark/primarySoft/secondaryDark.
const light = { ...baseLight, ...generateBrandColors(brandHues, 'light', baseLight) };
const dark = { ...baseDark, ...generateBrandColors(brandHues, 'dark', baseDark) };

// Brand typeface → loaded font keys, falling back to the platform default.
const fk = fontKeysFor(BRAND_FONT);
const shared = {
  roundness: { small: 8, medium: 16, large: 24, full: 999 },
  spacing: { xs: 4, s: 8, m: 16, l: 24, xl: 32 },
  fonts: {
    regular: fk?.regular ?? 'System',
    medium: fk?.medium ?? 'System',
    bold: fk?.bold ?? 'System',
  },
};

export type ThemeColors = typeof light;
export type Theme = { colors: ThemeColors } & typeof shared;

export const lightTheme: Theme = { colors: light, ...shared };
export const darkTheme: Theme = { colors: dark, ...shared };

// Default export = light theme. Legacy screens import this directly.
const theme: Theme = lightTheme;
export default theme;
