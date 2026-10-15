import type { IncomingMessage, ServerResponse } from "node:http";
import type { HealthResponse } from "../shared/api-types.js";
import type { Pm25Data } from "../shared/datasets/pm25.js";
import { datasetIds, registry } from "../shared/datasets/registry.js";
import { isKeyConfigured } from "./_lib/env.js";
import { ApiError, logFailure } from "./_lib/errors.js";
import { datasetEndpoint, loadDataset } from "./_lib/fetch-dataset.js";
import { rejectNonGet, sendJson } from "./_lib/http.js";

const SCOPE = "api/health";
const UPSTREAM_TIMEOUT_MS = 5_000;

/** GET /api/health: one call to the PM2.5 latest endpoint, to check a deployment without the app. */
export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const def = registry.pm25;
  const endpoint = datasetEndpoint(def, {});
  const checkedAt = new Date().toISOString();
  const keyConfigured = isKeyConfigured();

  if (
    rejectNonGet(req.method, res, {
      ok: false,
      checkedAt,
      keyConfigured,
      error: { status: 405, message: "Only GET is allowed." },
    })
  ) {
    return;
  }

  const started = performance.now();
  const reply = (ok: boolean, upstream: Omit<HealthResponse["upstream"], "endpoint" | "latencyMs">): void => {
    const body: HealthResponse = {
      ok,
      checkedAt,
      keyConfigured,
      upstream: { endpoint, ...upstream, latencyMs: Math.round(performance.now() - started) },
      datasets: datasetIds,
    };
    sendJson(res, ok ? 200 : 503, body, { "Cache-Control": "no-store" });
  };

  try {
    const loaded = await loadDataset(def, {}, { timeoutMs: UPSTREAM_TIMEOUT_MS, scope: SCOPE });
    const data = loaded.data as Pm25Data;
    reply(true, {
      status: loaded.upstreamStatus,
      code: loaded.upstreamCode,
      latestTimestamp: data.readings.at(-1)?.timestamp ?? null,
      message: "data.gov.sg answered with valid PM2.5 data.",
    });
  } catch (error) {
    if (error instanceof ApiError) {
      reply(false, {
        status: error.upstreamStatus,
        code: error.upstreamCode,
        latestTimestamp: null,
        message: error.message,
      });
      return;
    }
    const stack = error instanceof Error ? (error.stack ?? error.message) : String(error);
    logFailure(SCOPE, `unexpected error: ${stack}`);
    reply(false, { status: null, code: null, latestTimestamp: null, message: "Unexpected server error." });
  }
}
