import { useCallback, useEffect, useState } from "react";
import type { DataResponse, DataSuccess } from "../../shared/api-types";
import type { DatasetId } from "../../shared/datasets/registry";

export type DatasetState<TData> =
  | { status: "loading" }
  | { status: "success"; response: DataSuccess<TData> }
  | { status: "error"; httpStatus: number | null; message: string };

/**
 * Reads one dataset from /api/data. Nothing is cached in the browser and nothing is substituted
 * on failure. A query change (or unmount) aborts the in-flight request, so an old reply never
 * overwrites a new one.
 */
export function useDataset<TData>(
  dataset: DatasetId,
  params: Record<string, string> = {},
): { state: DatasetState<TData>; retry: () => void } {
  const [state, setState] = useState<DatasetState<TData>>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  const query = new URLSearchParams({ dataset, ...params }).toString();

  useEffect(() => {
    const controller = new AbortController();
    setState({ status: "loading" });

    (async () => {
      let response: Response;
      try {
        response = await fetch(`/api/data?${query}`, { signal: controller.signal, cache: "no-store" });
      } catch {
        if (controller.signal.aborted) return;
        setState({ status: "error", httpStatus: null, message: "Could not reach the SG Weather server." });
        return;
      }
      let body: DataResponse<TData> | null = null;
      try {
        body = (await response.json()) as DataResponse<TData>;
      } catch {
        body = null;
      }
      if (controller.signal.aborted) return;
      if (body?.ok === true) {
        setState({ status: "success", response: body });
      } else if (body?.ok === false) {
        setState({ status: "error", httpStatus: body.error.status, message: body.error.message });
      } else {
        setState({
          status: "error",
          httpStatus: response.status,
          message: "The SG Weather server answered with something other than JSON.",
        });
      }
    })();

    return () => controller.abort();
  }, [query, attempt]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  return { state, retry };
}
