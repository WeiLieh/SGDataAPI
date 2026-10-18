import { useCallback, useEffect, useState } from "react";
import type { DataResponse, DataSuccess } from "../../shared/api-types";
import type { DatasetId } from "../../shared/datasets/registry";

/** Re-fetch this often while the page is visible; Vercel's cache refreshes on the same cycle. */
export const AUTO_REFRESH_MS = 5 * 60 * 1000;

export interface FetchFailure {
  httpStatus: number | null;
  message: string;
}

export interface DatasetState<TData> {
  /** The last successful reply for this query; cleared when a fetch fails. */
  response: DataSuccess<TData> | null;
  error: FetchFailure | null;
  /** True while a fetch is in flight (first load or refresh). */
  loading: boolean;
}

export type RequestResult<TData> = { ok: true; response: DataSuccess<TData> } | { ok: false; error: FetchFailure };

/**
 * One request to /api/data. Nothing is cached in the browser and nothing is substituted on
 * failure. Returns null when the request was aborted, so an old reply never overwrites a new one.
 */
export async function requestDataset<TData>(
  dataset: DatasetId,
  params: Record<string, string>,
  signal: AbortSignal,
): Promise<RequestResult<TData> | null> {
  const query = new URLSearchParams({ dataset, ...params }).toString();
  let response: Response;
  try {
    response = await fetch(`/api/data?${query}`, { signal, cache: "no-store" });
  } catch {
    if (signal.aborted) return null;
    return { ok: false, error: { httpStatus: null, message: "Could not reach the SG Weather server." } };
  }
  let body: DataResponse<TData> | null = null;
  try {
    body = (await response.json()) as DataResponse<TData>;
  } catch {
    body = null;
  }
  if (signal.aborted) return null;
  if (body?.ok === true) return { ok: true, response: body };
  if (body?.ok === false) {
    return { ok: false, error: { httpStatus: body.error.status, message: body.error.message } };
  }
  return {
    ok: false,
    error: { httpStatus: response.status, message: "The SG Weather server answered with something other than JSON." },
  };
}

/** Calls `refresh` every 5 minutes while the page is visible and whenever it becomes visible again. */
export function useAutoRefresh(refresh: () => void): void {
  useEffect(() => {
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") refresh();
    }, AUTO_REFRESH_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refresh]);
}

/**
 * Reads one dataset from /api/data. A new fetch (query change, refresh, or unmount) aborts the
 * one in flight. Re-fetches every 5 minutes while visible and whenever the page becomes visible.
 */
export function useDataset<TData>(
  dataset: DatasetId,
  params: Record<string, string> = {},
): { state: DatasetState<TData>; refresh: () => void } {
  const [state, setState] = useState<DatasetState<TData>>({ response: null, error: null, loading: true });
  const [attempt, setAttempt] = useState(0);
  const query = JSON.stringify(params);
  const refresh = useCallback(() => setAttempt((n) => n + 1), []);

  useEffect(() => {
    const controller = new AbortController();
    setState((previous) => ({ ...previous, loading: true }));
    void requestDataset<TData>(dataset, JSON.parse(query) as Record<string, string>, controller.signal).then(
      (result) => {
        if (!result) return;
        setState(
          result.ok
            ? { response: result.response, error: null, loading: false }
            : { response: null, error: result.error, loading: false },
        );
      },
    );
    return () => controller.abort();
  }, [dataset, query, attempt]);

  useAutoRefresh(refresh);
  return { state, refresh };
}
