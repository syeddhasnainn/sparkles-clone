// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { usePaginatedItems, type ItemPage } from "./use-paginated-items";

function deferredPage() {
  let resolve = (_page: ItemPage<string>) => {};
  const promise = new Promise<ItemPage<string>>((finish) => {
    resolve = finish;
  });

  return { promise, resolve };
}

afterEach(cleanup);

describe("paginated repository data", () => {
  it("appends each page once even if load-more is clicked twice", async () => {
    const nextPage = deferredPage();
    const loadPage = vi
      .fn<(page: number) => Promise<ItemPage<string>>>()
      .mockResolvedValueOnce({ items: ["first"], hasMore: true })
      .mockReturnValueOnce(nextPage.promise);
    const { result } = renderHook(() => usePaginatedItems(loadPage));

    await waitFor(() => expect(result.current.status).toBe("ready"));

    act(() => {
      void result.current.loadMore();
      void result.current.loadMore();
    });

    expect(loadPage.mock.calls).toEqual([[1], [2]]);
    expect(result.current.loadingMore).toBe(true);

    await act(async () => nextPage.resolve({ items: ["second"], hasMore: false }));

    expect(result.current.items).toEqual(["first", "second"]);
    expect(result.current.hasMore).toBe(false);
    expect(result.current.loadingMore).toBe(false);
  });

  it("retries a failed initial request from the first page", async () => {
    const loadPage = vi
      .fn<(page: number) => Promise<ItemPage<string>>>()
      .mockRejectedValueOnce(new Error("Unavailable"))
      .mockResolvedValueOnce({ items: ["recovered"], hasMore: false });
    const { result } = renderHook(() => usePaginatedItems(loadPage));

    await waitFor(() => expect(result.current.status).toBe("error"));
    act(() => result.current.retry());
    await waitFor(() => expect(result.current.status).toBe("ready"));

    expect(result.current.items).toEqual(["recovered"]);
    expect(loadPage.mock.calls).toEqual([[1], [1]]);
  });

  it("ignores a previous account's response after the loader changes", async () => {
    const previous = deferredPage();
    const oldLoader = vi.fn(() => previous.promise);
    const newLoader = vi.fn(async () => ({ items: ["new-account"], hasMore: false }));
    const { result, rerender } = renderHook(({ loader }) => usePaginatedItems(loader), {
      initialProps: { loader: oldLoader },
    });

    rerender({ loader: newLoader });
    await waitFor(() => expect(result.current.items).toEqual(["new-account"]));
    await act(async () => previous.resolve({ items: ["stale-account"], hasMore: true }));

    expect(result.current.items).toEqual(["new-account"]);
    expect(result.current.hasMore).toBe(false);
  });

  it("discards a pending next page when a retry resets pagination", async () => {
    const nextPage = deferredPage();
    const loadPage = vi
      .fn<(page: number) => Promise<ItemPage<string>>>()
      .mockResolvedValueOnce({ items: ["original"], hasMore: true })
      .mockReturnValueOnce(nextPage.promise)
      .mockResolvedValueOnce({ items: ["fresh"], hasMore: false });
    const { result } = renderHook(() => usePaginatedItems(loadPage));

    await waitFor(() => expect(result.current.status).toBe("ready"));
    act(() => {
      void result.current.loadMore();
    });
    act(() => result.current.retry());
    await waitFor(() => expect(result.current.items).toEqual(["fresh"]));
    await act(async () => nextPage.resolve({ items: ["stale-page"], hasMore: false }));

    expect(result.current.items).toEqual(["fresh"]);
    expect(result.current.page).toBe(1);
  });
});
