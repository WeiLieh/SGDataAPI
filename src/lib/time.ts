/** Every time on screen is Singapore time, whatever the browser's time zone. */
export { formatSgtDateTime } from "../../shared/sgt";

const dateOnly = new Intl.DateTimeFormat("en-SG", {
  timeZone: "Asia/Singapore",
  dateStyle: "long",
});

/** "16 October 2026" in Singapore time. */
export function formatSgtDate(iso: string): string {
  return dateOnly.format(new Date(iso));
}

const HOUR_MS = 60 * 60 * 1000;

/** A reading is stale when its hour began more than this long ago. */
export const STALE_AFTER_HOURS = 2;

/** Whole hours since the reading's hour when it is stale, otherwise null. */
export function staleHours(timestamp: string, now: Date): number | null {
  const age = now.getTime() - Date.parse(timestamp);
  if (!Number.isFinite(age) || age <= STALE_AFTER_HOURS * HOUR_MS) return null;
  return Math.floor(age / HOUR_MS);
}
