import { Text, TextInput } from 'react-native';

// Applies a brand typeface app-wide by defaulting the fontFamily on Text and
// TextInput — so a white-label brand's font shows everywhere without editing
// every screen. Uses defaultProps (still honored in RN 0.83) and is guarded +
// idempotent: if a runtime rejects it, text simply falls back to the platform
// default rather than crashing.

let applied = false;

export function applyGlobalFont(fontFamily?: string | null): void {
  if (applied || !fontFamily || fontFamily === 'System') return;
  try {
    for (const Comp of [Text, TextInput] as unknown as Array<{ defaultProps?: { style?: unknown } }>) {
      Comp.defaultProps = Comp.defaultProps || {};
      const existing = Comp.defaultProps.style;
      Comp.defaultProps.style = existing ? [{ fontFamily }, existing] : { fontFamily };
    }
    applied = true;
  } catch {
    // No-op: leave the platform default font.
  }
}
