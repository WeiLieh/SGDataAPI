import type { z } from "zod";

/** Base URL of data.gov.sg's real-time API family; a "realtime" source path is appended to it. */
export const REALTIME_API_BASE = "https://api-open.data.gov.sg/v2/real-time/api";

/**
 * Where a dataset's data comes from. Discriminated on `kind`; api/_lib/fetch-dataset.ts
 * switches on it exhaustively, so a new kind without a fetch function fails the typecheck.
 */
export type DatasetSource = { kind: "realtime"; path: `/${string}` };

export type ParamResult = { ok: true; value: string } | { ok: false; error: string };

/** Validates one raw query parameter; `now` is passed in so validation stays pure and testable. */
export type ParamValidator = (raw: string, now: Date) => ParamResult;

/** Validated, cleaned query parameters of a dataset request. */
export type DatasetParams = Record<string, string>;

export interface DatasetDefinition<TBody, TData> {
  /** URL-safe id used in /api/data?dataset=<id>. */
  id: string;
  title: string;
  /** Free text; the app is not limited to weather. */
  category: string;
  agency: string;
  /** data.gov.sg dataset ID ("d_..."). */
  datasetId: string;
  datasetPage: string;
  source: DatasetSource;
  /** Every allowed query parameter; anything else is rejected. All parameters are optional. */
  params: Record<string, ParamValidator>;
  /** zod schema of one upstream success body (one page). */
  schema: z.ZodType<TBody>;
  /** Combines the pages of a paginated reply into one body, in the order received. */
  mergePages(bodies: TBody[]): TBody;
  normalize(body: TBody): TData;
  /** True when a successful reply holds no data (answered as 404). */
  isEmpty(data: TData): boolean;
  /** The one-sentence 404 message, e.g. "data.gov.sg has no PM2.5 readings for 2026-10-15." */
  notFoundMessage(params: DatasetParams): string;
  cacheSeconds(params: DatasetParams, now: Date): number;
}

// The registry holds definitions with different body and data types.
export type AnyDatasetDefinition = DatasetDefinition<any, any>;

/** Identity helper that lets TypeScript infer TBody and TData from the definition. */
export function defineDataset<TBody, TData>(
  definition: DatasetDefinition<TBody, TData>,
): DatasetDefinition<TBody, TData> {
  return definition;
}
