import { useRef, useState } from "react";
import { X } from "lucide-react";
import { DashboardIcon } from "./dashboard-icon";
import { RepositoryPicker } from "./repository-picker";
import { AgentPicker } from "./agent-picker";
import type { GitHubRepository } from "@/lib/github/functions";

export function TaskComposer() {
  const [task, setTask] = useState("");
  const [attachments, setAttachments] = useState<File[]>([]);
  const [repository, setRepository] = useState<GitHubRepository | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  return (
    <div className="composer-wrapper">
      <div className="composer-intro">
        <h1>What would you like to build?</h1>
        <p>Describe the outcome, choose your repositories, and start the agent.</p>
      </div>
      <form
        className="composer-surface"
        aria-label="Message composer"
        onSubmit={(e) => {
          e.preventDefault();
        }}
      >
        <textarea
          aria-label="Describe the task"
          placeholder="e.g. Add keyboard shortcuts to the dashboard"
          value={task}
          onChange={(e) => {
            setTask(e.target.value);
          }}
        />
        {attachments.length > 0 && (
          <div className="attachments">
            {attachments.map((file, index) => (
              <span key={`${file.name}-${index}`} className="attachment">
                {file.name}
                <button
                  type="button"
                  aria-label={`Remove ${file.name}`}
                  onClick={() => setAttachments((files) => files.filter((_, i) => i !== index))}
                >
                  <X size={12} />
                </button>
              </span>
            ))}
          </div>
        )}
        <div className="composer-toolbar">
          <div className="composer-options">
            <RepositoryPicker selected={repository} onSelect={setRepository} />
            <AgentPicker />
          </div>
          <div className="composer-actions">
            <input
              ref={fileInput}
              type="file"
              multiple
              hidden
              onChange={(e) => {
                setAttachments((files) => [...files, ...Array.from(e.target.files ?? [])]);
                e.target.value = "";
              }}
            />
            <button
              type="button"
              className="icon-button attach-button"
              aria-label="Attach file"
              onClick={() => fileInput.current?.click()}
            >
              <DashboardIcon name="attach" />
            </button>
            <button
              className="send-button"
              aria-label="Start agent"
              disabled
              title="Agent execution is not available yet"
            >
              <DashboardIcon name="send" size={18} />
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
