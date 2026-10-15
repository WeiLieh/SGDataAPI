import { z } from "zod";
import { sgtDate, sgtDateTime } from "../sgt.js";
import { defineDataset, type ParamResult } from "./types.js";

const DATE_FORMAT_ERROR = "Use YYYY-MM-DD or YYYY-MM-DDTHH:mm:ss (Singapore time).";
const DATE_FUTURE_ERROR = "Date is in the future (Singapore time).";
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}):(\d{2}))?$/;

/** Validates the optional `date` parameter: a real SGT calendar date or date-time, not in the future. */
export function validatePm25Date(raw: string, now: Date): ParamResult {
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

/** Any ISO 8601 date-time with a UTC offset ("Z", "+08:00" or "+0800"). */
const ISO_WITH_OFFSET = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})$/;
const timestamp = z
  .string()
  .refine((s) => ISO_WITH_OFFSET.test(s) && !Number.isNaN(Date.parse(s)), {
    message: "Expected an ISO 8601 timestamp with an offset",
  });

export const pm25BodySchema = z.object({
  code: z.number(),
  errorMsg: z.string().optional(),
  data: z.object({
    regionMetadata: z.array(
      z.object({
        name: z.string(),
        labelLocation: z.object({ latitude: z.number(), longitude: z.number() }),
      }),
    ),
    items: z.array(
      z.object({
        date: z.string().optional(),
        timestamp,
        updatedTimestamp: timestamp,
        readings: z.object({
          pm25_one_hourly: z.record(z.string(), z.number().nullable()),
        }),
      }),
    ),
    paginationToken: z.string().optional(),
  }),
});

export type Pm25Body = z.infer<typeof pm25BodySchema>;

export interface Pm25Region {
  id: string;
  name: string;
  /** null for a region that has readings but no metadata. */
  latitude: number | null;
  longitude: number | null;
}

export interface Pm25Reading {
  timestamp: string;
  updatedTimestamp: string;
  values: Record<string, number | null>;
}

export interface Pm25Data {
  unit: "µg/m³";
  regions: Pm25Region[];
  readings: Pm25Reading[];
}

const REGION_ORDER = ["central", "north", "south", "east", "west"];

function regionKey(name: string): string {
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

export function normalizePm25(body: Pm25Body): Pm25Data {
  const coordinates = new Map<string, { latitude: number; longitude: number }>();
  for (const meta of body.data.regionMetadata) {
    const id = regionKey(meta.name);
    if (id) coordinates.set(id, meta.labelLocation);
  }

  // Lowercase every reading's keys once, and collect regions that only appear in readings.
  const items = body.data.items.map((item) => {
    const values = new Map<string, number | null>();
    for (const [name, value] of Object.entries(item.readings.pm25_one_hourly)) {
      const id = regionKey(name);
      if (id) values.set(id, value);
    }
    return { item, values };
  });

  const ids = new Set(coordinates.keys());
  for (const { values } of items) for (const id of values.keys()) ids.add(id);

  const regions: Pm25Region[] = [...ids].sort(compareRegions).map((id) => {
    const location = coordinates.get(id);
    return {
      id,
      name: id.charAt(0).toUpperCase() + id.slice(1),
      latitude: location?.latitude ?? null,
      longitude: location?.longitude ?? null,
    };
  });

  // Oldest to newest; for a repeated timestamp keep the most recently published reading.
  const byInstant = new Map<number, Pm25Reading>();
  for (const { item, values } of items) {
    const instant = Date.parse(item.timestamp);
    const existing = byInstant.get(instant);
    if (existing && Date.parse(existing.updatedTimestamp) >= Date.parse(item.updatedTimestamp)) continue;
    const row: Record<string, number | null> = {};
    for (const region of regions) row[region.id] = values.get(region.id) ?? null;
    byInstant.set(instant, { timestamp: item.timestamp, updatedTimestamp: item.updatedTimestamp, values: row });
  }
  const readings = [...byInstant.entries()].sort(([a], [b]) => a - b).map(([, reading]) => reading);

  return { unit: "µg/m³", regions, readings };
}

export const pm25 = defineDataset<Pm25Body, Pm25Data>({
  id: "pm25",
  title: "PM2.5",
  category: "Air quality",
  agency: "National Environment Agency (NEA)",
  datasetId: "d_e1058d6974c877257e32048ab128ad83",
  datasetPage: "https://data.gov.sg/datasets?query=pm2.5&resultId=d_e1058d6974c877257e32048ab128ad83",
  source: { kind: "realtime", path: "/pm25" },
  params: { date: validatePm25Date },
  schema: pm25BodySchema,
  mergePages(bodies) {
    const [first] = bodies;
    if (!first) throw new Error("mergePages needs at least one page");
    const metadata = new Map<string, Pm25Body["data"]["regionMetadata"][number]>();
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
  },
  normalize: normalizePm25,
  isEmpty: (data) => data.readings.length === 0,
  notFoundMessage: (params) =>
    params.date
      ? `data.gov.sg has no PM2.5 readings for ${params.date}.`
      : "data.gov.sg has no PM2.5 readings right now.",
  cacheSeconds(params, now) {
    if (!params.date) return 300;
    return params.date.slice(0, 10) === sgtDate(now) ? 300 : 86400;
  },
});
