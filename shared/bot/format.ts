import { pm25Band } from "../datasets/pm25-bands.js";
import { psiBand } from "../datasets/psi-bands.js";
import type { Region, RegionalReading } from "../datasets/regional.js";
import { formatSgtDateTime } from "../sgt.js";

/** The datasets the bot can answer about, by the id /api/data knows them by. */
export type BotDatasetId = "pm25" | "psi";

/** What the bot needs from one /api/data reply. PSI has no unit. */
export interface RegionalSnapshot {
  unit?: string;
  regions: Region[];
  readings: RegionalReading[];
}

interface Measure {
  /** Heading of every reply; PM2.5 is never called PSI. */
  title: string;
  band: (value: number | null) => { label: string; recommendation: string } | null;
}

export const MEASURES: Record<BotDatasetId, Measure> = {
  pm25: { title: "PM2.5 (1-hour)", band: pm25Band },
  psi: { title: "PSI (24-hour)", band: psiBand },
};

export const DISCLAIMER = "Data from NEA via data.gov.sg. Not medical advice.";

export const FETCH_FAILED = "I couldn't fetch that right now, please try again.";

/** The lines for one region: "Central: 185, Unhealthy" and its recommendation, or "No reading". */
function regionLines(name: string, value: number | null, unit: string | undefined, measure: Measure): string[] {
  const band = measure.band(value);
  if (value === null || band === null) return [`${name}: No reading`];
  const shown = unit ? `${value} ${unit}` : String(value);
  return [`${name}: ${shown}, ${band.label}`, band.recommendation];
}

/**
 * The reply text for the latest reading, for one region (by id) or, when regionId is null,
 * for every region in the order /api/data lists them.
 */
export function formatReading(dataset: BotDatasetId, snapshot: RegionalSnapshot, regionId: string | null): string {
  const measure = MEASURES[dataset];
  const latest = snapshot.readings.at(-1);
  if (!latest) return FETCH_FAILED;

  const regions = regionId === null ? snapshot.regions : snapshot.regions.filter((r) => r.id === regionId);
  const blocks = regions.map((r) => regionLines(r.name, latest.values[r.id] ?? null, snapshot.unit, measure).join("\n"));
  // A known region that this reply happens not to list.
  if (blocks.length === 0 && regionId !== null) {
    blocks.push(`${regionId.charAt(0).toUpperCase()}${regionId.slice(1)}: No reading`);
  }

  return [measure.title, ...blocks, `Reading for ${formatSgtDateTime(latest.timestamp)} (Singapore time)`, DISCLAIMER].join(
    "\n\n",
  );
}
