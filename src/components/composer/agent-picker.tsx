import { useState } from "react";
import { bundledChatGPTModels } from "../../lib/chatgpt/bundled-models";
import { Link } from "@tanstack/react-router";
import { Popover } from "@base-ui/react/popover";
import ChevronDown from "@hugeicons/core-free-icons/ArrowDown01Icon";
import Check from "@hugeicons/core-free-icons/Tick02Icon";
import Search from "@hugeicons/core-free-icons/Search01Icon";
import { AppIcon } from "../ui/app-icon";
import { agentName, defaultAgentSelection } from "../../../bridge/agent-selection";
import type { AgentSelection } from "../../../bridge/agent-selection";

function AgentLogo({ agent }: { agent: AgentSelection["agent"] }) {
  return agent === "codex" ? (
    <span aria-hidden="true" className="agent-picker-logo agent-picker-codex" />
  ) : (
    <img alt="" src="/brand/opencode.svg" className="agent-picker-logo" />
  );
}

export function AgentPicker({
  selection = defaultAgentSelection,
  onChange,
  connected = false,
  disabled = false,
}: {
  selection?: AgentSelection;
  onChange?: (selection: AgentSelection) => void;
  connected?: boolean;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [agent, setAgent] = useState(selection.agent);
  const [query, setQuery] = useState("");
  const selectedName =
    selection.provider === "chatgpt"
      ? (bundledChatGPTModels.find((model) => model.id === selection.model)?.name ??
        selection.model.replace(/^gpt-/, "GPT-"))
      : "Sparkles model";
  const models: { name: string; value: AgentSelection }[] = [
    ...(agent === "opencode" ? [{ name: "Sparkles model", value: defaultAgentSelection }] : []),
    ...bundledChatGPTModels.map((model) => ({
      name: model.name,
      value: {
        agent,
        provider: "chatgpt" as const,
        model: model.id,
        permissionMode:
          agent === "codex" && selection.agent === "codex" && selection.provider === "chatgpt"
            ? selection.permissionMode
            : undefined,
      },
    })),
  ];
  const visible = models.filter((model) =>
    model.name.toLowerCase().includes(query.trim().toLowerCase()),
  );
  return (
    <Popover.Root
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          setAgent(selection.agent);
          setQuery("");
        }
      }}
    >
      <Popover.Trigger className="composer-model" aria-label="Models">
        <AgentLogo agent={selection.agent} />
        <span>{selectedName}</span>
        <AppIcon icon={ChevronDown} size={14} />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner
          side="top"
          align="start"
          sideOffset={8}
          className="composer-menu-positioner"
        >
          <Popover.Popup className="composer-menu agent-picker">
            <Popover.Title className="sr-only">Choose an agent and model</Popover.Title>
            <label className="agent-picker-search">
              <AppIcon icon={Search} size={17} />
              <input
                aria-label="Search models"
                placeholder="Search models…"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </label>
            <div className="agent-picker-body">
              <div className="agent-picker-rail" role="group" aria-label="Agents">
                {(["opencode", "codex"] as const).map((item) => (
                  <button
                    key={item}
                    type="button"
                    aria-label={agentName(item)}
                    title={agentName(item)}
                    aria-pressed={agent === item}
                    onClick={() => setAgent(item)}
                  >
                    <AgentLogo agent={item} />
                  </button>
                ))}
              </div>
              <div className="agent-picker-models">
                {!connected && onChange && (
                  <div className="agent-picker-connect-section">
                    <div>
                      <strong>ChatGPT</strong>
                      <p>Use your ChatGPT subscription</p>
                    </div>
                    <Link to="/app/settings/integrations" className="agent-picker-connect">
                      Connect
                    </Link>
                  </div>
                )}
                <div
                  className="agent-picker-options"
                  role="group"
                  aria-label={`${agentName(agent)} models`}
                >
                  {visible.map((model) => {
                    const selected =
                      selection.agent === agent &&
                      selection.provider === model.value.provider &&
                      (selection.provider !== "chatgpt" ||
                        (model.value.provider === "chatgpt" &&
                          selection.model === model.value.model));
                    return (
                      <button
                        key={model.value.provider === "chatgpt" ? model.value.model : "sparkles"}
                        type="button"
                        className="composer-menu-item"
                        aria-pressed={selected}
                        disabled={
                          disabled ||
                          !onChange ||
                          (model.value.provider === "chatgpt" && !connected)
                        }
                        onClick={() => {
                          const next = model.value;
                          if (next.provider === "chatgpt" && selection.provider === "chatgpt") {
                            const supported = bundledChatGPTModels.find(
                              (item) => item.id === next.model,
                            )?.reasoningEfforts;
                            next.reasoningEffort =
                              selection.reasoningEffort &&
                              supported?.includes(selection.reasoningEffort)
                                ? selection.reasoningEffort
                                : "medium";
                          }
                          onChange?.(next);
                          setOpen(false);
                        }}
                      >
                        <span>{model.name}</span>
                        {selected && <AppIcon icon={Check} size={16} />}
                      </button>
                    );
                  })}
                  {!visible.length && (
                    <p className="composer-menu-note">
                      {query.trim()
                        ? `No models match “${query}”.`
                        : "No models are available for this account."}
                    </p>
                  )}
                </div>
                {!onChange && (
                  <p className="composer-menu-note">
                    This task keeps its original agent and model.
                  </p>
                )}
              </div>
            </div>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
