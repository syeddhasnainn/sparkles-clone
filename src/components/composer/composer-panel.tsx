import { PermissionPicker } from "./permission-picker";
import { permissionModeOptions } from "../../../bridge/permission-modes";
import type { PermissionMode, PermissionModes } from "../../../bridge/permission-modes";
import { ReasoningPicker } from "./reasoning-picker";
import { AgentPicker } from "./agent-picker";
import type { AgentSelection } from "../../../bridge/agent-selection";
import { AppIcon } from "../ui/app-icon";
import { useId, useRef, useState, type ReactNode } from "react";
import ArrowUp from "@hugeicons/core-free-icons/ArrowUp02Icon";
import Circle from "@hugeicons/core-free-icons/CircleIcon";
import FileCode from "@hugeicons/core-free-icons/DocumentCodeIcon";
import FileText from "@hugeicons/core-free-icons/File01Icon";
import Folder from "@hugeicons/core-free-icons/Folder01Icon";
import WorkflowCircle04Icon from "@hugeicons/core-free-icons/WorkflowCircle04Icon";
import Image from "@hugeicons/core-free-icons/Image01Icon";
import ListChecks from "@hugeicons/core-free-icons/Task01Icon";
import Plus from "@hugeicons/core-free-icons/Add01Icon";
import Presentation from "@hugeicons/core-free-icons/Presentation01Icon";
import Sheet from "@hugeicons/core-free-icons/Table01Icon";
import Square from "@hugeicons/core-free-icons/StopIcon";
import Target from "@hugeicons/core-free-icons/Target01Icon";
import { AttachmentTile } from "../composer-parts";
import { ComposerMenu } from "./composer-menu";

interface ComposerPanelProps {
  selection?: AgentSelection;
  permissionModes?: PermissionModes;
  onPermissionModeChange?: (modeId: PermissionMode) => Promise<boolean>;
  permissionModeDisabled?: boolean;
  permissionModeUnavailableReason?: string;
  onSelectionChange?: (selection: AgentSelection) => void;
  chatGPTConnected?: boolean;
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  label: string;
  sendLabel: string;
  sendDisabled: boolean;
  busy?: boolean;
  running?: boolean;
  onStop?: () => void;
  branch?: string;
  repository?: string;
  repositoryPicker?: ReactNode;
}

const attachmentKinds = [
  {
    label: "Documents",
    description: "Add documents",
    icon: FileText,
    accept: ".pdf,.doc,.docx,.txt,.md",
    color: "blue",
  },
  {
    label: "Spreadsheets",
    description: "Add spreadsheets",
    icon: Sheet,
    accept: ".csv,.xls,.xlsx",
    color: "green",
  },
  {
    label: "Presentations",
    description: "Add presentations",
    icon: Presentation,
    accept: ".ppt,.pptx,.key",
    color: "orange",
  },
  {
    label: "Code blocks",
    description: "Add code files",
    icon: FileCode,
    accept: ".js,.ts,.tsx,.jsx,.py,.json,.html,.css",
    color: "purple",
  },
];

