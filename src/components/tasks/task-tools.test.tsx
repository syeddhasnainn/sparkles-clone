// @vitest-environment jsdom
import { afterEach, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ToolTimeline } from "./task-tools";
import type { ToolCall } from "./tool-activity";

afterEach(cleanup);

const call: ToolCall = {
  id: "call-a",
  eventId: 1,
  title: "Verify build",
  kind: "execute",
  status: "completed",
  paths: [],
  input: { command: "pnpm build" },
  output: "Build succeeded",
};

it("expands tools independently when their titles match", () => {
  render(<ToolTimeline calls={[call, { ...call, id: "call-b", eventId: 2 }]} />);
  expect(screen.queryByText("Build succeeded")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Ran commands" }));
  const rows = screen.getAllByRole("button", { name: /Ran pnpm build Completed/ });
  expect(rows[0].getAttribute("aria-expanded")).toBe("false");
  fireEvent.click(rows[0]);
  expect(rows[0].getAttribute("aria-expanded")).toBe("true");
  expect(rows[1].getAttribute("aria-expanded")).toBe("false");
  expect(screen.getAllByText("Build succeeded")).toHaveLength(1);
});

it("keeps failures visible in the collapsed summary", () => {
  render(
    <ToolTimeline
      calls={[
        { ...call, kind: "edit", paths: ["src/app.tsx"] },
        { ...call, id: "failed", kind: "execute", status: "failed" },
      ]}
    />,
  );
  const heading = screen.getByRole("button", {
    name: "Edited files, ran commands, 1 needs attention",
  });
  expect(heading.getAttribute("aria-expanded")).toBe("false");
});

it("keeps collapsed groups out of keyboard navigation", () => {
  render(<ToolTimeline calls={[call]} />);
  const heading = screen.getByRole("button", { name: "Ran commands" });
  expect(heading.getAttribute("aria-expanded")).toBe("false");
  const panel = document.getElementById(heading.getAttribute("aria-controls")!);
  expect(panel?.hasAttribute("inert")).toBe(true);
});
