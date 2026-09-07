import { useState } from "react";
import { Popover } from "@base-ui/react/popover";
import ChevronDown from "@hugeicons/core-free-icons/ArrowDown01Icon";
import Check from "@hugeicons/core-free-icons/Tick02Icon";
import { AppIcon } from "../ui/app-icon";
import { bundledChatGPTModels } from "../../lib/chatgpt/bundled-models";
import type { AgentSelection, ReasoningEffort } from "../../../bridge/agent-selection";

const labels: Record<ReasoningEffort, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
  xhigh: "Extra high",
  max: "Max",
  ultra: "Ultra",
};

export function ReasoningPicker({
  selection,
  onChange,
  disabled,
}: {
  selection?: AgentSelection;
  onChange?: (selection: AgentSelection) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  if (selection?.provider !== "chatgpt") return null;
  const model = bundledChatGPTModels.find((model) => model.id === selection.model);
  const effort = selection.reasoningEffort ?? "medium";
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger className="composer-model composer-reasoning" aria-label="Reasoning effort">
        <span>{labels[effort]}</span>
        <AppIcon icon={ChevronDown} size={14} />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner
          side="top"
          align="start"
          sideOffset={8}
          className="composer-menu-positioner"
        >
          <Popover.Popup className="composer-menu reasoning-picker">
            <Popover.Title className="composer-menu-heading">Reasoning</Popover.Title>
            <div role="group" aria-label="Reasoning levels">
              {model?.reasoningEfforts.map((value) => (
                <button
                  key={value}
                  type="button"
                  className="composer-menu-item"
                  aria-pressed={effort === value}
                  disabled={disabled || !onChange}
                  onClick={() => {
                    onChange?.({ ...selection, reasoningEffort: value });
                    setOpen(false);
                  }}
                >
                  <span>{labels[value]}</span>
                  {effort === value && <AppIcon icon={Check} size={16} />}
                </button>
              ))}
            </div>
            {!onChange && (
              <p className="composer-menu-note">This task keeps its original reasoning level.</p>
            )}
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
