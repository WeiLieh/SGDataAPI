import type { IncomingMessage, ServerResponse } from "node:http";
import type { DataFailure, DataSuccess } from "../shared/api-types.js";
import { datasetIds, isDatasetId, registry } from "../shared/datasets/registry.js";
import type { DatasetParams } from "../shared/datasets/types.js";
import { ApiError, logFailure } from "./_lib/errors.js";
import { loadDataset } from "./_lib/fetch-dataset.js";
import { rejectNonGet, sendJson } from "./_lib/http.js";

const SCOPE = "api/data";
const UPSTREAM_TIMEOUT_MS = 10_000;

function failure(dataset: string | null, error: ApiError): DataFailure {
  return { ok: false, dataset, error: error.toBody() };
}

function sendFailure(res: ServerResponse, dataset: string | null, error: ApiError): void {
  sendJson(res, error.status, failure(dataset, error), { ...error.headers, "Cache-Control": "no-store" });
}

/** GET /api/data?dataset=<id>&<that dataset's parameters> */
export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? "/", "http://localhost");
  const requested = url.searchParams.get("dataset");
  const dataset = requested !== null && isDatasetId(requested) ? requested : null;

  if (rejectNonGet(req.method, res, failure(dataset, new ApiError(405, "Only GET is allowed.")))) return;

  try {
    const known = `Known datasets: ${datasetIds.join(", ")}.`;
    if (requested === null || requested === "") {
      throw new ApiError(404, `Name a dataset with ?dataset=<id>. ${known}`);
    }
    if (dataset === null) throw new ApiError(404, `Unknown dataset "${requested}". ${known}`);
    if (url.searchParams.getAll("dataset").length > 1) throw new ApiError(400, "Give dataset only once.");

    const def = registry[dataset];
    const allowed = Object.keys(def.params);
    const now = new Date();
    const params: DatasetParams = {};
    for (const name of new Set(url.searchParams.keys())) {
      if (name === "dataset") continue;
      const validate = Object.hasOwn(def.params, name) ? def.params[name] : undefined;
      if (!validate) {
        const hint = allowed.length ? `Allowed: ${allowed.join(", ")}.` : "This dataset takes no parameters.";
        throw new ApiError(400, `Unknown parameter "${name}". ${hint}`);
      }
      const values = url.searchParams.getAll(name);
      if (values.length > 1) throw new ApiError(400, `Give ${name} only once.`);
      const result = validate(values[0] ?? "", now);
      if (!result.ok) throw new ApiError(400, result.error);
      params[name] = result.value;
    }

    const loaded = await loadDataset(def, params, { timeoutMs: UPSTREAM_TIMEOUT_MS, scope: SCOPE });
    const body: DataSuccess = {
      ok: true,
      dataset,
      params,
      source: {
        name: "data.gov.sg",
        agency: def.agency,
        datasetId: def.datasetId,
        datasetPage: def.datasetPage,
        endpoint: loaded.endpoint,
      },
      fetchedAt: new Date().toISOString(),
      data: loaded.data,
    };
    const seconds = def.cacheSeconds(params, now);
    sendJson(res, 200, body, {
      "Cache-Control": `public, s-maxage=${seconds}, stale-while-revalidate=${seconds}`,
    });
  } catch (error) {
    if (error instanceof ApiError) {
      sendFailure(res, dataset, error);
      return;
    }
    const stack = error instanceof Error ? (error.stack ?? error.message) : String(error);
    logFailure(SCOPE, `${dataset ?? "-"} unexpected error: ${stack}`);
    sendFailure(res, dataset, new ApiError(500, "Unexpected server error."));
  }
}
