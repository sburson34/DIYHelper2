// Font asset map — imports the actual .ttf binaries for the curated families.
// Imported ONLY by App.js (to load the active brand's font); everything else
// uses the light fontNames.ts. Bundling a few families keeps every white-label
// build self-contained; only the brand's chosen family is ever loaded/applied.

import {
  Inter_400Regular,
  Inter_600SemiBold,
  Inter_700Bold,
} from '@expo-google-fonts/inter';
import {
  Poppins_400Regular,
  Poppins_600SemiBold,
  Poppins_700Bold,
} from '@expo-google-fonts/poppins';
import {
  Montserrat_400Regular,
  Montserrat_600SemiBold,
  Montserrat_700Bold,
} from '@expo-google-fonts/montserrat';

type AssetMap = Record<string, number>;

const ASSETS: Record<string, AssetMap> = {
  Inter: {
    Inter_400Regular,
    Inter_600SemiBold,
    Inter_700Bold,
  },
  Poppins: {
    Poppins_400Regular,
    Poppins_600SemiBold,
    Poppins_700Bold,
  },
  Montserrat: {
    Montserrat_400Regular,
    Montserrat_600SemiBold,
    Montserrat_700Bold,
  },
};

/** The font assets to hand to expo-font's useFonts for a brand. Empty ({}) for
 *  System or unknown families, which resolves as "already loaded" immediately. */
export function brandFontAssets(name: string | null | undefined): AssetMap {
  if (!name || name === 'System') return {};
  return ASSETS[name] ?? {};
}

export { fontKeysFor } from './fontNames';
