import { useId, useState } from "react";
import {
  Check,
  ChevronDown,
  FileCode2,
  FileText,
  Pencil,
  Search,
  Terminal,
  Wrench,
  CircleAlert,
} from "lucide-react";
import type { ToolCall } from "./tool-activity";

const kinds = new Map([
  ["read", { icon: FileText, label: "Read" }],
  ["edit", { icon: Pencil, label: "Edit" }],
  ["search", { icon: Search, label: "Search" }],
  ["execute", { icon: Terminal, label: "Run" }],
]);
function toolKind(kind: string) {
  return kinds.get(kind) ?? { icon: Wrench, label: "Tool" };
}
export function ToolActivity({ call }: { call: ToolCall }) {
  const [expanded, setExpanded] = useState<boolean | null>(null);
  const panelId = useId();
  const active = ["pending", "in_progress"].includes(call.status);
  const open = expanded ?? active;
  const { icon: Icon, label } = toolKind(call.kind);
  const status = statusLabels.get(call.status) ?? "Working";
  return (
    <section className="tool-task" data-status={call.status}>
      <button
        className="tool-task-heading"
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setExpanded(!open)}
      >
        <Icon size={16} aria-hidden="true" />
        <span className={`tool-task-title${active ? " tool-task-shimmer" : ""}`}>{call.title}</span>
        <span className="tool-task-status">
          {call.status === "completed" ? (
            <Check size={13} aria-hidden="true" />
          ) : ["failed", "interrupted"].includes(call.status) ? (
            <CircleAlert size={13} aria-hidden="true" />
          ) : null}
          <span className="sr-only">{status}</span>
        </span>
        <ChevronDown size={16} className="tool-task-chevron" aria-hidden="true" />
      </button>
      <div className="tool-task-panel" data-open={open} id={panelId} inert={!open}>
        <ul className="tool-task-steps">
          <li>
            <span className="tool-task-branch" aria-hidden="true" />
            <div className="tool-task-step">
              <span>{label}</span>
              {call.paths.map((path) => (
                <span key={path} className="tool-file-chip" title={path}>
                  <FileCode2 size={14} aria-hidden="true" />
                  <span>{path.split("/").at(-1) || path}</span>
                </span>
              ))}
            </div>
          </li>
          <li>
            <span className="tool-task-branch" aria-hidden="true" />
            <div className="tool-task-step">
              <span>{status}</span>
            </div>
          </li>
          <ToolDetails call={call} />
        </ul>
      </div>
    </section>
  );
}

const statusLabels = new Map([
  ["completed", "Completed"],
  ["failed", "Failed"],
  ["interrupted", "Interrupted"],
  ["pending", "Waiting"],
  ["in_progress", "Working"],
]);
function ToolDetails({ call }: { call: ToolCall }) {
  if (call.input === undefined && call.output === undefined) return null;
  return (
    <li>
      <span className="tool-task-branch" aria-hidden="true" />
      <details className="tool-task-details">
        <summary>View input and output</summary>
        {call.input !== undefined && (
          <>
            <h3>Input</h3>
            <pre>{JSON.stringify(call.input, null, 2)}</pre>
          </>
        )}
        {call.output !== undefined && (
          <>
            <h3>Output</h3>
            <pre>{JSON.stringify(call.output, null, 2)}</pre>
          </>
        )}
      </details>
    </li>
  );
}
