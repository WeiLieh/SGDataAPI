import type { AnyDatasetDefinition, DatasetParams } from "../../shared/datasets/types.js";
import { ApiError, logFailure } from "./errors.js";
import { fetchRealtime, realtimeEndpoint, type FetchOptions } from "./realtime.js";

export interface LoadedDataset {
  data: unknown;
  endpoint: string;
  upstreamStatus: number;
  upstreamCode: number;
}

/** The upstream URL a request would use, built only from the registry entry and validated params. */
export function datasetEndpoint(def: AnyDatasetDefinition, params: DatasetParams): string {
  const source = def.source;
  switch (source.kind) {
    case "realtime":
      return realtimeEndpoint(source, params);
    default: {
      const unhandled: never = source.kind;
      throw new Error(`No endpoint builder for source kind ${String(unhandled)}`);
    }
  }
}

/**
 * Fetches, merges, normalizes and checks a dataset. Dispatches on source.kind; a new kind
 * without a case here fails the typecheck at the `never` assignment.
 */
export async function loadDataset(
  def: AnyDatasetDefinition,
  params: DatasetParams,
  options: FetchOptions,
): Promise<LoadedDataset> {
  const source = def.source;
  let fetched;
  switch (source.kind) {
    case "realtime":
      fetched = await fetchRealtime(def, source, params, options);
      break;
    default: {
      const unhandled: never = source.kind;
      throw new Error(`No fetch function for source kind ${String(unhandled)}`);
    }
  }

  const data: unknown = def.normalize(def.mergePages(fetched.bodies));
  if (def.isEmpty(data)) {
    logFailure(options.scope, `${def.id} upstream ${fetched.upstreamStatus} code ${fetched.upstreamCode} no data`);
    throw new ApiError(404, def.notFoundMessage(params), {
      status: fetched.upstreamStatus,
      code: fetched.upstreamCode,
    });
  }
  return {
    data,
    endpoint: fetched.endpoint,
    upstreamStatus: fetched.upstreamStatus,
    upstreamCode: fetched.upstreamCode,
  };
}
