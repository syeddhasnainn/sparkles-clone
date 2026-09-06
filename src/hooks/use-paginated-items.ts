import { useCallback, useEffect, useReducer, useRef } from "react";

export interface ItemPage<T> {
  items: T[];
  hasMore: boolean;
}

interface PaginationState<T> extends ItemPage<T> {
  page: number;
  status: "loading" | "ready" | "error";
  loadingMore: boolean;
}

type PaginationAction<T> =
  | { type: "start" }
  | { type: "load-more" }
  | { type: "loaded"; result: ItemPage<T>; page: number }
  | { type: "failed" };

function paginationReducer<T>(
  state: PaginationState<T>,
  action: PaginationAction<T>,
): PaginationState<T> {
  switch (action.type) {
    case "start":
      return { items: [], hasMore: false, page: 0, status: "loading", loadingMore: false };
    case "load-more":
      return { ...state, loadingMore: true };
    case "loaded":
      return {
        items: action.page === 1 ? action.result.items : [...state.items, ...action.result.items],
        hasMore: action.result.hasMore,
        page: action.page,
        status: "ready",
        loadingMore: false,
      };
    case "failed":
      return { ...state, status: "error", loadingMore: false };
  }
}

export function usePaginatedItems<T>(loadPage: (page: number) => Promise<ItemPage<T>>) {
  const [state, dispatch] = useReducer(paginationReducer<T>, {
    items: [],
    hasMore: false,
    page: 0,
    status: "loading",
    loadingMore: false,
  });
  const [attempt, retry] = useReducer((value: number) => value + 1, 0);
  const generation = useRef(0);
  const pending = useRef(false);

  useEffect(() => {
    const requestGeneration = ++generation.current;
    pending.current = true;
    dispatch({ type: "start" });

    loadPage(1)
      .then((result) => {
        if (generation.current === requestGeneration) {
          dispatch({ type: "loaded", result, page: 1 });
        }
      })
      .catch(() => {
        if (generation.current === requestGeneration) {
          dispatch({ type: "failed" });
        }
      })
      .finally(() => {
        if (generation.current === requestGeneration) {
          pending.current = false;
        }
      });

    return () => {
      generation.current++;
    };
  }, [loadPage, attempt]);

  const loadMore = useCallback(async () => {
    if (pending.current || !state.hasMore || state.status !== "ready") {
      return;
    }

    const requestGeneration = generation.current;
    const page = state.page + 1;
    pending.current = true;
    dispatch({ type: "load-more" });

    try {
      const result = await loadPage(page);

      if (generation.current === requestGeneration) {
        dispatch({ type: "loaded", result, page });
      }
    } catch {
      if (generation.current === requestGeneration) {
        dispatch({ type: "failed" });
      }
    } finally {
      if (generation.current === requestGeneration) {
        pending.current = false;
      }
    }
  }, [loadPage, state.hasMore, state.page, state.status]);

  return { ...state, loadMore, retry };
}
