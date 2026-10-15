import {
  REALTIME_API_BASE,
  type AnyDatasetDefinition,
  type DatasetParams,
  type DatasetSource,
} from "../../shared/datasets/types.js";
import { getApiKey } from "./env.js";
import { ApiError, logFailure } from "./errors.js";

/** Pages followed for one request; needing a sixth answers 502 rather than a partial day. */
export const MAX_PAGES = 5;

export interface FetchOptions {
  timeoutMs: number;
  /** Log prefix, e.g. "api/data". */
  scope: string;
}

export interface FetchResult {
  /** Schema-validated success bodies, one per page, in order. */
  bodies: unknown[];
  /** The upstream URL of the first page; never contains the key. */
  endpoint: string;
  upstreamStatus: number;
  upstreamCode: number;
}

type RealtimeSource = Extract<DatasetSource, { kind: "realtime" }>;

export function realtimeEndpoint(source: RealtimeSource, params: DatasetParams): string {
  const url = new URL(REALTIME_API_BASE + source.path);
  for (const [name, value] of Object.entries(params)) url.searchParams.set(name, value);
  return url.toString();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Reads code, name and errorMsg from a body that may or may not be JSON. */
function readEnvelope(text: string): { code: number | null; name: string | null; errorMsg: string | null } {
  try {
    const json: unknown = JSON.parse(text);
    if (!isRecord(json)) return { code: null, name: null, errorMsg: null };
    return {
      code: typeof json.code === "number" ? json.code : null,
      name: typeof json.name === "string" ? json.name : null,
      errorMsg: typeof json.errorMsg === "string" && json.errorMsg.trim() ? json.errorMsg : null,
    };
  } catch {
    return { code: null, name: null, errorMsg: null };
  }
}

function transportError(error: unknown, def: AnyDatasetDefinition, options: FetchOptions): ApiError {
  const name = error instanceof Error ? error.name : "";
  if (name === "TimeoutError") {
    logFailure(options.scope, `${def.id} upstream timeout after ${options.timeoutMs} ms`);
    return new ApiError(504, `data.gov.sg did not answer within ${options.timeoutMs / 1000} seconds.`);
  }
  const detail = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  logFailure(options.scope, `${def.id} upstream network failure: ${detail}`);
  return new ApiError(502, "Could not reach data.gov.sg.");
}

function httpError(
  response: Response,
  text: string,
  def: AnyDatasetDefinition,
  params: DatasetParams,
  options: FetchOptions,
): ApiError {
  const status = response.status;
  const { code, name, errorMsg } = readEnvelope(text);
  logFailure(options.scope, `${def.id} upstream ${status} code ${code ?? "-"} ${name ?? "-"}`);
  const upstream = { status, code, name };
  if (status === 400) {
    return new ApiError(400, errorMsg ?? "data.gov.sg rejected the request (HTTP 400).", upstream);
  }
  if (status === 404) return new ApiError(404, def.notFoundMessage(params), upstream);
  if (status === 429) {
    const retryAfter = response.headers.get("retry-after");
    return new ApiError(
      429,
      "data.gov.sg rate limit reached. Try again in a minute.",
      upstream,
      retryAfter ? { "Retry-After": retryAfter } : {},
    );
  }
  // 5xx, and any other status the API does not document, is data.gov.sg's fault, not the client's.
  return new ApiError(502, `data.gov.sg returned HTTP ${status}.`, upstream);
}

/**
 * Fetches a real-time dataset, following paginationToken (at most MAX_PAGES pages).
 * Never retries: a retried 429 only slows the reply and spends more of the rate limit.
 */
export async function fetchRealtime(
  def: AnyDatasetDefinition,
  source: RealtimeSource,
  params: DatasetParams,
  options: FetchOptions,
): Promise<FetchResult> {
  const endpoint = realtimeEndpoint(source, params);
  const headers: Record<string, string> = { Accept: "application/json" };
  const key = getApiKey();
  if (key) headers["x-api-key"] = key;

  const formatError = (status: number, code: number | null, detail: string): ApiError => {
    logFailure(options.scope, `${def.id} upstream ${status} unexpected format: ${detail}`);
    return new ApiError(502, `data.gov.sg returned ${def.title} data in an unexpected format.`, {
      status,
      code,
    });
  };

  const bodies: unknown[] = [];
  let token: string | null = null;
  let upstreamStatus = 0;
  let upstreamCode = 0;

  for (;;) {
    const url = new URL(endpoint);
    if (token) url.searchParams.set("paginationToken", token);

    let response: Response;
    let text: string;
    try {
      response = await fetch(url, { headers, signal: AbortSignal.timeout(options.timeoutMs) });
      text = await response.text();
    } catch (error) {
      throw transportError(error, def, options);
    }

    if (!response.ok) throw httpError(response, text, def, params, options);

    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      throw formatError(response.status, null, "body is not JSON");
    }

    const envelope = isRecord(json) ? json : {};
    if (typeof envelope.code === "number" && envelope.code !== 0) {
      const { name, errorMsg } = readEnvelope(text);
      logFailure(options.scope, `${def.id} upstream ${response.status} code ${envelope.code} ${name ?? "-"}`);
      throw new ApiError(
        502,
        errorMsg ?? `data.gov.sg answered with error code ${envelope.code}.`,
        { status: response.status, code: envelope.code, name },
      );
    }

    const parsed = def.schema.safeParse(json);
    if (!parsed.success) {
      const issues = parsed.error.issues
        .slice(0, 5)
        .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
        .join("; ");
      throw formatError(response.status, typeof envelope.code === "number" ? envelope.code : null, issues);
    }

    bodies.push(parsed.data);
    if (bodies.length === 1) {
      upstreamStatus = response.status;
      upstreamCode = typeof envelope.code === "number" ? envelope.code : 0;
    }

    const data = isRecord(envelope.data) ? envelope.data : {};
    token = typeof data.paginationToken === "string" && data.paginationToken ? data.paginationToken : null;
    if (!token) break;
    if (bodies.length >= MAX_PAGES) {
      logFailure(options.scope, `${def.id} upstream returned more than ${MAX_PAGES} pages`);
      throw new ApiError(502, "data.gov.sg returned more pages than expected.", {
        status: response.status,
        code: upstreamCode,
      });
    }
  }

  return { bodies, endpoint, upstreamStatus, upstreamCode };
}
