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

/**
 * The PSI reply carries twelve series per region. Only psi_twenty_four_hourly is used (the owner
 * chose no pollutant measurements and no sub-indices); the others are optional so a reply that
 * drops one still parses. The spec's psi_three_hourly does not appear in real replies.
 */
const psiReadingsSchema = z.object({
  psi_twenty_four_hourly: regionValuesSchema,
  psi_three_hourly: regionValuesSchema.optional(),
  pm25_twenty_four_hourly: regionValuesSchema.optional(),
  pm10_twenty_four_hourly: regionValuesSchema.optional(),
  so2_twenty_four_hourly: regionValuesSchema.optional(),
  no2_one_hour_max: regionValuesSchema.optional(),
  co_eight_hour_max: regionValuesSchema.optional(),
  o3_eight_hour_max: regionValuesSchema.optional(),
  co_sub_index: regionValuesSchema.optional(),
  o3_sub_index: regionValuesSchema.optional(),
  pm10_sub_index: regionValuesSchema.optional(),
  pm25_sub_index: regionValuesSchema.optional(),
  so2_sub_index: regionValuesSchema.optional(),
});

export const psiBodySchema = regionalBodySchema(psiReadingsSchema);

export type PsiBody = z.infer<typeof psiBodySchema>;
export type PsiRegion = Region;
export type PsiReading = RegionalReading;

/** 24-hour PSI per region. PSI is an index value with no unit. */
export interface PsiData {
  regions: PsiRegion[];
  readings: PsiReading[];
}

export function normalizePsi(body: PsiBody): PsiData {
  return normalizeRegional(body, (readings) => readings.psi_twenty_four_hourly);
}

export const psi = defineDataset<PsiBody, PsiData>({
  id: "psi",
  title: "PSI",
  category: "Air quality",
  agency: "National Environment Agency (NEA)",
  datasetId: "d_fe37906a0182569d891506e815e819b7",
  datasetPage: "https://data.gov.sg/datasets?query=psi&resultId=d_fe37906a0182569d891506e815e819b7",
  source: { kind: "realtime", path: "/psi" },
  params: { date: validateSgtDate },
  schema: psiBodySchema,
  mergePages: mergeRegionalPages,
  normalize: normalizePsi,
  isEmpty: (data) => data.readings.length === 0,
  notFoundMessage: (params) =>
    params.date ? `data.gov.sg has no PSI readings for ${params.date}.` : "data.gov.sg has no PSI readings right now.",
  cacheSeconds: dailyCacheSeconds,
});
