import { useState } from "react";
import { SettingsSection } from "./settings-section";
import { usePreferences, type Theme } from "./preferences";

const themes: { value: Theme; label: string; description: string }[] = [
  { value: "system", label: "System", description: "Follow your device appearance." },
  { value: "light", label: "Light", description: "Always use the light palette." },
  { value: "dark", label: "Dark", description: "Always use the dark palette." },
];

export function AppearanceSettings() {
  const { preferences, updatePreferences } = usePreferences();
  const [error, setError] = useState("");

  return (
    <SettingsSection title="Appearance" description="Sparkles remembers this on this device.">
      <fieldset className="appearance-options">
        <legend className="sr-only">Appearance</legend>
        {themes.map(({ value, label, description }) => (
          <label className="appearance-option" key={value}>
            <input
              type="radio"
              name="appearance"
              value={value}
              checked={preferences.theme === value}
              onChange={() =>
                setError(
                  updatePreferences({ theme: value })
                    ? ""
                    : "Your browser could not save this preference.",
                )
              }
            />
            <span>
              <span className="appearance-label">{label}</span>
              <span className="appearance-description">{description}</span>
            </span>
          </label>
        ))}
      </fieldset>
      {error && (
        <p className="settings-status" role="alert">
          {error}
        </p>
      )}
    </SettingsSection>
  );
}
