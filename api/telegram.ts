/**
 * POST /api/telegram: the Telegram webhook. A thin adapter: it checks the request really comes
 * from Telegram, takes the text out, asks the brain (shared/bot) for a reply and sends it back.
 * Everything Telegram-specific lives here and in api/_bot/telegram-api.ts.
 */
import { createHash, timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { z } from "zod";
import { commandOf } from "../shared/bot/handle-command.js";
import { type RespondDeps, respond } from "../shared/bot/respond.js";
import type { BotStore } from "../shared/bot/store.js";
import { makeAskClaude } from "./_bot/claude.js";
import { makeGetData } from "./_bot/get-data.js";
import { type BotSettings, logBot, readBotSettings } from "./_bot/settings.js";
import { sendTelegramMessage, sendTypingAction } from "./_bot/telegram-api.js";
import { makeUpstashStore } from "./_bot/upstash-store.js";
import { sendJson } from "./_lib/http.js";

const MAX_BODY_BYTES = 1_000_000;
const SECRET_HEADER = "x-telegram-bot-api-secret-token";

/** Only plain text messages are answered; anything else (photos, stickers, edits...) is ignored. */
const textMessageSchema = z.object({
  update_id: z.number(),
  message: z.object({
    chat: z.object({ id: z.number() }),
    from: z.object({ id: z.number() }).optional(),
    text: z.string(),
  }),
});

function makeStore(settings: BotSettings): BotStore | null {
  return settings.storeUrl && settings.storeToken ? makeUpstashStore(settings.storeUrl, settings.storeToken) : null;
}

/** Compares in constant time, so the secret can't be guessed from response timing. */
function secretMatches(given: string | string[] | undefined, expected: string): boolean {
  if (typeof given !== "string") return false;
  const a = createHash("sha256").update(given).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

/** The update as JSON, or null when it is missing, too big or not JSON. */
async function readUpdate(req: IncomingMessage): Promise<unknown> {
  try {
    // On Vercel the body may already be parsed onto req.body.
    const preParsed = (req as { body?: unknown }).body;
    if (preParsed !== undefined && preParsed !== null) {
      if (typeof preParsed === "string") return JSON.parse(preParsed);
      if (Buffer.isBuffer(preParsed)) return JSON.parse(preParsed.toString("utf8"));
      return preParsed;
    }
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of req) {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string);
      size += buf.length;
      if (size > MAX_BODY_BYTES) return null;
      chunks.push(buf);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    return null;
  }
}

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== "POST") {
    sendJson(res, 405, { ok: false }, { Allow: "POST", "Cache-Control": "no-store" });
    return;
  }

  const settings = readBotSettings();
  if (!settings.webhookSecret) {
    logBot("rejected a request: TELEGRAM_WEBHOOK_SECRET is not set");
    sendJson(res, 503, { ok: false }, { "Cache-Control": "no-store" });
    return;
  }
  if (!secretMatches(req.headers[SECRET_HEADER], settings.webhookSecret)) {
    sendJson(res, 401, { ok: false }, { "Cache-Control": "no-store" });
    return;
  }

  // From here on Telegram always gets 200, so it never retries an update.
  try {
    const parsed = textMessageSchema.safeParse(await readUpdate(req));
    if (parsed.success) {
      const { update_id: updateId, message } = parsed.data;
      const { chat, text } = message;
      const token = settings.botToken;
      const store = makeStore(settings);

      // Telegram re-sends an update it thinks was lost; answer each one only once.
      let firstTime = true;
      if (store) {
        try {
          firstTime = await store.markUpdateSeen(`telegram:${updateId}`);
        } catch (error) {
          logBot(`duplicate check failed (${error instanceof Error ? error.name : "Error"})`);
        }
      }

      if (firstTime) {
        const uncleReady = Boolean(settings.anthropicApiKey && store);
        if (!uncleReady && !commandOf(text).startsWith("/")) {
          logBot(`Haze Uncle is off: ${settings.anthropicApiKey ? "" : "ANTHROPIC_API_KEY "}${store ? "" : "store "}not set`);
        }
        const deps: RespondDeps = {
          getData: makeGetData(settings),
          uncle:
            uncleReady && store && settings.anthropicApiKey
              ? {
                  ask: makeAskClaude(settings.anthropicApiKey),
                  store,
                  now: () => new Date(),
                  onThinking: token ? () => sendTypingAction(token, chat.id) : undefined,
                  log: logBot,
                }
              : null,
        };
        const ctx = { channel: "telegram", chatId: String(chat.id), userId: String(message.from?.id ?? chat.id) };
        const reply = await respond(text, ctx, deps);
        if (reply === null) {
          // A muted user: stay silent.
        } else if (token) {
          await sendTelegramMessage(token, chat.id, reply.text);
        } else {
          logBot("reply not sent: TELEGRAM_BOT_TOKEN is not set");
        }
      }
    }
  } catch (error) {
    const name = error instanceof Error ? error.name : "Error";
    logBot(`unexpected error (${name})`);
  }
  sendJson(res, 200, { ok: true }, { "Cache-Control": "no-store" });
}
