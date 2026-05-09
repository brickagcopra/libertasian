import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { mmkvStorage } from '../storage/mmkv';
import { DEFAULT_THEME, THEMES, type Theme, type ThemeKey } from '../lib/design-tokens';

const STORAGE_KEY = 'theme_choice';

interface ThemeContextValue {
  theme: Theme;
  themeKey: ThemeKey;
  setTheme: (key: ThemeKey) => void;
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

function readPersistedTheme(): ThemeKey {
  const raw = mmkvStorage.getString(STORAGE_KEY);
  if (raw === 'A' || raw === 'B') return raw;
  return DEFAULT_THEME;
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [themeKey, setThemeKeyState] = useState<ThemeKey>(() => readPersistedTheme());

  const setTheme = useCallback((next: ThemeKey) => {
    setThemeKeyState(next);
    mmkvStorage.setString(STORAGE_KEY, next);
  }, []);

  const toggleTheme = useCallback(() => {
    setThemeKeyState((prev) => {
      const next: ThemeKey = prev === 'A' ? 'B' : 'A';
      mmkvStorage.setString(STORAGE_KEY, next);
      return next;
    });
  }, []);

  const value = useMemo<ThemeContextValue>(
    () => ({
      theme: THEMES[themeKey],
      themeKey,
      setTheme,
      toggleTheme,
    }),
    [themeKey, setTheme, toggleTheme],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    // Fallback for tests / components rendered outside the provider.
    return {
      theme: THEMES[DEFAULT_THEME],
      themeKey: DEFAULT_THEME,
      setTheme: () => undefined,
      toggleTheme: () => undefined,
    };
  }
  return ctx;
}
