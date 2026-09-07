// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useAgentConversation } from "./use-agent-conversation";

const command = vi.fn();
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});
const snapshot = (events: unknown[] = []) =>
  JSON.stringify({ status: "idle", events, cursor: events.length, head: events.length });
const prompt = {
  kind: "prompt" as const,
  requestId: "8cfd72fb-ea42-4471-8b7c-e5f772ae9cb1",
  prompt: "Hello",
};

it("shows a prompt before the network resolves and reconciles its saved event without duplication", async () => {
  let resolveSend!: (value: string) => void;
  let saved = false;
  command.mockImplementation(({ data }) =>
    data.command.kind === "prompt"
      ? new Promise<string>((resolve) => {
          resolveSend = resolve;
        })
      : Promise.resolve(
          snapshot(
            saved
              ? [{ id: 1, type: "user", data: { text: "Hello", requestId: prompt.requestId } }]
              : [],
          ),
        ),
  );
  const { result } = renderHook(() => useAgentConversation("task", true, command));
  await waitFor(() => expect(result.current.snapshot?.status).toBe("idle"));
  let sent!: Promise<boolean>;
  act(() => {
    sent = result.current.send(prompt);
  });
  expect(result.current.events.at(-1)?.data.text).toBe("Hello");
  expect(result.current.awaitingPrompt).toBe(true);
  expect(result.current.sending).toBe(true);
  await act(async () => {
    resolveSend(snapshot());
    await sent;
  });
  expect(result.current.events).toHaveLength(1);
  saved = true;
  await waitFor(() => expect(result.current.awaitingPrompt).toBe(false), { timeout: 2500 });
  expect(result.current.events).toHaveLength(1);
  expect(result.current.events[0].id).toBe(1);
});

it("removes the optimistic message and reports a failed send", async () => {
  command.mockImplementation(({ data }) =>
    data.command.kind === "prompt"
      ? Promise.reject(new Error("offline"))
      : Promise.resolve(snapshot()),
  );
  const { result } = renderHook(() => useAgentConversation("task", true, command));
  await waitFor(() => expect(result.current.snapshot).not.toBeNull());
  await act(async () => {
    expect(await result.current.send(prompt)).toBe(false);
  });
  expect(result.current.events).toHaveLength(0);
  expect(result.current.awaitingPrompt).toBe(false);
  expect(result.current.error).toContain("Could not send");
});
