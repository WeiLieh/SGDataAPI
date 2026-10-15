/** Singapore is UTC+8 all year (no daylight saving), so SGT wall time is UTC plus 8 hours. */
const SGT_OFFSET_MS = 8 * 60 * 60 * 1000;

/** The current Singapore wall-clock time as "YYYY-MM-DDTHH:mm:ss". */
export function sgtDateTime(now: Date): string {
  return new Date(now.getTime() + SGT_OFFSET_MS).toISOString().slice(0, 19);
}

/** The current Singapore calendar date as "YYYY-MM-DD". */
export function sgtDate(now: Date): string {
  return sgtDateTime(now).slice(0, 10);
}
