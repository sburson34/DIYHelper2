// Light theme palette (kept as default export so legacy `import theme from '../theme'` still works)
const light = {
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

const dark = {
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

const shared = {
  roundness: { small: 8, medium: 16, large: 24, full: 999 },
  spacing: { xs: 4, s: 8, m: 16, l: 24, xl: 32 },
  fonts: { regular: 'System', bold: 'System' },
};

export const lightTheme = { colors: light, ...shared };
export const darkTheme = { colors: dark, ...shared };

// Default export = light theme. Legacy screens import this directly.
const theme = lightTheme;
export default theme;
