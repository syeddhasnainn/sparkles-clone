import { useRef, useState } from "react";
import ComputerIcon from "@hugeicons/core-free-icons/ComputerIcon";
import ViewIcon from "@hugeicons/core-free-icons/ViewIcon";
import RefreshIcon from "@hugeicons/core-free-icons/RefreshIcon";
import Link01Icon from "@hugeicons/core-free-icons/Link01Icon";
import ArrowUpRight01Icon from "@hugeicons/core-free-icons/ArrowUpRight01Icon";
import SmartPhone01Icon from "@hugeicons/core-free-icons/SmartPhone01Icon";
import Maximize01Icon from "@hugeicons/core-free-icons/Maximize01Icon";
import { AppIcon } from "../ui/app-icon";
import { useWorkspaceService } from "./use-workspace-service";

export function WorkspaceLiveView({
  taskId,
  service,
}: {
  taskId: string;
  service: "preview" | "desktop";
}) {
  const [command, setCommand] = useState<string | null>(null);
  const [port, setPort] = useState<string | null>(null);
  const [path, setPath] = useState("/");
  const [mobile, setMobile] = useState(false);
  const [copied, setCopied] = useState(false);
  const frame = useRef<HTMLIFrameElement>(null);
  const { services, error, setError, connection, pending, status, connect, run } =
    useWorkspaceService(taskId, service, path);
  const openUrl = `/api/workspaces/${taskId}/open/${service}?path=${encodeURIComponent(path)}`;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(new URL(openUrl, window.location.origin).href);
      setCopied(true);
    } catch {
      setError("Could not copy the link. Use Open in new tab instead.");
    }
  };
  return (
    <div className="workspace-live-view">
      <div className="workspace-panel-toolbar">
        {service === "preview" ? (
          <>
            <button
              className="icon-button"
              aria-label="Toggle mobile preview"
              aria-pressed={mobile}
              onClick={() => setMobile((value) => !value)}
            >
              <AppIcon icon={SmartPhone01Icon} size={16} />
            </button>
            <form
              className="workspace-preview-address"
              onSubmit={(event) => {
                event.preventDefault();
                void connect();
              }}
            >
              <input
                aria-label="Preview path"
                value={path}
                onChange={(event) => setPath(event.target.value)}
                spellCheck={false}
              />
            </form>
          </>
        ) : (
          <span className="workspace-toolbar-title">Sandbox desktop</span>
        )}
        <button
          className="icon-button"
          aria-label={service === "desktop" ? "Reconnect desktop" : "Reload preview"}
          onClick={() => void connect()}
          disabled={status !== "ready"}
        >
          <AppIcon icon={RefreshIcon} size={16} />
        </button>
        <button
          className="icon-button"
          aria-label={copied ? "Link copied" : "Copy view link"}
          onClick={() => void copy()}
          disabled={status !== "ready"}
        >
          <AppIcon icon={Link01Icon} size={16} />
        </button>
        {status === "ready" && (
          <a
            className="icon-button"
            href={openUrl}
            target="_blank"
            rel="noreferrer"
            aria-label="Open view in new tab"
          >
            <AppIcon icon={ArrowUpRight01Icon} size={16} />
          </a>
        )}
        {service === "desktop" && (
          <button
            className="icon-button"
            aria-label="Fullscreen desktop"
            disabled={!connection}
            onClick={() => {
              void frame.current
                ?.requestFullscreen()
                .catch(() => setError("Fullscreen is unavailable in this browser."));
            }}
          >
            <AppIcon icon={Maximize01Icon} size={16} />
          </button>
        )}
      </div>
      {error && (
        <p className="workspace-view-error" role="alert">
          {error}
        </p>
      )}
      {copied && (
        <span className="workspace-copy-status" role="status">
          Link copied. Access requires your account.
        </span>
      )}
      {service === "preview" && status === "ready" && (
        <div className="workspace-preview-link">
          <a href={openUrl} target="_blank" rel="noreferrer">
            <span>{connection ? new URL(connection.url).origin + path : "Open preview URL"}</span>{" "}
            <AppIcon icon={ArrowUpRight01Icon} size={12} />
          </a>
          <button disabled={pending} onClick={() => void run({ kind: "preview-stop" })}>
            {services?.preview.managed ? "Stop preview" : "Disconnect preview"}
          </button>
        </div>
      )}
      {connection && status === "ready" ? (
        <div
          className={`workspace-live-frame ${mobile && service === "preview" ? "is-mobile" : ""}`}
        >
          <iframe
            ref={frame}
            src={connection.url}
            title={service === "desktop" ? "Interactive sandbox desktop" : "Application preview"}
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-downloads"
            allow="fullscreen; clipboard-read; clipboard-write"
            referrerPolicy="no-referrer"
          />
        </div>
      ) : (
        <div className="workspace-view-empty">
          <AppIcon icon={service === "desktop" ? ComputerIcon : ViewIcon} size={30} />
          <h3>
            {status === "starting"
              ? `Starting ${service}…`
              : service === "desktop"
                ? "Sandbox desktop"
                : "Preview"}
          </h3>
          <p>
            {service === "desktop"
              ? "Open a Linux desktop with Chromium in this workspace."
              : "Run your project and view it here as you build."}
          </p>
          {service === "preview" && (
            <form
              className="workspace-preview-start"
              onSubmit={(event) => {
                event.preventDefault();
                void run({
                  kind: "preview-start",
                  command: command ?? services?.preview.command ?? "",
                  port: Number(port ?? services?.preview.port ?? 3000),
                });
              }}
            >
              <label>
                Start command
                <input
                  aria-label="Preview start command"
                  value={command ?? services?.preview.command ?? ""}
                  onChange={(event) => setCommand(event.target.value)}
                  placeholder="npm run dev"
                  disabled={status === "starting"}
                />
              </label>
              <label>
                Port
                <input
                  aria-label="Preview port"
                  inputMode="numeric"
                  value={port ?? services?.preview.port ?? 3000}
                  onChange={(event) => setPort(event.target.value)}
                  disabled={status === "starting"}
                />
              </label>
              <button
                className="workspace-primary-button"
                type="submit"
                disabled={pending || !services || status === "starting"}
              >
                {status === "starting" ? "Starting…" : "Start preview"}
              </button>
              {status === "starting" && (
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => void run({ kind: "preview-stop" })}
                >
                  Stop
                </button>
              )}
            </form>
          )}
          {service === "desktop" && (
            <button
              className="workspace-primary-button"
              disabled={pending || !services || status === "starting"}
              onClick={() => void run({ kind: "desktop-start" })}
            >
              {status === "starting" ? "Opening desktop…" : "Open desktop"}
            </button>
          )}
        </div>
      )}
      {services?.[service].log && (
        <details className="workspace-service-log" open={status === "failed"}>
          <summary>{service === "desktop" ? "Desktop logs" : "Development server logs"}</summary>
          <pre>{services[service].log}</pre>
        </details>
      )}
    </div>
  );
}
