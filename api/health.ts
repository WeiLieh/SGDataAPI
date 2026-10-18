import type { IncomingMessage, ServerResponse } from "node:http";
import type { HealthCheck, HealthResponse } from "../shared/api-types.js";
import { datasetIds, isDatasetId, registry, type DatasetId } from "../shared/datasets/registry.js";
import { isKeyConfigured } from "./_lib/env.js";
import { ApiError, logFailure } from "./_lib/errors.js";
import { datasetEndpoint, loadDataset } from "./_lib/fetch-dataset.js";
import { rejectNonGet, sendJson } from "./_lib/http.js";

const SCOPE = "api/health";
const UPSTREAM_TIMEOUT_MS = 5_000;

/** "healthPM25", "healthPSI": the reply key for a dataset's check. */
function checkKey(id: DatasetId): `health${string}` {
  return `health${id.toUpperCase()}`;
}

/** Calls one dataset's latest endpoint once, with a 5-second timeout. */
async function check(id: DatasetId): Promise<HealthCheck> {
  const def = registry[id];
  const endpoint = datasetEndpoint(def, {});
  const started = performance.now();
  const latency = () => Math.round(performance.now() - started);
  try {
    const loaded = await loadDataset(def, {}, { timeoutMs: UPSTREAM_TIMEOUT_MS, scope: SCOPE });
    const readings = (loaded.data as { readings?: Array<{ timestamp: string }> }).readings ?? [];
    return {
      ok: true,
      endpoint,
      status: loaded.upstreamStatus,
      code: loaded.upstreamCode,
      latencyMs: latency(),
      latestTimestamp: readings.at(-1)?.timestamp ?? null,
      message: `data.gov.sg answered with valid ${def.title} data.`,
    };
  } catch (error) {
    if (error instanceof ApiError) {
      return {
        ok: false,
        endpoint,
        status: error.upstreamStatus,
        code: error.upstreamCode,
        latencyMs: latency(),
        latestTimestamp: null,
        message: error.message,
      };
    }
    const stack = error instanceof Error ? (error.stack ?? error.message) : String(error);
    logFailure(SCOPE, `${id} unexpected error: ${stack}`);
    return {
      ok: false,
      endpoint,
      status: null,
      code: null,
      latencyMs: latency(),
      latestTimestamp: null,
      message: "Unexpected server error.",
    };
  }
}

/**
 * GET /api/health checks every dataset (PM2.5 first, then PSI); ?dataset=<id> checks one.
 * 200 when every checked dataset answered with valid data, otherwise 503. One function for all
 * datasets keeps the deployment at two functions (Vercel free-plan cap).
 */
export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? "/", "http://localhost");
  const checkedAt = new Date().toISOString();
  const keyConfigured = isKeyConfigured();
  const failure = (status: number, message: string) => ({ ok: false, checkedAt, keyConfigured, error: { status, message } });

  if (rejectNonGet(req.method, res, failure(405, "Only GET is allowed."))) return;

  const requested = url.searchParams.get("dataset");
  if (requested !== null && !isDatasetId(requested)) {
    sendJson(res, 404, failure(404, `Unknown dataset "${requested}". Known datasets: ${datasetIds.join(", ")}.`), {
      "Cache-Control": "no-store",
    });
    return;
  }

  const ids: DatasetId[] = requested !== null && isDatasetId(requested) ? [requested] : datasetIds;
  const results = await Promise.all(ids.map((id) => check(id)));

  const body: HealthResponse = { ok: results.every((r) => r.ok), checkedAt, keyConfigured, datasets: datasetIds };
  ids.forEach((id, i) => {
    body[checkKey(id)] = results[i]!;
  });
  // Key order is what JSON shows: summary first, then PM2.5, then PSI, then the dataset list.
  const { datasets, ...rest } = body;
  sendJson(res, body.ok ? 200 : 503, { ...rest, datasets }, { "Cache-Control": "no-store" });
}
