import { useCallback, useEffect, useState } from "react";
import type { DataResponse, DataSuccess } from "../../shared/api-types";
import type { DatasetId } from "../../shared/datasets/registry";

/** Re-fetch this often while the page is visible; Vercel's cache refreshes on the same cycle. */
export const AUTO_REFRESH_MS = 5 * 60 * 1000;

export interface DatasetState<TData> {
  /** The last successful reply for this query; cleared when a fetch fails. */
  response: DataSuccess<TData> | null;
  error: { httpStatus: number | null; message: string } | null;
  /** True while a fetch is in flight (first load or refresh). */
  loading: boolean;
}

/**
 * Reads one dataset from /api/data. Nothing is cached in the browser and nothing is substituted
 * on failure. A new fetch (query change, refresh, or unmount) aborts the one in flight, so an old
 * reply never overwrites a new one. Re-fetches every 5 minutes while visible and whenever the page
 * becomes visible again.
 */
export function useDataset<TData>(
  dataset: DatasetId,
  params: Record<string, string> = {},
): { state: DatasetState<TData>; refresh: () => void } {
  const [state, setState] = useState<DatasetState<TData>>({ response: null, error: null, loading: true });
  const [attempt, setAttempt] = useState(0);
  const query = new URLSearchParams({ dataset, ...params }).toString();
  const refresh = useCallback(() => setAttempt((n) => n + 1), []);

  useEffect(() => {
    const controller = new AbortController();
    setState((previous) => ({ ...previous, loading: true }));

    const fail = (httpStatus: number | null, message: string) =>
      setState({ response: null, error: { httpStatus, message }, loading: false });

    (async () => {
      let response: Response;
      try {
        response = await fetch(`/api/data?${query}`, { signal: controller.signal, cache: "no-store" });
      } catch {
        if (!controller.signal.aborted) fail(null, "Could not reach the SG Weather server.");
        return;
      }
      let body: DataResponse<TData> | null = null;
      try {
        body = (await response.json()) as DataResponse<TData>;
      } catch {
        body = null;
      }
      if (controller.signal.aborted) return;
      if (body?.ok === true) setState({ response: body, error: null, loading: false });
      else if (body?.ok === false) fail(body.error.status, body.error.message);
      else fail(response.status, "The SG Weather server answered with something other than JSON.");
    })();

    return () => controller.abort();
  }, [query, attempt]);

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

  return { state, refresh };
}
