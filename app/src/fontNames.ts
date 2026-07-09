// Light font registry — just the family + font-key strings, no font binaries.
// theme.ts and the config layer import this so they don't pull ~MB of .ttf into
// every module. The actual asset requires live in fonts.ts (imported only by
// App.js for loading). Keep the keys in sync between the two files.

export interface FontKeys {
  label: string;
  regular: string;
  medium: string;
  bold: string;
}

export const FONT_KEYS: Record<string, FontKeys> = {
  Inter: { label: 'Inter', regular: 'Inter_400Regular', medium: 'Inter_600SemiBold', bold: 'Inter_700Bold' },
  Poppins: { label: 'Poppins', regular: 'Poppins_400Regular', medium: 'Poppins_600SemiBold', bold: 'Poppins_700Bold' },
  Montserrat: { label: 'Montserrat', regular: 'Montserrat_400Regular', medium: 'Montserrat_600SemiBold', bold: 'Montserrat_700Bold' },
};

// "System" = the platform default (no custom font). Always offered first.
export const AVAILABLE_FONTS: string[] = ['System', ...Object.keys(FONT_KEYS)];

/** Resolves a brand font name to its weight keys, or null for System/unknown. */
export function fontKeysFor(name: string | null | undefined): FontKeys | null {
  if (!name || name === 'System') return null;
  return FONT_KEYS[name] ?? null;
}