export function ComposerPanel({
  selection,
  permissionModes,
  onPermissionModeChange,
  permissionModeDisabled,
  permissionModeUnavailableReason,
  onSelectionChange,
  chatGPTConnected,
  value,
  onChange,
  onSubmit,
  label,
  sendLabel,
  sendDisabled,
  busy = false,
  running = false,
  onStop,
  branch,
  repository,
  repositoryPicker,
}: ComposerPanelProps) {
  const [attachments, setAttachments] = useState<{ id: string; file: File }[]>([]);
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const noticeId = useId();
  const addFiles = (files: File[]) =>
    setAttachments((previous) => [
      ...previous,
      ...files.map((file) => ({ id: crypto.randomUUID(), file })),
    ]);
  const pickFiles = (accept = "") => {
    if (!fileInput.current) return;
    fileInput.current.accept = accept;
    fileInput.current.click();
  };

  return (
    <div className="composer-panel">
      <form
        className="composer-surface"
        aria-label={label}
        data-dragging={dragging || undefined}
        onSubmit={(event) => {
          event.preventDefault();
          if (!sendDisabled && !attachments.length && !busy && !running) onSubmit();
        }}
        onDragOver={(event) => {
          if (event.dataTransfer.types.includes("Files")) {
            event.preventDefault();
            setDragging(true);
          }
        }}
        onDragLeave={(event) => {
          if (
            !(
              event.relatedTarget instanceof Node &&
              event.currentTarget.contains(event.relatedTarget)
            )
          )
            setDragging(false);
        }}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          if (!busy) addFiles(Array.from(event.dataTransfer.files));
        }}
      >
        {attachments.length > 0 && (
          <div className="attachments">
            {attachments.map(({ id, file }) => (
              <AttachmentTile
                key={id}
                file={file}
                disabled={busy}
                onRemove={() => setAttachments((files) => files.filter((file) => file.id !== id))}
              />
            ))}
          </div>
        )}
        <textarea
          rows={1}
          aria-label={label}
          aria-describedby={attachments.length ? noticeId : undefined}
          placeholder="Hi, what do you need today?"
          value={value}
          disabled={busy}
          onChange={(event) => onChange(event.target.value)}
          onPaste={(event) => {
            const files = Array.from(event.clipboardData.files);
            if (files.length) {
              event.preventDefault();
              addFiles(files);
            }
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              event.currentTarget.form?.requestSubmit();
            }
          }}
        />
        <input
          ref={fileInput}
          type="file"
          multiple
          hidden
          disabled={busy}
          onChange={(event) => {
            addFiles(Array.from(event.target.files ?? []));
            event.target.value = "";
          }}
        />
        <div className="composer-toolbar">
          <div className="composer-options">
            <ComposerMenu
              label="Add to chat"
              className="composer-circle attach-button"
              trigger={<AppIcon icon={Plus} size={16} />}
            >
              <button
                className="composer-menu-item"
                type="button"
                disabled={busy}
                onClick={() => pickFiles()}
              >
                <AppIcon icon={Folder} size={20} />
                <span>Files and folders</span>
              </button>
              <button
                className="composer-menu-item"
                type="button"
                disabled={busy}
                onClick={() => pickFiles("image/*")}
              >
                <AppIcon icon={Image} size={20} />
                <span>Images</span>
              </button>
              <button className="composer-menu-item" type="button" disabled>
                <AppIcon icon={Target} size={20} />
                <span>
                  Goal<small>Goal mode is not available yet</small>
                </span>
              </button>
              <button className="composer-menu-item" type="button" disabled>
                <AppIcon icon={ListChecks} size={20} />
                <span>
                  Plan mode<small>Plan mode is not available yet</small>
                </span>
              </button>
              <div className="composer-menu-heading">File types</div>
              {attachmentKinds.map(({ label: name, description, icon: Icon, accept, color }) => (
                <button
                  key={name}
                  className="composer-menu-item"
                  type="button"
                  disabled={busy}
                  onClick={() => pickFiles(accept)}
                >
                  <AppIcon icon={Icon} size={24} className={`file-icon-${color}`} />
                  <span>
                    {name}
                    <small>{description}</small>
                  </span>
                </button>
              ))}
            </ComposerMenu>
            <ComposerPermissions
              selection={selection}
              permissionModes={permissionModes}
              onPermissionModeChange={onPermissionModeChange}
              onSelectionChange={onSelectionChange}
              busy={busy}
              permissionModeDisabled={permissionModeDisabled}
              permissionModeUnavailableReason={permissionModeUnavailableReason}
              running={running}
            />
          </div>
          <div className="composer-actions">
            <AgentPicker
              selection={selection}
              onChange={onSelectionChange}
              connected={chatGPTConnected}
              disabled={busy}
            />
            <ReasoningPicker selection={selection} onChange={onSelectionChange} disabled={busy} />
            {running ? (
              <button
                className="send-button"
                type="button"
                aria-label="Stop response"
                disabled={busy || !onStop}
                onClick={onStop}
              >
                <AppIcon icon={Square} size={16} fill="currentColor" />
              </button>
            ) : (
              <button
                className="send-button"
                type="submit"
                aria-label={sendLabel}
                disabled={sendDisabled || busy || attachments.length > 0}
              >
                <AppIcon icon={ArrowUp} size={16} />
              </button>
            )}
          </div>
        </div>
      </form>
      <div className="composer-context">
        <span
          className="composer-branch"
          title={branch || "Choose a repository to select a branch"}
        >
          <AppIcon icon={WorkflowCircle04Icon} size={16} />
          <span>{branch || "Branch"}</span>
        </span>
        <div className="composer-repository">
          {repositoryPicker || (
            <span title={repository}>
              <AppIcon icon={Folder} size={16} />
              <span>{repository || "Workspace"}</span>
            </span>
          )}
        </div>
        <ComposerMenu
          label="Context usage"
          className="composer-usage"
          trigger={
            <>
              <AppIcon icon={Circle} size={16} />
              <span>—</span>
            </>
          }
        >
          <p className="composer-menu-note">Context usage is not reported by this agent yet.</p>
        </ComposerMenu>
      </div>
      {attachments.length > 0 && (
        <p className="composer-file-notice" id={noticeId} role="status">
          Files are previewed locally. Uploads are not connected yet; remove attachments to send.
        </p>
      )}
    </div>
  );
}

function ComposerPermissions({
  selection,
  permissionModes,
  onPermissionModeChange,
  onSelectionChange,
  busy,
  permissionModeDisabled,
  permissionModeUnavailableReason,
  running,
}: Pick<
  ComposerPanelProps,
  | "selection"
  | "permissionModes"
  | "onPermissionModeChange"
  | "onSelectionChange"
  | "busy"
  | "permissionModeDisabled"
  | "permissionModeUnavailableReason"
  | "running"
>) {
  return (
    <PermissionPicker
      agent={selection?.agent}
      modes={
        permissionModes ??
        (onSelectionChange && selection?.provider === "chatgpt" && selection.agent === "codex"
          ? {
              currentModeId: selection.permissionMode ?? "read-only",
              availableModes: permissionModeOptions,
            }
          : undefined)
      }
      onChange={
        onPermissionModeChange ??
        (onSelectionChange && selection?.provider === "chatgpt" && selection.agent === "codex"
          ? (permissionMode) => {
              onSelectionChange({ ...selection, permissionMode });
              return true;
            }
          : undefined)
      }
      disabled={busy || permissionModeDisabled}
      unavailableReason={permissionModeUnavailableReason}
      running={running}
    />
  );
}
