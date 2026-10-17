import type { PsiReading } from "../../shared/datasets/psi";

const HOUR_MS = 60 * 60 * 1000;

/** The PSI screen shows the latest hour plus the 11 hours before it. */
export const PSI_HOURS = 12;

export interface PsiHourRow {
  /** The hour this row covers (ISO, as data.gov.sg wrote it when present). */
  timestamp: string;
  /** null when data.gov.sg has no reading for this hour (shown as "No reading"). */
  reading: PsiReading | null;
}

/**
 * The 12 clock hours ending at the latest reading, newest first. A missing hour keeps its row
 * with reading null, so a gap is visible instead of being skipped.
 */
export function psiHourRows(readings: PsiReading[], hours = PSI_HOURS): PsiHourRow[] {
  const latest = readings.at(-1);
  if (!latest) return [];
  const byInstant = new Map(readings.map((r) => [Date.parse(r.timestamp), r]));
  const end = Date.parse(latest.timestamp);
  return Array.from({ length: hours }, (_, i) => {
    const instant = end - i * HOUR_MS;
    const reading = byInstant.get(instant) ?? null;
    return { timestamp: reading?.timestamp ?? new Date(instant).toISOString(), reading };
  });
}

/** True when the latest hour is so early in its SGT day that the 12 hours reach into yesterday. */
export function needsPreviousDay(latestTimestamp: string, hours = PSI_HOURS): boolean {
  // SGT is UTC+8 with no daylight saving.
  const sgtHour = new Date(Date.parse(latestTimestamp) + 8 * HOUR_MS).getUTCHours();
  return sgtHour < hours - 1;
}
