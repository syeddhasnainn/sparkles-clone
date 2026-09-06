import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useSyncExternalStore,
  type ReactNode,
} from "react";

export type Theme = "system" | "light" | "dark";
export interface Preferences {
  theme: Theme;
  analytics: boolean;
  replay: boolean;
}

const defaults: Preferences = { theme: "system", analytics: false, replay: false };
const storageKey = "sparkles-preferences";
const changeEvent = "sparkles-preferences-change";
let memorySnapshot: string | null = null;

function subscribe(callback: () => void) {
  window.addEventListener("storage", callback);
  window.addEventListener(changeEvent, callback);
  return () => {
    window.removeEventListener("storage", callback);
    window.removeEventListener(changeEvent, callback);
  };
}

function getSnapshot() {
  try {
    return window.localStorage.getItem(storageKey) ?? memorySnapshot;
  } catch {
    return memorySnapshot;
  }
}

function parsePreferences(raw: string | null): Preferences {
  try {
    const parsed: unknown = JSON.parse(raw ?? "null");
    if (!parsed || typeof parsed !== "object") return defaults;
    const value = parsed as Partial<Preferences>;
    return {
      theme: value.theme === "light" || value.theme === "dark" ? value.theme : "system",
      analytics: typeof value.analytics === "boolean" ? value.analytics : defaults.analytics,
      replay:
        typeof value.replay === "boolean"
          ? value.replay && value.analytics !== false
          : defaults.replay && value.analytics !== false,
    };
  } catch {
    return defaults;
  }
}

function updatePreferences(changes: Partial<Preferences>) {
  const next = { ...parsePreferences(getSnapshot()), ...changes };
  if (next.replay) next.analytics = true;
  const serialized = JSON.stringify(next);
  memorySnapshot = serialized;
  try {
    window.localStorage.setItem(storageKey, serialized);
  } catch {
    return false;
  } finally {
    window.dispatchEvent(new Event(changeEvent));
  }
  return true;
}

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
  return (
    <PreferencesContext value={{ preferences, updatePreferences }}>{children}</PreferencesContext>
  );
}

export function usePreferences() {
  return useContext(PreferencesContext);
}
