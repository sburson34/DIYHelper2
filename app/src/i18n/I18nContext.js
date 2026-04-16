import React, { createContext, useContext, useState, useEffect, useRef } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { translations } from './translations';
import { translateStrings } from '../api/backendClient';

const LANGUAGE_KEY = '@app_language';
const TRANSLATIONS_PREFIX = '@translations_';

// Hardcoded locales — English and Spanish are maintained by hand in
// translations.js so they render instantly with no network call. Every other
// language supported by Google Cloud Translate is fetched on demand and cached
// per-device in AsyncStorage.
const HARDCODED = new Set(['en', 'es']);

const I18nContext = createContext({
  language: 'en',
  setLanguage: async () => {},
  t: (key) => key,
  isTranslating: false,
  translationError: null,
});

export function I18nProvider({ children }) {
  const [language, setLanguageState] = useState('en');
  const [dynamicTranslations, setDynamicTranslations] = useState(null);
  const [loaded, setLoaded] = useState(false);
  const [isTranslating, setIsTranslating] = useState(false);
  const [translationError, setTranslationError] = useState(null);
  // When the user switches languages rapidly we only want the latest response
  // to win. Ref-compared inside fetchDynamicTranslations.
  const currentLangRef = useRef('en');

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
              try { setDynamicTranslations(JSON.parse(cached)); } catch {}
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

  const fetchDynamicTranslations = async (lang) => {
    // Cache hit — skip the network round trip.
    try {
      const cached = await AsyncStorage.getItem(TRANSLATIONS_PREFIX + lang);
      if (cached) {
        try { return JSON.parse(cached); } catch {}
      }
    } catch {}

    const enTable = translations.en;
    const keys = Object.keys(enTable);
    const texts = keys.map((k) => enTable[k]);

    const translated = await translateStrings(texts, lang, 'en');

    const result = {};
    keys.forEach((key, i) => {
      result[key] = translated[i] || enTable[key];
    });

    try {
      await AsyncStorage.setItem(TRANSLATIONS_PREFIX + lang, JSON.stringify(result));
    } catch {}

    return result;
  };

  const setLanguage = async (lang) => {
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
      console.error('Translation fetch failed:', e);
      setTranslationError(e.message);
      // Fall back to English silently — t() handles that below.
    } finally {
      setIsTranslating(false);
    }
  };

  const t = (key) => {
    if (HARDCODED.has(language)) {
      return translations[language]?.[key] ?? translations.en[key] ?? key;
    }
    return dynamicTranslations?.[key] ?? translations.en[key] ?? key;
  };

  if (!loaded) return null;

  return (
    <I18nContext.Provider value={{ language, setLanguage, t, isTranslating, translationError }}>
      {children}
    </I18nContext.Provider>
  );
}

export function useTranslation() {
  return useContext(I18nContext);
}
