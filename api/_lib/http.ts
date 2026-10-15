import type { ServerResponse } from "node:http";

/** Writes a JSON reply. Every reply from api/ goes through here, so none is ever HTML. */
export function sendJson(
  res: ServerResponse,
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): void {
  const payload = JSON.stringify(body);
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("X-Content-Type-Options", "nosniff");
  for (const [name, value] of Object.entries(headers)) res.setHeader(name, value);
  res.end(payload);
}

/** Answers 405 for anything but GET. Returns true when the request was handled. */
export function rejectNonGet(method: string | undefined, res: ServerResponse, body: unknown): boolean {
  if (method === "GET") return false;
  sendJson(res, 405, body, { Allow: "GET", "Cache-Control": "no-store" });
  return true;
}

/** Limits a message to one line of at most 200 characters. */
export function oneLine(message: string): string {
  const flat = message.replace(/\s+/g, " ").trim();
  return flat.length <= 200 ? flat : `${flat.slice(0, 199)}…`;
}
