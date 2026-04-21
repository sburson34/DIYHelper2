import React, { createContext, useContext, useEffect, useState, useCallback, ReactNode } from 'react';
import { lightTheme, darkTheme, Theme } from './theme';
import { getAppPrefs, setAppPrefs } from './utils/storage';

export interface ThemeContextValue {
  theme: Theme;
  isDark: boolean;
  toggleDark: () => void | Promise<void>;
}

const ThemeContext = createContext<ThemeContextValue>({
  theme: lightTheme,
  isDark: false,
  toggleDark: () => {},
});

export function ThemeProvider({ children }: { children: ReactNode }) {
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

  const value: ThemeContextValue = {
    theme: isDark ? darkTheme : lightTheme,
    isDark,
    toggleDark,
  };

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export const useAppTheme = (): ThemeContextValue => useContext(ThemeContext);
