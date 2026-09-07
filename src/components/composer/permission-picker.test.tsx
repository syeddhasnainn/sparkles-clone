// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { PermissionPicker } from "./permission-picker";
import { permissionModeOptions } from "../../../bridge/permission-modes";
import { ComposerPanel } from "./composer-panel";

afterEach(cleanup);
const modes = { currentModeId: "read-only" as const, availableModes: permissionModeOptions };

it("sends the chosen native mode and waits for confirmation before closing", async () => {
  let finish: (value: boolean) => void = () => {};
  const onChange = vi.fn(
    () =>
      new Promise<boolean>((resolve) => {
        finish = resolve;
      }),
  );
  render(<PermissionPicker agent="codex" modes={modes} onChange={onChange} running />);
  fireEvent.click(screen.getByRole("button", { name: "Permissions" }));
  expect(await screen.findByText(/Changes apply to the next turn/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: /Auto: Codex reviews/ }));
  expect(onChange).toHaveBeenCalledWith("agent");
  expect(
    screen.getByRole("button", { name: /Full access: Run commands/ }).hasAttribute("disabled"),
  ).toBe(true);
  expect(screen.getByText("Updating…")).toBeTruthy();
  finish(true);
  await waitFor(() =>
    expect(screen.queryByRole("button", { name: /Auto: Codex reviews/ })).toBeNull(),
  );
});

it("does not display an unconfirmed mode when the request fails", async () => {
  render(<PermissionPicker agent="codex" modes={modes} onChange={async () => false} />);
  fireEvent.click(screen.getByRole("button", { name: "Permissions" }));
  fireEvent.click(await screen.findByRole("button", { name: /Full access: Run commands/ }));
  expect(await screen.findByRole("alert")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Permissions" }).textContent).toContain("Standard");
  expect(
    screen.getByRole("button", { name: /Standard: Workspace edits/ }).getAttribute("aria-pressed"),
  ).toBe("true");
});

it("disables modes the running agent does not advertise", async () => {
  const onChange = vi.fn(async () => true);
  render(
    <PermissionPicker
      agent="codex"
      modes={{ ...modes, availableModes: [{ id: "read-only" }] }}
      onChange={onChange}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Permissions" }));
  const auto = await screen.findByRole("button", { name: /Auto: Codex reviews/ });
  expect(auto.hasAttribute("disabled")).toBe(true);
  fireEvent.click(auto);
  expect(onChange).not.toHaveBeenCalled();
});

it("lets a new Codex task choose its initial permissions", async () => {
  const onSelectionChange = vi.fn();
  render(
    <ComposerPanel
      selection={{ agent: "codex", provider: "chatgpt", model: "gpt-5.6-sol" }}
      onSelectionChange={onSelectionChange}
      value=""
      onChange={vi.fn()}
      onSubmit={vi.fn()}
      label="Task"
      sendLabel="Send"
      sendDisabled
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Permissions" }));
  fireEvent.click(await screen.findByRole("button", { name: /Auto: Codex reviews/ }));
  expect(onSelectionChange).toHaveBeenCalledWith({
    agent: "codex",
    provider: "chatgpt",
    model: "gpt-5.6-sol",
    permissionMode: "agent",
  });
});
