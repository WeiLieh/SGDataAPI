import { z } from "zod";
import {
  dailyCacheSeconds,
  mergeRegionalPages,
  normalizeRegional,
  regionalBodySchema,
  regionValuesSchema,
  validateSgtDate,
  type Region,
  type RegionalReading,
} from "./regional.js";
import { defineDataset } from "./types.js";

/** Validates the optional `date` parameter (shared with every regional dataset). */
export const validatePm25Date = validateSgtDate;

export const pm25BodySchema = regionalBodySchema(z.object({ pm25_one_hourly: regionValuesSchema }));

export type Pm25Body = z.infer<typeof pm25BodySchema>;
export type Pm25Region = Region;
export type Pm25Reading = RegionalReading;

export interface Pm25Data {
  unit: "µg/m³";
  regions: Pm25Region[];
  readings: Pm25Reading[];
}

export function normalizePm25(body: Pm25Body): Pm25Data {
  return { unit: "µg/m³", ...normalizeRegional(body, (readings) => readings.pm25_one_hourly) };
}

export const pm25 = defineDataset<Pm25Body, Pm25Data>({
  id: "pm25",
  title: "PM2.5",
  category: "Air quality",
  agency: "National Environment Agency (NEA)",
  datasetId: "d_e1058d6974c877257e32048ab128ad83",
  datasetPage: "https://data.gov.sg/datasets?query=pm2.5&resultId=d_e1058d6974c877257e32048ab128ad83",
  source: { kind: "realtime", path: "/pm25" },
  params: { date: validateSgtDate },
  schema: pm25BodySchema,
  mergePages: mergeRegionalPages,
  normalize: normalizePm25,
  isEmpty: (data) => data.readings.length === 0,
  notFoundMessage: (params) =>
    params.date
      ? `data.gov.sg has no PM2.5 readings for ${params.date}.`
      : "data.gov.sg has no PM2.5 readings right now.",
  cacheSeconds: dailyCacheSeconds,
});
