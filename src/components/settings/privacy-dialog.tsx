import { AppIcon } from "../ui/app-icon";
import { useId, useState } from "react";
import { Dialog } from "@base-ui/react/dialog";
import { Switch } from "@base-ui/react/switch";
import X from "@hugeicons/core-free-icons/Cancel01Icon";
import { usePreferences } from "./preferences";

function PrivacyOption({
  title,
  description,
  checked,
  disabled,
  onChange,
}: {
  title: string;
  description: string;
  checked: boolean;
  disabled?: boolean;
  onChange?: (checked: boolean) => void;
}) {
  const descriptionId = useId();

  return (
    <div className="privacy-option">
      <span>
        <span className="privacy-option-title">{title}</span>
        <span id={descriptionId} className="privacy-option-description">
          {description}
        </span>
      </span>
      <Switch.Root
        className="privacy-switch"
        checked={checked}
        disabled={disabled}
        onCheckedChange={onChange}
        aria-label={title}
        aria-describedby={descriptionId}
      >
        <Switch.Thumb className="privacy-switch-thumb" />
      </Switch.Root>
    </div>
  );
}

export function PrivacyDialog() {
  const { preferences, updatePreferences } = usePreferences();
  const [open, setOpen] = useState(false);
  const [analytics, setAnalytics] = useState(preferences.analytics);
  const [replay, setReplay] = useState(preferences.replay);
  const [status, setStatus] = useState("");

  const save = (nextAnalytics: boolean, nextReplay: boolean) => {
    const persisted = updatePreferences({ analytics: nextAnalytics, replay: nextReplay });

    setStatus(
      persisted
        ? "Privacy choices saved on this device."
        : "Your browser could not save these choices.",
    );

    if (persisted) {
      setOpen(false);
    }
  };

  return (
    <>
      <Dialog.Root
        open={open}
        onOpenChange={(next) => {
          setOpen(next);

          if (next) {
            setAnalytics(preferences.analytics);
            setReplay(preferences.replay);
            setStatus("");
          }
        }}
      >
        <Dialog.Trigger className="settings-button">Privacy settings</Dialog.Trigger>
        <Dialog.Portal>
          <Dialog.Backdrop className="settings-dialog-backdrop" />
          <Dialog.Popup className="settings-dialog">
            <Dialog.Title className="settings-dialog-title">Privacy settings</Dialog.Title>
            <Dialog.Description className="settings-dialog-description">
              Choose which optional data Sparkles can collect. Essential storage is always on.
            </Dialog.Description>
            <Dialog.Close className="settings-dialog-close" aria-label="Close">
              <AppIcon icon={X} size={16} />
            </Dialog.Close>
            <div className="privacy-options">
              <PrivacyOption
                title="Essential"
                description="Required for authentication, security, and saved privacy choices."
                checked
                disabled
              />
              <PrivacyOption
                title="Product analytics"
                description="Helps us understand feature use and errors with PostHog."
                checked={analytics}
                onChange={(value) => {
                  setAnalytics(value);

                  if (!value) {
                    setReplay(false);
                  }
                }}
              />
              <PrivacyOption
                title="Session replay"
                description="Records masked interactions to find usability problems. Enabling replay also enables product analytics."
                checked={replay}
                onChange={(value) => {
                  setReplay(value);

                  if (value) {
                    setAnalytics(true);
                  }
                }}
              />
            </div>
            {status && (
              <p role="alert" className="settings-status">
                {status}
              </p>
            )}
            <div className="settings-dialog-actions">
              <button className="settings-button" onClick={() => save(false, false)}>
                Reject optional
              </button>
              <button className="settings-button primary" onClick={() => save(analytics, replay)}>
                Save choices
              </button>
            </div>
          </Dialog.Popup>
        </Dialog.Portal>
      </Dialog.Root>
      {!open && status && (
        <span role="status" className="sr-only">
          {status}
        </span>
      )}
    </>
  );
}
