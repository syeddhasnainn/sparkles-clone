import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { Conversation } from "./task-conversation";

it("shows the initial prompt while the sandbox is preparing without any agent events", () => {
  const html = renderToStaticMarkup(
    <Conversation
      events={[]}
      initialPrompt="What is this project?"
      preparationLabel="Preparing your workspace…"
    />,
  );
  expect(html).toContain("What is this project?");
  expect(html).toContain("Preparing your workspace…");
  expect(html).toContain('role="status"');
});

it("replaces the initial placeholder when the saved user message arrives", () => {
  const html = renderToStaticMarkup(
    <Conversation
      initialPrompt="What is this project?"
      events={[{ id: 1, type: "user", data: { text: "What is this project?" } }]}
    />,
  );
  expect(html.split("What is this project?")).toHaveLength(2);
  expect(html).not.toContain("Preparing your workspace");
});

it("hides the waiting loader once the current turn produces text", () => {
  const html = renderToStaticMarkup(
    <Conversation
      streaming
      events={[
        { id: 1, type: "user", data: { text: "Hello" } },
        {
          id: 2,
          type: "update",
          data: {
            sessionUpdate: "agent_message_chunk",
            content: { type: "text", text: "Checking the repository." },
          },
        },
      ]}
    />,
  );
  expect(html).not.toContain("Churning");
});

it("shows the loader for a new turn even when the previous turn has output", () => {
  const html = renderToStaticMarkup(
    <Conversation
      streaming
      events={[
        {
          id: 1,
          type: "update",
          data: {
            sessionUpdate: "agent_message_chunk",
            content: { type: "text", text: "Previous answer." },
          },
        },
        { id: 2, type: "user", data: { text: "Next question" } },
      ]}
    />,
  );
  expect(html).toContain("Churning");
});

it("hides the loader when a tool starts before any text", () => {
  const html = renderToStaticMarkup(
    <Conversation
      streaming
      events={[
        { id: 1, type: "user", data: { text: "Inspect the repository" } },
        {
          id: 2,
          type: "update",
          data: {
            sessionUpdate: "tool_call",
            toolCallId: "tool-1",
            title: "Read files",
            status: "in_progress",
          },
        },
      ]}
    />,
  );
  expect(html).not.toContain("Churning");
});
