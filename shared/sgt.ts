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

/** Shared by the web app and the chat bot, so both show times the same way. */
const sgtParts = new Intl.DateTimeFormat("en-SG", {
  timeZone: "Asia/Singapore",
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
  day: "numeric",
  month: "short",
  year: "numeric",
});

/** "9:00 pm, 16 Oct 2026" in Singapore time. */
export function formatSgtDateTime(iso: string): string {
  const p: Record<string, string> = {};
  for (const { type, value } of sgtParts.formatToParts(new Date(iso))) p[type] = value;
  const period = (p.dayPeriod ?? "").toLowerCase();
  return `${p.hour}:${p.minute} ${period}, ${p.day} ${p.month} ${p.year}`;
}
