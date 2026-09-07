import { useId, useState } from "react";
import { z } from "zod";
import ArrowDown01Icon from "@hugeicons/core-free-icons/ArrowDown01Icon";
import Cancel01Icon from "@hugeicons/core-free-icons/Cancel01Icon";
import { AppIcon } from "../ui/app-icon";
import type { Events, Agent } from "./task-types";

function pendingPermissions(events: Events) {
  const permissions = new Map<unknown, Events[number]>();
  for (const event of events) {
    if (event.type === "permission") permissions.set(event.data.id, event);
    if (["interrupted", "workspace_stopped", "restored"].includes(event.type)) permissions.clear();
    if (event.type === "permission_resolved") permissions.delete(event.data.id);
  }
  return [...permissions.values()];
}

function permissionDetails(permission: Events[number]) {
  // Show the actual approval request, never mutable updates from another call or turn.
  return z.record(z.string(), z.unknown()).parse(permission.data.toolCall);
}

export function Permissions({ agent }: { agent: Agent }) {
  const [activeId, setActiveId] = useState<number>();
  const [dismissed, setDismissed] = useState(false);
  const pending = pendingPermissions(agent.events);
  const index = Math.max(
    0,
    pending.findIndex((event) => event.id === activeId),
  );
  const event = pending[index];

  if (!event) return null;
  if (dismissed)
    return (
      <button className="approval-reopen" type="button" onClick={() => setDismissed(false)}>
        Review approval{pending.length > 1 ? `s (${pending.length})` : ""}
      </button>
    );

  return (
    <PermissionCard
      key={event.id}
      agent={agent}
      event={event}
      index={index}
      count={pending.length}
      onDismiss={() => setDismissed(true)}
      onNavigate={(next) => setActiveId(pending[next].id)}
    />
  );
}

function PermissionCard({
  agent,
  event,
  index,
  count,
  onDismiss,
  onNavigate,
}: {
  agent: Agent;
  event: Events[number];
  index: number;
  count: number;
  onDismiss: () => void;
  onNavigate: (index: number) => void;
}) {
  const headingId = useId();
  const [selected, setSelected] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [failed, setFailed] = useState(false);
  const details = permissionDetails(event);
  const options = z
    .array(z.object({ optionId: z.string(), name: z.string() }))
    .parse(event.data.options);
  const busy = submitting || agent.sending;

  async function submit() {
    if (!selected || busy) return;
    setSubmitting(true);
    setFailed(false);
    try {
      const sent = await agent.send({
        kind: "permission",
        id: String(event.data.id),
        optionId: selected,
      });
      setFailed(!sent);
    } catch {
      setFailed(true);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="approval-card" aria-labelledby={headingId}>
      <button
        className="approval-dismiss"
        type="button"
        aria-label="Dismiss approval"
        onClick={onDismiss}
        disabled={busy}
      >
        <AppIcon icon={Cancel01Icon} size={14} />
      </button>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <div className="approval-body">
          <h3 id={headingId}>{String(details.title || "Allow this tool request?")}</h3>
          <details className="approval-details">
            <summary>View operation details</summary>
            <pre>{JSON.stringify(details.rawInput || {}, null, 2)}</pre>
          </details>
          <fieldset className="approval-options" disabled={busy}>
            <legend className="sr-only">Choose a response</legend>
            {options.map((option) => (
              <label className="approval-option" key={option.optionId}>
                <input
                  type="radio"
                  name={headingId}
                  value={option.optionId}
                  checked={selected === option.optionId}
                  onChange={() => setSelected(option.optionId)}
                />
                <span>{option.name}</span>
              </label>
            ))}
          </fieldset>
          {failed && (
            <p className="approval-error" role="alert">
              Could not send your response. Please try again.
            </p>
          )}
        </div>
        <div className="approval-footer">
          {count > 1 && (
            <div className="approval-navigation">
              <button
                type="button"
                aria-label="Previous approval"
                disabled={index === 0 || busy}
                onClick={() => onNavigate(index - 1)}
              >
                <AppIcon icon={ArrowDown01Icon} size={14} className="rotate-180" />
              </button>
              <button
                type="button"
                aria-label="Next approval"
                disabled={index === count - 1 || busy}
                onClick={() => onNavigate(index + 1)}
              >
                <AppIcon icon={ArrowDown01Icon} size={14} />
              </button>
            </div>
          )}
          <div className="approval-actions">
            <button className="approval-later" type="button" disabled={busy} onClick={onDismiss}>
              Skip
            </button>
            <button className="approval-submit" type="submit" disabled={!selected || busy}>
              {busy ? "Sending…" : "Send"}
            </button>
          </div>
        </div>
      </form>
    </section>
  );
}
