import { useRef, useState } from "react";
import { Popover } from "@base-ui/react/popover";
import Check from "@hugeicons/core-free-icons/Tick02Icon";
import Gauge from "@hugeicons/core-free-icons/DashboardSpeed01Icon";
import Shield from "@hugeicons/core-free-icons/ShieldKeyIcon";
import Workflow from "@hugeicons/core-free-icons/WorkflowCircle04Icon";
import { AppIcon } from "../ui/app-icon";
import { permissionModeOptions } from "../../../bridge/permission-modes";
import type { PermissionMode, PermissionModes } from "../../../bridge/permission-modes";

const modeIcons = new Map([
  ["read-only", Workflow],
  ["agent", Gauge],
  ["agent-full-access", Shield],
]);

export function PermissionPicker({
  agent,
  modes,
  onChange,
  disabled = false,
  unavailableReason,
  running = false,
}: {
  agent?: "codex" | "opencode";
  modes?: PermissionModes;
  onChange?: (modeId: PermissionMode) => Promise<boolean> | boolean;
  disabled?: boolean;
  unavailableReason?: string;
  running?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [changing, setChanging] = useState(false);
  const [error, setError] = useState<string>();
  const pending = useRef(false);
  const current = permissionModeOptions.find((mode) => mode.id === modes?.currentModeId);
  const label = agent === "codex" ? (current?.name ?? "Standard") : "Manual";

  async function change(modeId: PermissionMode) {
    if (!onChange || disabled || pending.current) return;
    if (modeId === modes?.currentModeId) {
      setOpen(false);
      return;
    }
    pending.current = true;
    setChanging(true);
    setError(undefined);
    try {
      if (await onChange(modeId)) setOpen(false);
      else setError("Could not change permissions. Try again.");
    } catch {
      setError("Could not change permissions. Try again.");
    } finally {
      pending.current = false;
      setChanging(false);
    }
  }

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger className="composer-permission" aria-label="Permissions">
        <AppIcon icon={modeIcons.get(modes?.currentModeId ?? "") ?? Shield} size={14} />
        <span>{changing ? "Updating…" : label}</span>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner
          side="top"
          align="start"
          sideOffset={8}
          className="composer-menu-positioner"
        >
          <Popover.Popup className="composer-menu">
            <Popover.Title className="composer-menu-heading">Permissions</Popover.Title>
            {agent === "codex" ? (
              <>
                {permissionModeOptions.map((mode) => (
                  <button
                    key={mode.id}
                    className="composer-menu-item"
                    type="button"
                    aria-label={`${mode.name}: ${mode.description}`}
                    aria-pressed={modes?.currentModeId === mode.id}
                    disabled={
                      disabled ||
                      changing ||
                      !onChange ||
                      !modes?.availableModes.some((available) => available.id === mode.id)
                    }
                    onClick={() => void change(mode.id)}
                  >
                    <AppIcon icon={modeIcons.get(mode.id) ?? Shield} size={20} />
                    <span>
                      {mode.name}
                      <small>{mode.description}</small>
                    </span>
                    {modes?.currentModeId === mode.id && <AppIcon icon={Check} size={16} />}
                  </button>
                ))}
                {unavailableReason && <p className="permission-mode-notice">{unavailableReason}</p>}
                {running && (
                  <p className="permission-mode-notice">
                    Changes apply to the next turn. Pending approvals still need your response.
                  </p>
                )}
              </>
            ) : (
              <div className="composer-menu-item" aria-current="true">
                <AppIcon icon={Shield} size={20} />
                <span>
                  Manual
                  <small>
                    OpenCode asks before making changes. Permission switching is available with
                    Codex.
                  </small>
                </span>
                <AppIcon icon={Check} size={16} />
              </div>
            )}
            {error && (
              <p className="permission-mode-notice permission-mode-error" role="alert">
                {error}
              </p>
            )}
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
