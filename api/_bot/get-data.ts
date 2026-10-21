/**
 * The bot's only way to get data: the app's own GET /api/data, the same URL the web app uses,
 * so both share Vercel's CDN cache. Nothing here imports the data.gov.sg fetching code.
 */
import { z } from "zod";
import type { BotDatasetId } from "../../shared/bot/format.js";
import type { DataResult, GetData } from "../../shared/bot/handle-command.js";
import { type BotSettings, logBot } from "./settings.js";

/** /api/data itself waits up to 10 s for data.gov.sg; this leaves it room to answer. */
export const DATA_TIMEOUT_MS = 12_000;

const replySchema = z.object({
  ok: z.literal(true),
  data: z.object({
    unit: z.string().optional(),
    regions: z.array(
      z.object({
        id: z.string(),
        name: z.string(),
        latitude: z.number().nullable(),
        longitude: z.number().nullable(),
      }),
    ),
    readings: z.array(
      z.object({
        timestamp: z.string(),
        updatedTimestamp: z.string(),
        values: z.record(z.string(), z.number().nullable()),
      }),
    ),
  }),
});

export function makeGetData(settings: BotSettings, fetchFn: typeof fetch = fetch): GetData {
  return async (dataset: BotDatasetId): Promise<DataResult> => {
    if (!settings.appBaseUrl) {
      logBot(`${dataset} not fetched: APP_BASE_URL is not set`);
      return { ok: false };
    }
    const headers: Record<string, string> = { Accept: "application/json" };
    if (settings.bypassSecret) headers["x-vercel-protection-bypass"] = settings.bypassSecret;

    let res: Response;
    try {
      res = await fetchFn(`${settings.appBaseUrl}/api/data?dataset=${dataset}`, {
        headers,
        signal: AbortSignal.timeout(DATA_TIMEOUT_MS),
      });
    } catch (error) {
      const name = error instanceof Error ? error.name : "Error";
      logBot(`${dataset} /api/data unreachable (${name})`);
      return { ok: false };
    }
    if (!res.ok) {
      logBot(`${dataset} /api/data HTTP ${res.status}`);
      return { ok: false };
    }
    let body: unknown;
    try {
      body = await res.json();
    } catch {
      logBot(`${dataset} /api/data reply is not JSON`);
      return { ok: false };
    }
    const parsed = replySchema.safeParse(body);
    if (!parsed.success) {
      logBot(`${dataset} /api/data reply has an unexpected shape`);
      return { ok: false };
    }
    return { ok: true, data: parsed.data.data };
  };
}
