import React, { createContext, useContext, useState, useEffect, useRef, ReactNode } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { translations, TranslationKey } from './translations';
import { translateStrings } from '../api/backendClient';

const LANGUAGE_KEY = '@app_language';
const TRANSLATIONS_PREFIX = '@translations_';

// Hardcoded locales — English and Spanish are maintained by hand in
// translations.ts so they render instantly with no network call. Every other
// language supported by Google Cloud Translate is fetched on demand and cached
// per-device in AsyncStorage.
const HARDCODED = new Set(['en', 'es']);

type DynamicTranslations = Record<string, string>;

export interface I18nContextValue {
  language: string;
  setLanguage: (lang: string) => Promise<void>;
  t: (key: TranslationKey | string) => string;
  isTranslating: boolean;
  translationError: string | null;
}

const defaultContext: I18nContextValue = {
  language: 'en',
  setLanguage: async () => {},
  t: (key) => key as string,
  isTranslating: false,
  translationError: null,
};

const I18nContext = createContext<I18nContextValue>(defaultContext);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<string>('en');
  const [dynamicTranslations, setDynamicTranslations] = useState<DynamicTranslations | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [isTranslating, setIsTranslating] = useState(false);
  const [translationError, setTranslationError] = useState<string | null>(null);
  // When the user switches languages rapidly we only want the latest response
  // to win. Ref-compared inside fetchDynamicTranslations.
  const currentLangRef = useRef<string>('en');

  // Load saved language + any cached dynamic translations on startup
  useEffect(() => {
    (async () => {
      try {
        const saved = await AsyncStorage.getItem(LANGUAGE_KEY);
        if (saved) {
          setLanguageState(saved);
          currentLangRef.current = saved;
          if (!HARDCODED.has(saved)) {
            const cached = await AsyncStorage.getItem(TRANSLATIONS_PREFIX + saved);
            if (cached) {
              try { setDynamicTranslations(JSON.parse(cached) as DynamicTranslations); } catch {}
            }
          }
        }
      } catch (e) {
        console.error('Failed to load language preference', e);
      } finally {
        setLoaded(true);
      }
    })();
  }, []);

  const fetchDynamicTranslations = async (lang: string): Promise<DynamicTranslations> => {
    // Cache hit — skip the network round trip.
    try {
      const cached = await AsyncStorage.getItem(TRANSLATIONS_PREFIX + lang);
      if (cached) {
        try { return JSON.parse(cached) as DynamicTranslations; } catch {}
      }
    } catch {}

    const enTable = translations.en;
    const keys = Object.keys(enTable) as TranslationKey[];
    const texts = keys.map((k) => enTable[k]);

    const translated = await translateStrings(texts, lang, 'en');

    const result: DynamicTranslations = {};
    keys.forEach((key, i) => {
      result[key] = translated[i] || enTable[key];
    });

    try {
      await AsyncStorage.setItem(TRANSLATIONS_PREFIX + lang, JSON.stringify(result));
    } catch {}

    return result;
  };

  const setLanguage = async (lang: string): Promise<void> => {
    setLanguageState(lang);
    currentLangRef.current = lang;
    setTranslationError(null);
    try { await AsyncStorage.setItem(LANGUAGE_KEY, lang); } catch (e) {
      console.error('Failed to save language preference', e);
    }

    if (HARDCODED.has(lang)) {
      setDynamicTranslations(null);
      return;
    }

    setIsTranslating(true);
    try {
      const dyn = await fetchDynamicTranslations(lang);
      // Only apply if the user hasn't switched languages again meanwhile.
      if (currentLangRef.current === lang) {
        setDynamicTranslations(dyn);
      }
    } catch (e) {
      const err = e as Error;
      console.error('Translation fetch failed:', err);
      setTranslationError(err.message);
      // Fall back to English silently — t() handles that below.
    } finally {
      setIsTranslating(false);
    }
  };

  const t = (key: TranslationKey | string): string => {
    const enTable = translations.en as Record<string, string>;
    if (HARDCODED.has(language)) {
      const localeTable = translations[language as 'en' | 'es'] as Record<string, string>;
      return localeTable?.[key] ?? enTable[key] ?? (key as string);
    }
    return dynamicTranslations?.[key] ?? enTable[key] ?? (key as string);
  };

  if (!loaded) return null;

  return (
    <I18nContext.Provider value={{ language, setLanguage, t, isTranslating, translationError }}>
      {children}
    </I18nContext.Provider>
  );
}

export function useTranslation(): I18nContextValue {
  return useContext(I18nContext);
}
