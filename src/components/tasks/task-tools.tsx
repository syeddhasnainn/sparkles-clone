import { toolOutput } from "./tool-output";
import { AppIcon } from "../ui/app-icon";
import { useId, useState } from "react";
import ChevronDown from "@hugeicons/core-free-icons/ArrowDown01Icon";
import FileText from "@hugeicons/core-free-icons/File01Icon";
import Pencil from "@hugeicons/core-free-icons/PencilEdit01Icon";
import Search from "@hugeicons/core-free-icons/Search01Icon";
import Terminal from "@hugeicons/core-free-icons/ConsoleIcon";
import Wrench from "@hugeicons/core-free-icons/ToolsIcon";
import CircleAlert from "@hugeicons/core-free-icons/AlertCircleIcon";
import { z } from "zod";
import Folder from "@hugeicons/core-free-icons/Folder01Icon";
import type { ToolCall } from "./tool-activity";

const kinds = new Map([
  ["read", { icon: FileText, label: "Read" }],
  ["edit", { icon: Pencil, label: "Edited" }],
  ["search", { icon: Search, label: "Searched" }],
  ["execute", { icon: Terminal, label: "Ran" }],
]);
function toolKind(kind: string) {
  return kinds.get(kind) ?? { icon: Wrench, label: "Tool" };
}
export function ToolTimeline({ calls }: { calls: ToolCall[] }) {
  const [open, setOpen] = useState(false);
  const [visited, setVisited] = useState(false);
  const panelId = useId();
  const active = calls.some((call) => ["pending", "in_progress"].includes(call.status));
  const failures = calls.filter((call) => ["failed", "interrupted"].includes(call.status)).length;
  const summaries = new Map([
    ["read", active ? "Reading files" : "Read files"],
    ["edit", active ? "Editing files" : "Edited files"],
    ["search", active ? "Searching" : "Searched"],
    ["execute", active ? "Running commands" : "Ran commands"],
  ]);
  const callKinds = [...new Set(calls.map((call) => call.kind))];
  const summary = callKinds
    .map((kind, index) => {
      const text = summaries.get(kind) ?? (active ? "Using tools" : "Used tools");
      return index === 0 ? text : text.toLowerCase();
    })
    .join(", ");
  const groupIcon = callKinds.length === 1 ? toolKind(callKinds[0]).icon : Folder;
  return (
    <section className="tool-chips" aria-label="Tool calls">
      <button
        className="tool-chips-heading"
        aria-label={`${summary}${failures ? `, ${failures} ${failures === 1 ? "needs" : "need"} attention` : ""}`}
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => {
          setVisited(true);
          setOpen(!open);
        }}
      >
        <AppIcon icon={groupIcon} size={17} />
        <span>{summary}</span>
        {failures > 0 && (
          <span className="tool-chip-failed">
            {failures} {failures === 1 ? "needs" : "need"} attention
          </span>
        )}
        <AppIcon icon={ChevronDown} size={13} className="tool-group-chevron" />
      </button>
      <div className="tool-chips-collapse" data-open={open} id={panelId} inert={!open}>
        <div className="tool-chips-content">
          <ol className="tool-chips-rows">
            {visited && calls.map((call) => <ToolRow key={call.id} call={call} />)}
          </ol>
        </div>
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

function ToolRow({ call }: { call: ToolCall }) {
  const [open, setOpen] = useState(false);
  const [visited, setVisited] = useState(false);
  const panelId = useId();
  const { icon, label } = toolKind(call.kind);
  const failed = ["failed", "interrupted"].includes(call.status);
  const running = ["pending", "in_progress"].includes(call.status);
  const input = z.object({ command: z.string().optional() }).safeParse(call.input);
  const target = call.paths[0] || (input.success ? input.data.command : undefined) || call.title;
  return (
    <li className="tool-chip-item" data-status={call.status}>
      <button
        className="tool-chip-row"
        aria-label={`${label} ${target} ${statusLabels.get(call.status) ?? call.status}`}
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => {
          setVisited(true);
          setOpen(!open);
        }}
      >
        <span className="tool-chip-icon">
          <AppIcon icon={icon} size={17} />
        </span>
        <span className="tool-chip-label">{label}</span>
        <span className="tool-chip-target" data-file={call.paths.length > 0} title={target}>
          {call.paths.length > 0 ? target.split("/").at(-1) || target : target}
        </span>
        <AppIcon icon={ChevronDown} size={12} className="tool-chip-chevron" />
        {failed && <AppIcon icon={CircleAlert} size={13} className="tool-chip-failed" />}
        {running && <span className="tool-chip-pulse" aria-hidden="true" />}
        <span className="sr-only">{statusLabels.get(call.status) ?? call.status}</span>
      </button>
      <div className="tool-chips-collapse" data-open={open} id={panelId} inert={!open}>
        <div className="tool-chip-detail-clip">{visited && <ToolDetails call={call} />}</div>
      </div>
    </li>
  );
}

function ToolDetails({ call }: { call: ToolCall }) {
  const output = toolOutput(call);
  return (
    <div className="tool-chip-details">
      <p>{call.title}</p>
      {call.input !== undefined && (
        <>
          <h3>Input</h3>
          <pre>{toolOutput({ output: call.input }).text}</pre>
        </>
      )}
      {call.output !== undefined && (
        <>
          <h3>Output</h3>
          {output.text && <pre>{output.text}</pre>}
          {output.images.map((source, index) => (
            <img
              key={index}
              src={source}
              alt={`Computer screenshot ${index + 1}`}
              className="max-h-[36rem] w-full rounded-md object-contain"
              loading="lazy"
            />
          ))}
        </>
      )}
      {call.input === undefined && call.output === undefined && (
        <p>No additional details available.</p>
      )}
    </div>
  );
}
