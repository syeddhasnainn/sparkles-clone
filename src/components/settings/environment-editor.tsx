import { useEffect, useRef, useState, type ClipboardEvent } from "react";
import AddIcon from "@hugeicons/core-free-icons/Add01Icon";
import DeleteIcon from "@hugeicons/core-free-icons/Delete02Icon";
import ViewIcon from "@hugeicons/core-free-icons/ViewIcon";
import ViewOffIcon from "@hugeicons/core-free-icons/ViewOffIcon";
import { AppIcon } from "../ui/app-icon";
import { Button } from "../ui/button";
import {
  environmentVariablesSchema,
  type EnvironmentVariable,
} from "../../../bridge/project-environment";
import type { Repository } from "../../../bridge/contracts";
import { getProjectEnvironment, saveProjectEnvironment } from "@/lib/projects/functions";
import { parseEnvironmentFile } from "@/lib/projects/dotenv";

type VariableRow = EnvironmentVariable & { id: string; revealed: boolean };
const row = (variable: EnvironmentVariable = { name: "", value: "" }): VariableRow => ({
  ...variable,
  id: crypto.randomUUID(),
  revealed: false,
});

export function EnvironmentEditor({ repository }: { repository: Repository }) {
  const [rows, setRows] = useState<VariableRow[]>([]);
  const revision = useRef(0);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { id, installationId, name, defaultBranch } = repository;

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError(false);
    void getProjectEnvironment({
      data: { repository: { id, installationId, name, defaultBranch } },
    })
      .then((result) => {
        if (cancelled) return;
        setRows(result.variables.length ? result.variables.map(row) : [row()]);
        revision.current = result.revision;
      })
      .catch(() => {
        if (!cancelled) setLoadError(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [id, installationId, name, defaultBranch, attempt]);

  const update = (id: string, changes: Partial<VariableRow>) => {
    setRows((current) => current.map((item) => (item.id === id ? { ...item, ...changes } : item)));
    setMessage(null);
    setError(null);
  };
  const paste = (event: ClipboardEvent<HTMLInputElement>, id: string) => {
    const text = event.clipboardData.getData("text");
    if (!text.includes("=")) return;
    event.preventDefault();
    try {
      const imported = parseEnvironmentFile(text);
      setRows((current) => {
        const remaining = current.filter(
          (item) => item.id !== id || item.name.trim() || item.value,
        );
        const merged = new Map(
          remaining.flatMap((item) =>
            item.name.trim() || item.value ? [[item.name, item] as const] : [],
          ),
        );
        for (const variable of imported) merged.set(variable.name, row(variable));
        return [...merged.values()];
      });
      setError(null);
      setMessage(
        `${imported.length} variable${imported.length === 1 ? "" : "s"} imported. Save changes to apply them.`,
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not import variables.");
    }
  };
  const save = async () => {
    const variables = environmentVariablesSchema.safeParse(
      rows.flatMap(({ name, value }) => (name.trim() || value ? [{ name, value }] : [])),
    );
    if (!variables.success) {
      setError(variables.error.issues[0].message);
      return;
    }
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const saved = await saveProjectEnvironment({
        data: { repository, variables: variables.data, revision: revision.current },
      });
      revision.current = saved.revision;
      setRows(variables.data.length ? variables.data.map(row) : [row()]);
      setMessage("Saved. New and resumed workspaces will use these values.");
      window.dispatchEvent(new Event("sparkles:projects-changed"));
    } catch (caught) {
      setError(
        caught instanceof Error && caught.message.includes("another tab")
          ? caught.message
          : "Could not save variables. Try again.",
      );
    } finally {
      setSaving(false);
    }
  };

  if (loading)
    return (
      <p role="status" className="project-environment-note">
        Loading environment variables…
      </p>
    );
  if (loadError)
    return (
      <div className="project-environment-note" role="alert">
        Could not load variables. Check your GitHub access and try again.{" "}
        <Button variant="ghost" size="sm" onClick={() => setAttempt((value) => value + 1)}>
          Retry
        </Button>
      </div>
    );

  return (
    <form
      className="project-environment"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <div className="project-environment-heading">
        <h3>Environment variables</h3>
        <p>
          Available to the agent and applications in every new or resumed sandbox for this project.
        </p>
      </div>
      <fieldset disabled={saving} className="project-variable-list">
        <legend className="sr-only">Environment variables</legend>
        {rows.map((item, index) => (
          <div className="project-variable-row" key={item.id}>
            <input
              aria-label={`Variable name ${index + 1}`}
              placeholder="VARIABLE_NAME"
              autoComplete="off"
              spellCheck={false}
              value={item.name}
              onChange={(event) => update(item.id, { name: event.target.value })}
              onPaste={(event) => paste(event, item.id)}
            />
            <div className="project-variable-value">
              <input
                aria-label={`Variable value ${index + 1}`}
                type={item.revealed ? "text" : "password"}
                placeholder="value"
                autoComplete="off"
                spellCheck={false}
                value={item.value}
                onChange={(event) => update(item.id, { value: event.target.value })}
              />
              <button
                type="button"
                aria-label={`${item.revealed ? "Hide" : "Show"} variable value ${index + 1}`}
                aria-pressed={item.revealed}
                onClick={() => update(item.id, { revealed: !item.revealed })}
              >
                <AppIcon icon={item.revealed ? ViewOffIcon : ViewIcon} size={16} />
              </button>
            </div>
            <button
              className="project-variable-remove"
              type="button"
              aria-label={`Remove environment variable ${index + 1}`}
              onClick={() => {
                setRows((current) => current.filter((value) => value.id !== item.id));
                setMessage(null);
              }}
            >
              <AppIcon icon={DeleteIcon} size={16} />
            </button>
          </div>
        ))}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={rows.length >= 50}
          onClick={() => {
            setRows((current) => [...current, row()]);
            setMessage(null);
          }}
        >
          <AppIcon icon={AddIcon} size={14} />
          Add variable
        </Button>
      </fieldset>
      <div className="project-environment-footer">
        <p>
          Paste a .env file into a name field to import variables. Changes apply on the next
          workspace start.
        </p>
        <Button type="submit" disabled={saving}>
          {saving ? "Saving…" : "Save changes"}
        </Button>
      </div>
      {error && (
        <p className="project-environment-feedback text-destructive" role="alert">
          {error}
        </p>
      )}
      {message && (
        <p className="project-environment-feedback" role="status">
          {message}
        </p>
      )}
    </form>
  );
}
