import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { lightTheme, darkTheme } from './theme';
import { getAppPrefs, setAppPrefs } from './utils/storage';

const ThemeContext = createContext({
  theme: lightTheme,
  isDark: false,
  toggleDark: () => {},
});

export function ThemeProvider({ children }) {
  const [isDark, setIsDark] = useState(false);

  useEffect(() => {
    (async () => {
      const prefs = await getAppPrefs();
      setIsDark(!!prefs.darkMode);
    })();
  }, []);

  const toggleDark = useCallback(async () => {
    const next = !isDark;
    setIsDark(next);
    await setAppPrefs({ darkMode: next });
  }, [isDark]);

  const value = {
    theme: isDark ? darkTheme : lightTheme,
    isDark,
    toggleDark,
  };

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export const useAppTheme = () => useContext(ThemeContext);
