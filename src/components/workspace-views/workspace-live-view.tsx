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
import type { requestView } from "./view-client";

type AgentPreviewControls = {
  onStartPreview: () => Promise<boolean>;
  canStartPreview: boolean;
  agentWorking: boolean;
};

export function WorkspaceLiveView({
  taskId,
  service,
  autoStartDesktop = false,
  onStartPreview,
  canStartPreview,
  agentWorking,
  request,
}: AgentPreviewControls & {
  taskId: string;
  service: "preview" | "desktop";
  autoStartDesktop?: boolean;
  request: typeof requestView;
}) {
  const [path, setPath] = useState("/");
  const [mobile, setMobile] = useState(false);
  const [copied, setCopied] = useState(false);
  const frame = useRef<HTMLIFrameElement>(null);
  const { services, error, setError, connection, pending, status, connect, run } =
    useWorkspaceService(taskId, service, path, request, autoStartDesktop);
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
      <LiveViewToolbar
        service={service}
        mobile={mobile}
        onToggleMobile={() => setMobile((value) => !value)}
        path={path}
        onPathChange={setPath}
        connect={connect}
        status={status}
        copied={copied}
        copy={copy}
        openUrl={openUrl}
        connection={connection}
        onFullscreen={() => {
          void frame.current
            ?.requestFullscreen()
            .catch(() => setError("Fullscreen is unavailable in this browser."));
        }}
      />
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
            // Modal URLs are checked against the parent origin before use. Cookies and modules require same-origin within that isolated origin.
            // react-doctor-disable-next-line react-doctor/iframe-missing-sandbox
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-downloads"
            allow="fullscreen; clipboard-read; clipboard-write"
            referrerPolicy="no-referrer"
          />
        </div>
      ) : error && !services ? (
        <div className="workspace-view-empty">
          <AppIcon icon={service === "preview" ? ViewIcon : ComputerIcon} size={30} />
          <h3>{service === "preview" ? "Preview unavailable" : "Desktop unavailable"}</h3>
          <p>Retrying the workspace connection automatically.</p>
        </div>
      ) : (
        <ServiceStart
          service={service}
          services={services}
          status={status}
          pending={pending}
          run={run}
          onStartPreview={onStartPreview}
          canStartPreview={canStartPreview}
          agentWorking={agentWorking}
        />
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

function PreviewStart({
  services,
  status,
  pending,
  run,
}: Pick<ReturnType<typeof useWorkspaceService>, "services" | "status" | "pending" | "run">) {
  const [command, setCommand] = useState<string | null>(null);
  const [port, setPort] = useState<string | null>(null);
  return (
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
        <button type="button" disabled={pending} onClick={() => void run({ kind: "preview-stop" })}>
          Stop
        </button>
      )}
    </form>
  );
}

function LiveViewToolbar({
  service,
  mobile,
  onToggleMobile,
  path,
  onPathChange,
  connect,
  status,
  copied,
  copy,
  openUrl,
  connection,
  onFullscreen,
}: {
  service: "preview" | "desktop";
  mobile: boolean;
  onToggleMobile: () => void;
  path: string;
  onPathChange: (value: string) => void;
  connect: () => Promise<void>;
  status: ReturnType<typeof useWorkspaceService>["status"];
  copied: boolean;
  copy: () => Promise<void>;
  openUrl: string;
  connection: ReturnType<typeof useWorkspaceService>["connection"];
  onFullscreen: () => void;
}) {
  return (
    <div className="workspace-panel-toolbar">
      {service === "preview" ? (
        <>
          <button
            className="icon-button"
            aria-label="Toggle mobile preview"
            aria-pressed={mobile}
            onClick={onToggleMobile}
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
              onChange={(event) => onPathChange(event.target.value)}
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
          onClick={onFullscreen}
        >
          <AppIcon icon={Maximize01Icon} size={16} />
        </button>
      )}
    </div>
  );
}

function ServiceStart({
  service,
  services,
  status,
  pending,
  run,
  ...agentPreview
}: AgentPreviewControls & { service: "preview" | "desktop" } & Pick<
    ReturnType<typeof useWorkspaceService>,
    "services" | "status" | "pending" | "run"
  >) {
  if (service === "preview")
    return (
      <PreviewStatus
        services={services}
        status={status}
        pending={pending}
        run={run}
        {...agentPreview}
      />
    );
  return (
    <div className="workspace-view-empty">
      <AppIcon icon={ComputerIcon} size={30} />
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
      {service === "desktop" && (
        <button
          className="workspace-primary-button"
          disabled={pending || !services || status === "starting"}
          onClick={() => void run({ kind: "desktop-start" })}
        >
          {status === "starting" ? "Opening desktop…" : "Start desktop"}
        </button>
      )}
    </div>
  );
}

function PreviewStatus({
  services,
  status,
  pending,
  run,
  onStartPreview,
  canStartPreview,
  agentWorking,
}: AgentPreviewControls &
  Pick<ReturnType<typeof useWorkspaceService>, "services" | "status" | "pending" | "run">) {
  const starting = !services || status === "starting" || status === "ready";
  const failed = status === "failed";
  const [submitting, setSubmitting] = useState(false);
  const [requestError, setRequestError] = useState(false);
  const start = async () => {
    setSubmitting(true);
    setRequestError(false);
    try {
      setRequestError(!(await onStartPreview()));
    } catch {
      setRequestError(true);
    } finally {
      setSubmitting(false);
    }
  };
  const message = agentWorking
    ? {
        title: "Agent is working",
        description:
          "Follow progress in the conversation. Preview will connect when the app is ready.",
      }
    : previewMessage(starting, failed);
  return (
    <div className="workspace-view-empty">
      <AppIcon icon={ViewIcon} size={30} />
      <h3>{message.title}</h3>
      <p>{message.description}</p>
      {starting && (
        <button disabled={pending || !services} onClick={() => void run({ kind: "preview-stop" })}>
          Stop preview
        </button>
      )}
      {services && status !== "ready" && (
        <>
          <button
            className="workspace-primary-button"
            disabled={pending || submitting || !canStartPreview}
            onClick={() => void start()}
          >
            {submitting
              ? "Asking agent…"
              : agentWorking
                ? "Agent is working…"
                : failed || status === "starting"
                  ? "Fix with agent"
                  : "Start preview"}
          </button>
          {requestError && <p role="alert">Could not ask the agent. Please try again.</p>}
          <details className="workspace-preview-settings">
            <summary>Preview settings</summary>
            <PreviewStart services={services} status={status} pending={pending} run={run} />
          </details>
        </>
      )}
    </div>
  );
}

function previewMessage(starting: boolean, failed: boolean) {
  if (starting)
    return {
      title: "Starting preview…",
      description:
        "Waiting for your app to respond. Progress appears in the conversation and logs.",
    };
  if (failed)
    return {
      title: "Preview couldn’t start",
      description: "Ask the agent to diagnose the logs and get your app running.",
    };
  return {
    title: "Run your app",
    description:
      "The agent will set up the project, resolve startup errors, and start your preview.",
  };
}
