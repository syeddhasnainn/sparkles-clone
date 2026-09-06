// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ComposerPanel } from "./composer-panel";

afterEach(cleanup);

const defaults = {
  value: "Draft",
  onChange: vi.fn(),
  onSubmit: vi.fn(),
  label: "Message",
  sendLabel: "Send",
  sendDisabled: false,
};

it("allows drafting while stopped and blocks keyboard submission", () => {
  const onChange = vi.fn();
  const onSubmit = vi.fn();
  render(<ComposerPanel {...defaults} onChange={onChange} onSubmit={onSubmit} sendDisabled />);
  const textarea = screen.getByRole("textbox", { name: "Message" });
  fireEvent.change(textarea, { target: { value: "New draft" } });
  fireEvent.keyDown(textarea, { key: "Enter" });
  expect(onChange).toHaveBeenCalledWith("New draft");
  expect(onSubmit).not.toHaveBeenCalled();
});

it("blocks sending attached files until they are removed", () => {
  const onSubmit = vi.fn();
  const { container } = render(<ComposerPanel {...defaults} onSubmit={onSubmit} />);
  const input = container.querySelector('input[type="file"]');
  if (!input) throw new Error("File picker is missing");
  fireEvent.change(input, {
    target: { files: [new File(["Hello"], "notes.txt", { type: "text/plain" })] },
  });
  fireEvent.submit(screen.getByRole("form", { name: "Message" }));
  expect(onSubmit).not.toHaveBeenCalled();
  expect(screen.getByRole("status").textContent).toContain("previewed locally");
  fireEvent.click(screen.getByRole("button", { name: "Remove notes.txt" }));
  fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter", shiftKey: true });
  expect(onSubmit).not.toHaveBeenCalled();
  fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter" });
  expect(onSubmit).toHaveBeenCalledOnce();
});
