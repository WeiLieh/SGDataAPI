import { readFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";

export function fixtureText(name: string): string {
  return readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");
}

export function fixtureJson<T = unknown>(name: string): T {
  return JSON.parse(fixtureText(name)) as T;
}

/** Captures what a handler writes, standing in for node:http's ServerResponse. */
export class MockResponse {
  statusCode = 200;
  headers: Record<string, string> = {};
  body = "";
  ended = false;

  setHeader(name: string, value: string | number): this {
    this.headers[name.toLowerCase()] = String(value);
    return this;
  }

  getHeader(name: string): string | undefined {
    return this.headers[name.toLowerCase()];
  }

  end(chunk?: string): this {
    this.body = chunk ?? "";
    this.ended = true;
    return this;
  }

  json<T = any>(): T {
    return JSON.parse(this.body) as T;
  }
}

type Handler = (req: IncomingMessage, res: ServerResponse) => Promise<void>;

export async function call(handler: Handler, url: string, method = "GET"): Promise<MockResponse> {
  const req = { method, url, headers: {} } as unknown as IncomingMessage;
  const res = new MockResponse();
  await handler(req, res as unknown as ServerResponse);
  if (!res.ended) throw new Error("handler did not end the response");
  return res;
}

export function upstream(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  return new Response(text, { status, headers: { "content-type": "application/json", ...headers } });
}

/** A PM2.5 success body with the given items, optionally carrying a paginationToken. */
export function pm25Page(
  items: Array<{ timestamp: string; updatedTimestamp?: string; values: Record<string, number> }>,
  paginationToken?: string,
): unknown {
  const latest = fixtureJson<{ data: { regionMetadata: unknown[] } }>("pm25-latest.json");
  return {
    code: 0,
    data: {
      regionMetadata: latest.data.regionMetadata,
      items: items.map((item) => ({
        date: item.timestamp.slice(0, 10),
        timestamp: item.timestamp,
        updatedTimestamp: item.updatedTimestamp ?? item.timestamp,
        readings: { pm25_one_hourly: item.values },
      })),
      ...(paginationToken ? { paginationToken } : {}),
    },
    errorMsg: "",
  };
}
