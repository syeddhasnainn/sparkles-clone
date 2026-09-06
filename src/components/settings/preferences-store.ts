import { z } from "zod";

export type Theme = "system" | "light" | "dark";

export interface Preferences {
  theme: Theme;
  analytics: boolean;
  replay: boolean;
}

export const defaults: Preferences = { theme: "system", analytics: false, replay: false };
const storageKey = "sparkles-preferences";
const changeEvent = "sparkles-preferences-change";
let memorySnapshot: string | null = null;

export function subscribe(callback: () => void) {
  window.addEventListener("storage", callback);
  window.addEventListener(changeEvent, callback);

  return () => {
    window.removeEventListener("storage", callback);
    window.removeEventListener(changeEvent, callback);
  };
}

export function getSnapshot() {
  try {
    return window.localStorage.getItem(storageKey) ?? memorySnapshot;
  } catch {
    return memorySnapshot;
  }
}

const preferencesSchema = z
  .object({
    theme: z.enum(["system", "light", "dark"]).catch("system"),
    analytics: z.boolean().optional().catch(undefined),
    replay: z.boolean().catch(defaults.replay),
  })
  .transform((value) => ({
    theme: value.theme,
    analytics: value.analytics ?? defaults.analytics,
    replay: value.replay && value.analytics !== false,
  }));

export function parsePreferences(raw: string | null): Preferences {
  try {
    const result = preferencesSchema.safeParse(JSON.parse(raw ?? "null"));

    return result.success ? result.data : defaults;
  } catch {
    return defaults;
  }
}

export function updatePreferences(changes: Partial<Preferences>) {
  const next = { ...parsePreferences(getSnapshot()), ...changes };

  if (next.replay) {
    next.analytics = true;
  }

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
