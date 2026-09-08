import { agentName } from "../../../bridge/agent-selection";
import { memo, useContext } from "react";
import ViewIcon from "@hugeicons/core-free-icons/ViewIcon";
import ArrowRight01Icon from "@hugeicons/core-free-icons/ArrowRight01Icon";
import { AppIcon } from "../ui/app-icon";
import { WorkspacePreviewContext } from "../workspace-views/workspace-preview-context";
import { Streamdown } from "streamdown";
import { code } from "@streamdown/code";
import { z } from "zod";
import { LoadingState } from "./loading-state";
import { ToolTimeline } from "./task-tools";
import { toolCalls } from "./tool-activity";
import type { ToolCall } from "./tool-activity";
import type { Events } from "./task-types";

function conversation(events: Events) {
  const messages: {
    id: string;
    role: string;
    text: string;
    timestamp?: number;
    tools?: ToolCall[];
    preview?: { title: string; port: number };
  }[] = [];
  const tools = new Map(toolCalls(events).map((call) => [call.eventId, call]));
  let response = "";
  let messageId: unknown;
  let responseTime: number | undefined;
  const latestPreview = [...events].reverse().find((event) => event.type === "preview")?.id;
  for (const event of events) {
    const tool = tools.get(event.id);
    const boundary =
      Boolean(tool) ||
      [
        "user",
        "complete",
        "error",
        "interrupted",
        "workspace_stopped",
        "restored",
        "preview",
      ].includes(event.type);
    if (boundary && response) {
      messages.push({
        id: `${event.id}:assistant`,
        role: "OpenCode",
        text: response,
        timestamp: responseTime,
      });
      response = "";
      responseTime = undefined;
      messageId = undefined;
    }
    if (tool) {
      const previous = messages.at(-1);
      if (previous?.tools) previous.tools.push(tool);
      else messages.push({ id: tool.id, role: "", text: "", tools: [tool] });
    }
    if (event.type === "user")
      messages.push({ id: `${event.id}:user`, role: "You", text: String(event.data.text) });
    if (event.type === "preview" && event.id === latestPreview) {
      const preview = z
        .object({ title: z.string().min(1).max(100), port: z.number().int().min(1024).max(65535) })
        .safeParse(event.data);
      if (preview.success)
        messages.push({ id: `${event.id}:preview`, role: "", text: "", preview: preview.data });
    }
    if (event.type === "update" && event.data.sessionUpdate === "agent_message_chunk") {
      const content = z
        .object({ type: z.literal("text"), text: z.string() })
        .safeParse(event.data.content);
      if (content.success) {
        if (!response) responseTime = event.timestamp;
        if (response && messageId && event.data.messageId !== messageId) response += "\n\n";
        response += content.data.text;
        messageId = event.data.messageId;
      }
    }
    if (["error", "interrupted"].includes(event.type))
      messages.push({
        id: `${event.id}:system`,
        role: "Workspace",
        text: String(event.data.message),
      });
  }
  if (response)
    messages.push({
      id: "current-response",
      role: "OpenCode",
      text: response,
      timestamp: responseTime,
    });
  return messages;
}
export const Conversation = memo(function Conversation({
  events,
  streaming = false,
  agentKind = "opencode",
  initialPrompt,
  preparationLabel,
}: {
  events: Events;
  streaming?: boolean;
  agentKind?: "opencode" | "codex";
  initialPrompt?: string;
  preparationLabel?: string;
}) {
  const openPreview = useContext(WorkspacePreviewContext);
  const currentTurn = events.slice(
    events.reduce((last, event, index) => (event.type === "user" ? index : last), -1) + 1,
  );
  const hasStarted = currentTurn.some(
    (event) =>
      event.type === "permission" ||
      (event.type === "update" &&
        (event.data.sessionUpdate === "tool_call" ||
          event.data.sessionUpdate === "tool_call_update" ||
          (event.data.sessionUpdate === "agent_message_chunk" &&
            z.object({ text: z.string().min(1) }).safeParse(event.data.content).success))),
  );

  return (
    <div className="task-messages">
      {initialPrompt && !events.some((event) => event.type === "user") && (
        <article className="task-message-user" aria-label="You">
          <div className="task-message-text">{initialPrompt}</div>
        </article>
      )}
      {conversation(events).map((message) =>
        message.preview ? (
          <button
            key={message.id}
            className="task-preview-card"
            onClick={() => openPreview?.()}
            disabled={!openPreview}
            aria-label={`Open preview: ${message.preview.title}`}
          >
            <span className="task-preview-card-icon">
              <AppIcon icon={ViewIcon} size={18} />
            </span>
            <span className="task-preview-card-label">
              <strong>{message.preview.title}</strong>
              <span>localhost:{message.preview.port}</span>
            </span>
            <span className="task-preview-card-action">
              Open preview <AppIcon icon={ArrowRight01Icon} size={14} />
            </span>
          </button>
        ) : message.tools ? (
          <ToolTimeline key={message.id} calls={message.tools} />
        ) : (
          <article
            key={message.id}
            className={
              message.role === "You"
                ? "task-message-user"
                : message.role === "Workspace"
                  ? "task-message-system"
                  : "task-message-assistant"
            }
            data-agent={agentKind}
            aria-label={message.role === "OpenCode" ? agentName(agentKind) : message.role}
          >
            {message.role === "OpenCode" ? (
              <Streamdown
                className="task-message-markdown"
                plugins={{ code }}
                isAnimating={streaming && message.id === "current-response"}
                skipHtml
              >
                {message.text}
              </Streamdown>
            ) : (
              <div className="task-message-text">{message.text}</div>
            )}
          </article>
        ),
      )}
      {(preparationLabel || streaming) && !hasStarted && <LoadingState label={preparationLabel} />}
    </div>
  );
});
