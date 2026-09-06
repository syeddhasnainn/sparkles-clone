import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { Picker } from "./picker";

const models = [
  "Agent default",
  "GPT-5.6-Sol",
  "GPT-5.6-Terra",
  "GPT-5.6-Luna",
  "GPT-5.5",
  "GPT-5.2",
];

function OptionGroup({
  title,
  options,
  value,
  onChange,
}: {
  title: string;
  options: string[];
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <section className="agent-option-group">
      <h3>{title}</h3>
      {options.map((option) => (
        <button
          key={option}
          className="picker-option"
          onClick={() => onChange(option)}
          aria-pressed={option === value}
        >
          <span className="selection-mark">
            {option === value && <span className="selection-dot" />}
          </span>
          {option}
        </button>
      ))}
    </section>
  );
}

export function AgentPicker() {
  const [harness, setHarness] = useState("Codex");
  const [model, setModel] = useState("GPT-5.6-Sol");
  const [mode, setMode] = useState("");
  const [collaboration, setCollaboration] = useState("");
  const [effort, setEffort] = useState("Low");
  return (
    <Picker
      label={`Agent configuration: ${model} · ${harness}`}
      side="top"
      popupClassName="agent-popup"
      trigger={
        <>
          <img className="agent-icon" src="/brand/codex.svg" alt="" />
          <span>{model}</span>
          <span className="muted">·</span>
          <span className="muted harness-label">{harness}</span>
          <ChevronDown size={12} />
        </>
      }
    >
      <OptionGroup
        title="Harness"
        options={["Claude Code", "Codex", "Grok", "OpenCode"]}
        value={harness}
        onChange={setHarness}
      />
      <OptionGroup
        title="Mode"
        options={["Read-only", "Agent", "Agent (full access)"]}
        value={mode}
        onChange={setMode}
      />
      <OptionGroup
        title="Collaboration mode"
        options={["Default", "Plan"]}
        value={collaboration}
        onChange={setCollaboration}
      />
      <OptionGroup title="Model" options={models} value={model} onChange={setModel} />
      <OptionGroup
        title="Reasoning effort"
        options={["Agent default", "Low", "Medium", "High", "Xhigh"]}
        value={effort}
        onChange={setEffort}
      />
    </Picker>
  );
}
