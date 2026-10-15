import type { ApiErrorBody } from "../../shared/api-types.js";
import { oneLine } from "./http.js";

/** A failure with the status and one-line message the client should see. */
export class ApiError extends Error {
  readonly status: number;
  readonly upstreamStatus: number | null;
  readonly upstreamCode: number | null;
  readonly upstreamName: string | null;
  /** Extra reply headers, e.g. Retry-After on a 429. */
  readonly headers: Record<string, string>;

  constructor(
    status: number,
    message: string,
    upstream: { status?: number | null; code?: number | null; name?: string | null } = {},
    headers: Record<string, string> = {},
  ) {
    super(oneLine(message));
    this.name = "ApiError";
    this.status = status;
    this.upstreamStatus = upstream.status ?? null;
    this.upstreamCode = upstream.code ?? null;
    this.upstreamName = upstream.name ?? null;
    this.headers = headers;
  }

  toBody(): ApiErrorBody {
    return {
      status: this.status,
      upstreamStatus: this.upstreamStatus,
      upstreamCode: this.upstreamCode,
      upstreamName: this.upstreamName,
      message: this.message,
    };
  }
}

/** One server log line per failure. Never pass request headers or the key in here. */
export function logFailure(scope: string, line: string): void {
  console.error(`[${scope}] ${line.replace(/\s+/g, " ").trim()}`);
}
