/** Every time on screen is Singapore time, whatever the browser's time zone. */
const dateTime = new Intl.DateTimeFormat("en-SG", {
  timeZone: "Asia/Singapore",
  dateStyle: "medium",
  timeStyle: "short",
});

const dateOnly = new Intl.DateTimeFormat("en-SG", {
  timeZone: "Asia/Singapore",
  dateStyle: "long",
});

export function formatSgtDateTime(iso: string): string {
  return `${dateTime.format(new Date(iso))} SGT`;
}

export function formatSgtDate(iso: string): string {
  return dateOnly.format(new Date(iso));
}
