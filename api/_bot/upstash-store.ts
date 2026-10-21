/**
 * Haze Uncle's memory, strikes, mutes and daily counts in Upstash Redis, through its REST API
 * with plain fetch (no extra package). Every key expires on its own. Errors never include the
 * store's address or token.
 */
import { z } from "zod";
import type { BotStore, ChatTurn } from "../../shared/bot/store.js";

export const STORE_TIMEOUT_MS = 5_000;
const SEEN_SECONDS = 60 * 60;
const DAILY_KEY_SECONDS = 2 * 24 * 60 * 60;
const PREFIX = "hazeuncle";

const turnsSchema = z.array(z.object({ role: z.enum(["user", "assistant"]), text: z.string() }));
const pipelineSchema = z.array(z.object({ result: z.unknown().optional(), error: z.string().optional() }));

export class StoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StoreError";
  }
}

type Command = Array<string | number>;

export function makeUpstashStore(url: string, token: string, fetchFn: typeof fetch = fetch): BotStore {
  const base = url.replace(/\/+$/, "");

  /** Runs several commands in one request and returns each result in order. */
  async function pipeline(commands: Command[]): Promise<unknown[]> {
    let res: Response;
    try {
      res = await fetchFn(`${base}/pipeline`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify(commands.map((c) => c.map(String))),
        signal: AbortSignal.timeout(STORE_TIMEOUT_MS),
      });
    } catch (error) {
      throw new StoreError(`store unreachable (${error instanceof Error ? error.name : "Error"})`);
    }
    if (!res.ok) throw new StoreError(`store HTTP ${res.status}`);
    const parsed = pipelineSchema.safeParse(await res.json().catch(() => null));
    if (!parsed.success || parsed.data.length !== commands.length) throw new StoreError("store reply has an unexpected shape");
    if (parsed.data.some((r) => r.error !== undefined)) throw new StoreError("store command failed");
    return parsed.data.map((r) => r.result);
  }

  const one = async (command: Command) => (await pipeline([command]))[0];

  return {
    async markUpdateSeen(key) {
      return (await one(["SET", `${PREFIX}:seen:${key}`, "1", "NX", "EX", SEEN_SECONDS])) === "OK";
    },
    async isMuted(userKey) {
      return Number(await one(["EXISTS", `${PREFIX}:mute:${userKey}`])) === 1;
    },
    async mute(userKey, seconds) {
      await one(["SET", `${PREFIX}:mute:${userKey}`, "1", "EX", seconds]);
    },
    async addStrike(userKey, nowMs, windowSeconds) {
      const key = `${PREFIX}:strikes:${userKey}`;
      const results = await pipeline([
        ["ZREMRANGEBYSCORE", key, "-inf", nowMs - windowSeconds * 1000],
        ["ZADD", key, nowMs, `${nowMs}-${Math.random().toString(36).slice(2)}`],
        ["ZCARD", key],
        ["EXPIRE", key, windowSeconds],
      ]);
      return Number(results[2]);
    },
    async countDailyUse(userKey, day) {
      const key = `${PREFIX}:daily:${userKey}:${day}`;
      const results = await pipeline([["INCR", key], ["EXPIRE", key, DAILY_KEY_SECONDS]]);
      return Number(results[0]);
    },
    async loadHistory(chatKey) {
      const raw = await one(["GET", `${PREFIX}:memory:${chatKey}`]);
      if (typeof raw !== "string") return [];
      try {
        const parsed = turnsSchema.safeParse(JSON.parse(raw));
        return parsed.success ? (parsed.data as ChatTurn[]) : [];
      } catch {
        return [];
      }
    },
    async saveHistory(chatKey, turns, ttlSeconds) {
      await one(["SET", `${PREFIX}:memory:${chatKey}`, JSON.stringify(turns), "EX", ttlSeconds]);
    },
    async clearHistory(chatKey) {
      await one(["DEL", `${PREFIX}:memory:${chatKey}`]);
    },
  };
}
