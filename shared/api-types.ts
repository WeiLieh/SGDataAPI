/** Reply shapes of /api/data and /api/health, shared by the server and the React app. */

export interface DataSuccess<TData = unknown> {
  ok: true;
  dataset: string;
  params: Record<string, string>;
  source: {
    name: "data.gov.sg";
    agency: string;
    datasetId: string;
    datasetPage: string;
    /** The upstream URL, never containing a key. */
    endpoint: string;
  };
  fetchedAt: string;
  data: TData;
}

export interface ApiErrorBody {
  status: number;
  upstreamStatus: number | null;
  upstreamCode: number | null;
  upstreamName: string | null;
  message: string;
}

export interface DataFailure {
  ok: false;
  dataset: string | null;
  error: ApiErrorBody;
}

export type DataResponse<TData = unknown> = DataSuccess<TData> | DataFailure;

/** The result of checking one dataset's latest endpoint. */
export interface HealthCheck {
  ok: boolean;
  endpoint: string;
  status: number | null;
  code: number | null;
  latencyMs: number;
  latestTimestamp: string | null;
  message: string;
}

/**
 * GET /api/health: one block per checked dataset, named health<ID> ("healthPM25", "healthPSI"),
 * in registry order (PM2.5 first). With ?dataset=<id> only that dataset is checked.
 */
export type HealthResponse = {
  ok: boolean;
  checkedAt: string;
  keyConfigured: boolean;
  datasets: string[];
} & { [check: `health${string}`]: HealthCheck };
