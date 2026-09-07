import { agentName } from "../../../bridge/agent-selection";
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
  }[] = [];
  const tools = new Map(toolCalls(events).map((call) => [call.eventId, call]));
  let response = "";
  let messageId: unknown;
  let responseTime: number | undefined;
  for (const event of events) {
    const tool = tools.get(event.id);
    const boundary =
      Boolean(tool) ||
      ["user", "complete", "error", "interrupted", "workspace_stopped", "restored"].includes(
        event.type,
      );
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
export function Conversation({
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
        message.tools ? (
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
            {message.role === "OpenCode" && agentKind !== "codex" && (
              <>
                {agentKind === "opencode" && (
                  <img className="task-assistant-avatar" src="/brand/opencode.svg" alt="" />
                )}
                <div className="task-assistant-meta">
                  <strong>{agentName(agentKind)}</strong>
                  {message.timestamp && (
                    <time
                      dateTime={new Date(message.timestamp).toISOString()}
                      title={new Date(message.timestamp).toLocaleString()}
                      suppressHydrationWarning
                    >
                      {new Date(message.timestamp).toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit",
                        hour12: false,
                      })}
                    </time>
                  )}
                </div>
              </>
            )}
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
}
