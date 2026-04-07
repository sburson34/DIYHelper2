import React, { createContext, useContext, useState, useEffect } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { translations } from './translations';

const LANGUAGE_KEY = '@app_language';

const I18nContext = createContext({
  language: 'en',
  setLanguage: () => {},
  t: (key) => key,
});

export function I18nProvider({ children }) {
  const [language, setLanguageState] = useState('en');
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const saved = await AsyncStorage.getItem(LANGUAGE_KEY);
        if (saved === 'en' || saved === 'es') {
          setLanguageState(saved);
        }
      } catch (e) {
        console.error('Failed to load language preference', e);
      } finally {
        setLoaded(true);
      }
    })();
  }, []);

  const setLanguage = async (lang) => {
    setLanguageState(lang);
    try {
      await AsyncStorage.setItem(LANGUAGE_KEY, lang);
    } catch (e) {
      console.error('Failed to save language preference', e);
    }
  };

  const t = (key) => {
    return translations[language]?.[key] ?? translations.en[key] ?? key;
  };

  if (!loaded) return null;

  return (
    <I18nContext.Provider value={{ language, setLanguage, t }}>
      {children}
    </I18nContext.Provider>
  );
}

export function useTranslation() {
  return useContext(I18nContext);
}
