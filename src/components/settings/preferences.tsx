import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import {
  defaults,
  subscribe,
  getSnapshot,
  parsePreferences,
  updatePreferences,
} from "./preferences-store";

const PreferencesContext = createContext({ preferences: defaults, updatePreferences });

export function PreferencesProvider({ children }: { children: ReactNode }) {
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, () => null);
  const preferences = useMemo(() => parsePreferences(snapshot), [snapshot]);

  useEffect(() => {
    const query = window.matchMedia("(prefers-color-scheme: dark)");

    const apply = () => {
      const theme = parsePreferences(getSnapshot()).theme;
      const dark = theme === "dark" || (theme === "system" && query.matches);

      document.documentElement.classList.toggle("dark", dark);
      document.documentElement.style.colorScheme = dark ? "dark" : "light";
    };

    apply();
    query.addEventListener("change", apply);

    return () => query.removeEventListener("change", apply);
  }, [preferences.theme]);

  const value = useMemo(() => ({ preferences, updatePreferences }), [preferences]);

  return <PreferencesContext value={value}>{children}</PreferencesContext>;
}

export function usePreferences() {
  return useContext(PreferencesContext);
}
