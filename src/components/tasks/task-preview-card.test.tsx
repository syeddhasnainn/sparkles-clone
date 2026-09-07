// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { Conversation } from "./task-conversation";
import { WorkspacePreviewContext } from "../workspace-views/workspace-preview-context";

afterEach(cleanup);

it("opens the preview panel from a saved conversation card without starting a new agent turn", () => {
  const open = vi.fn();
  render(
    <WorkspacePreviewContext value={open}>
      <Conversation
        events={[
          { id: 1, type: "user", data: { text: "Can I preview this app?" } },
          { id: 2, type: "preview", data: { title: "Sparkles dev server", port: 3000 } },
        ]}
      />
    </WorkspacePreviewContext>,
  );
  fireEvent.click(screen.getByRole("button", { name: "Open preview: Sparkles dev server" }));
  expect(open).toHaveBeenCalledTimes(1);
  expect(screen.getByText("localhost:3000")).toBeTruthy();
});

it("shows the most recently registered preview and ignores arbitrary URL fields", () => {
  render(
    <Conversation
      events={[
        { id: 1, type: "preview", data: { title: "Old server", port: 3000 } },
        {
          id: 2,
          type: "preview",
          data: { title: "Web app", port: 5173, url: "https://untrusted.example" },
        },
      ]}
    />,
  );
  expect(screen.queryByRole("button", { name: "Open preview: Old server" })).toBeNull();
  expect(screen.getByRole("button", { name: "Open preview: Web app" })).toBeTruthy();
  expect(screen.queryByRole("link")).toBeNull();
});
