import { Streamdown } from "streamdown";
import { code } from "@streamdown/code";
import { z } from "zod";
import { ToolActivity } from "./task-tools";
import { toolCalls } from "./tool-activity";
import type { ToolCall } from "./tool-activity";
import type { Events } from "./task-types";

function conversation(events: Events) {
  const messages: {
    id: string;
    role: string;
    text: string;
    timestamp?: number;
    tool?: ToolCall;
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
    if (tool) messages.push({ id: tool.id, role: "", text: "", tool });
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
}: {
  events: Events;
  streaming?: boolean;
}) {
  return (
    <div className="task-messages">
      {conversation(events).map((message) =>
        message.tool ? (
          <ToolActivity key={message.id} call={message.tool} />
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
            aria-label={message.role}
          >
            {message.role === "OpenCode" && (
              <>
                <img className="task-assistant-avatar" src="/brand/opencode.svg" alt="" />
                <div className="task-assistant-meta">
                  <strong>OpenCode</strong>
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
    </div>
  );
}
