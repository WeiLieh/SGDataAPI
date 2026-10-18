/**
 * Pieces shared by data.gov.sg's regional real-time datasets (PM2.5, PSI): the `date` parameter,
 * the response envelope, region parsing and normalisation. Types and pure functions only.
 */
import { z } from "zod";
import { sgtDate, sgtDateTime } from "../sgt.js";
import type { DatasetParams, ParamResult } from "./types.js";

const DATE_FORMAT_ERROR = "Use YYYY-MM-DD or YYYY-MM-DDTHH:mm:ss (Singapore time).";
const DATE_FUTURE_ERROR = "Date is in the future (Singapore time).";
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}):(\d{2}))?$/;

/** Validates the optional `date` parameter: a real SGT calendar date or date-time, not in the future. */
export function validateSgtDate(raw: string, now: Date): ParamResult {
  const value = raw.trim();
  const match = DATE_PATTERN.exec(value);
  if (!match) return { ok: false, error: DATE_FORMAT_ERROR };
  const [, y, mo, d, h = "00", mi = "00", s = "00"] = match;
  const year = Number(y);
  const month = Number(mo);
  const day = Number(d);
  const hour = Number(h);
  const minute = Number(mi);
  const second = Number(s);
  const asUtc = new Date(Date.UTC(year, month - 1, day));
  const realDate =
    asUtc.getUTCFullYear() === year && asUtc.getUTCMonth() === month - 1 && asUtc.getUTCDate() === day;
  if (!realDate || hour > 23 || minute > 59 || second > 59) {
    return { ok: false, error: DATE_FORMAT_ERROR };
  }
  // Both sides are SGT wall-clock strings of the same shape, so they compare lexicographically.
  const future = value.length === 10 ? value > sgtDate(now) : value > sgtDateTime(now);
  if (future) return { ok: false, error: DATE_FUTURE_ERROR };
  return { ok: true, value };
}

/** 300 s for the latest reading or today's SGT date, 86400 s for an earlier day. */
export function dailyCacheSeconds(params: DatasetParams, now: Date): number {
  if (!params.date) return 300;
  return params.date.slice(0, 10) === sgtDate(now) ? 300 : 86400;
}

/** Any ISO 8601 date-time with a UTC offset ("Z", "+08:00" or "+0800"). */
const ISO_WITH_OFFSET = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})$/;
export const timestampSchema = z
  .string()
  .refine((s) => ISO_WITH_OFFSET.test(s) && !Number.isNaN(Date.parse(s)), {
    message: "Expected an ISO 8601 timestamp with an offset",
  });

/** Readings keyed by region name; a value may be null. */
export const regionValuesSchema = z.record(z.string(), z.number().nullable());

export const regionMetadataSchema = z.array(
  z.object({
    name: z.string(),
    labelLocation: z.object({ latitude: z.number(), longitude: z.number() }),
  }),
);

/** The data.gov.sg success envelope around a dataset's own `readings` object. */
export function regionalBodySchema<R extends z.ZodTypeAny>(readings: R) {
  return z.object({
    code: z.number(),
    errorMsg: z.string().optional(),
    data: z.object({
      regionMetadata: regionMetadataSchema,
      items: z.array(
        z.object({
          date: z.string().optional(),
          timestamp: timestampSchema,
          updatedTimestamp: timestampSchema,
          readings,
        }),
      ),
      paginationToken: z.string().optional(),
    }),
  });
}

export interface RegionalBody<R> {
  code: number;
  errorMsg?: string | undefined;
  data: {
    regionMetadata: z.infer<typeof regionMetadataSchema>;
    items: Array<{ date?: string | undefined; timestamp: string; updatedTimestamp: string; readings: R }>;
    paginationToken?: string | undefined;
  };
}

export interface Region {
  id: string;
  name: string;
  /** null for a region that has readings but no metadata. */
  latitude: number | null;
  longitude: number | null;
}

export interface RegionalReading {
  timestamp: string;
  updatedTimestamp: string;
  values: Record<string, number | null>;
}

const REGION_ORDER = ["central", "north", "south", "east", "west"];

export function regionKey(name: string): string {
  return name.trim().toLowerCase();
}

function compareRegions(a: string, b: string): number {
  const ia = REGION_ORDER.indexOf(a);
  const ib = REGION_ORDER.indexOf(b);
  if (ia !== -1 || ib !== -1) {
    if (ia === -1) return 1;
    if (ib === -1) return -1;
    return ia - ib;
  }
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Normalises one reading series: regions (central, north, south, east, west, then others
 * alphabetically; names trimmed and lowercased; regions without metadata kept without
 * coordinates) and readings oldest to newest, one per timestamp (the latest published wins),
 * with a missing region as null, never 0.
 */
export function normalizeRegional<R>(
  body: RegionalBody<R>,
  pick: (readings: R) => Record<string, number | null>,
): { regions: Region[]; readings: RegionalReading[] } {
  const coordinates = new Map<string, { latitude: number; longitude: number }>();
  for (const meta of body.data.regionMetadata) {
    const id = regionKey(meta.name);
    if (id) coordinates.set(id, meta.labelLocation);
  }

  const items = body.data.items.map((item) => {
    const values = new Map<string, number | null>();
    for (const [name, value] of Object.entries(pick(item.readings))) {
      const id = regionKey(name);
      if (id) values.set(id, value);
    }
    return { item, values };
  });

  const ids = new Set(coordinates.keys());
  for (const { values } of items) for (const id of values.keys()) ids.add(id);

  const regions: Region[] = [...ids].sort(compareRegions).map((id) => {
    const location = coordinates.get(id);
    return {
      id,
      name: id.charAt(0).toUpperCase() + id.slice(1),
      latitude: location?.latitude ?? null,
      longitude: location?.longitude ?? null,
    };
  });

  const byInstant = new Map<number, RegionalReading>();
  for (const { item, values } of items) {
    const instant = Date.parse(item.timestamp);
    const existing = byInstant.get(instant);
    if (existing && Date.parse(existing.updatedTimestamp) >= Date.parse(item.updatedTimestamp)) continue;
    const row: Record<string, number | null> = {};
    for (const region of regions) row[region.id] = values.get(region.id) ?? null;
    byInstant.set(instant, { timestamp: item.timestamp, updatedTimestamp: item.updatedTimestamp, values: row });
  }
  const readings = [...byInstant.entries()].sort(([a], [b]) => a - b).map(([, reading]) => reading);

  return { regions, readings };
}

/** Combines the pages of a paginated reply: region metadata de-duplicated, items concatenated. */
export function mergeRegionalPages<B extends RegionalBody<unknown>>(bodies: B[]): B {
  const [first] = bodies;
  if (!first) throw new Error("mergePages needs at least one page");
  const metadata = new Map<string, B["data"]["regionMetadata"][number]>();
  for (const body of bodies) {
    for (const meta of body.data.regionMetadata) {
      if (!metadata.has(regionKey(meta.name))) metadata.set(regionKey(meta.name), meta);
    }
  }
  return {
    ...first,
    data: {
      regionMetadata: [...metadata.values()],
      items: bodies.flatMap((body) => body.data.items),
    },
  };
}
