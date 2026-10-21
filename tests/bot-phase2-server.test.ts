import type { IncomingMessage, ServerResponse } from "node:http";
import { Readable } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import handler from "../api/telegram.js";
import { CLAUDE_MODEL, makeAskClaude } from "../api/_bot/claude.js";
import { makeUpstashStore } from "../api/_bot/upstash-store.js";
import { NOTICE_BAN } from "../shared/bot/persona.js";
import { fixtureText, MockResponse, upstream } from "./helpers.js";

// Test values only; real ones live in Vercel's settings.
const TOKEN = "123456:test-bot-token";
const SECRET = "test-webhook-secret";
const CLAUDE_KEY = "sk-ant-test-key";
const STORE_URL = "https://store.test";
const STORE_TOKEN = "test-store-token";

/** A tiny stand-in for Upstash's REST pipeline: enough commands for the bot. */
function fakeUpstash() {
  const data = new Map<string, string>();
  const zsets = new Map<string, Map<string, number>>();
  const calls: string[][][] = [];
  const handle = (cmd: string[]): unknown => {
    const [name, key = "", ...args] = cmd;
    switch (name) {
      case "SET": {
        if (args.includes("NX") && data.has(key)) return null;
        data.set(key, args[0] ?? "");
        return "OK";
      }
      case "GET":
        return data.get(key) ?? null;
      case "EXISTS":
        return data.has(key) ? 1 : 0;
      case "DEL":
        return data.delete(key) ? 1 : 0;
      case "INCR": {
        const n = Number(data.get(key) ?? "0") + 1;
        data.set(key, String(n));
        return n;
      }
      case "EXPIRE":
        return 1;
      case "ZREMRANGEBYSCORE": {
        const z = zsets.get(key);
        if (z) for (const [m, s] of z) if (s <= Number(args[1])) z.delete(m);
        return 0;
      }
      case "ZADD": {
        const z = zsets.get(key) ?? new Map<string, number>();
        z.set(args[1] ?? "", Number(args[0]));
        zsets.set(key, z);
        return 1;
      }
      case "ZCARD":
        return zsets.get(key)?.size ?? 0;
      default:
        throw new Error(`unexpected command ${name}`);
    }
  };
  const fetchFn = vi.fn(async (_url: string, init?: RequestInit) => {
    const commands = JSON.parse(String(init?.body)) as string[][];
    calls.push(commands);
    return upstream(commands.map((c) => ({ result: handle(c) })));
  });
  return { data, calls, fetchFn };
}

describe("Upstash store", () => {
  it("sends commands to /pipeline with the token as a bearer header, and parses the replies", async () => {
    const fake = fakeUpstash();
    const store = makeUpstashStore(`${STORE_URL}/`, STORE_TOKEN, fake.fetchFn as unknown as typeof fetch);

    expect(await store.markUpdateSeen("telegram:1")).toBe(true);
    expect(await store.markUpdateSeen("telegram:1")).toBe(false);
    expect(await store.countDailyUse("telegram:7", "2026-10-21")).toBe(1);
    expect(await store.countDailyUse("telegram:7", "2026-10-21")).toBe(2);
    expect(await store.addStrike("telegram:7", 1_000_000, 60)).toBe(1);
    expect(await store.addStrike("telegram:7", 1_030_000, 60)).toBe(2);
    expect(await store.addStrike("telegram:7", 1_065_000, 60)).toBe(2); // the first is now over a minute old
    await store.mute("telegram:7", 86400);
    expect(await store.isMuted("telegram:7")).toBe(true);
    await store.saveHistory("telegram:100", [{ role: "user", text: "hi" }], 86400);
    expect(await store.loadHistory("telegram:100")).toEqual([{ role: "user", text: "hi" }]);
    await store.clearHistory("telegram:100");
    expect(await store.loadHistory("telegram:100")).toEqual([]);

    const [url, init] = fake.fetchFn.mock.calls[0]!;
    expect(url).toBe("https://store.test/pipeline");
    expect((init?.headers as Record<string, string>).Authorization).toBe(`Bearer ${STORE_TOKEN}`);
    expect(fake.calls[0]).toEqual([["SET", "hazeuncle:seen:telegram:1", "1", "NX", "EX", "3600"]]);
    expect(fake.calls.flat().every((c) => c.every((part) => typeof part === "string"))).toBe(true);
  });

  it("gives every key an expiry", async () => {
    const fake = fakeUpstash();
    const store = makeUpstashStore(STORE_URL, STORE_TOKEN, fake.fetchFn as unknown as typeof fetch);
    await store.countDailyUse("u", "2026-10-21");
    await store.addStrike("u", 1, 43200);
    await store.mute("u", 86400);
    await store.saveHistory("c", [], 86400);
    await store.markUpdateSeen("k");
    const writes = fake.calls.flat().filter((c) => ["SET", "INCR", "ZADD"].includes(c[0]!));
    for (const w of writes) {
      const key = w[1];
      const hasEx = w.includes("EX");
      const expired = fake.calls.flat().some((c) => c[0] === "EXPIRE" && c[1] === key);
      expect(hasEx || expired, key).toBe(true);
    }
  });

  it("reads bad stored memory as empty, and throws errors that never mention the address or token", async () => {
    const fake = fakeUpstash();
    const store = makeUpstashStore(STORE_URL, STORE_TOKEN, fake.fetchFn as unknown as typeof fetch);
    fake.data.set("hazeuncle:memory:c", "not json");
    expect(await store.loadHistory("c")).toEqual([]);

    for (const reply of [
      () => Promise.resolve(upstream({}, 401)),
      () => Promise.resolve(upstream([{ error: "WRONGTYPE" }])),
      () => Promise.reject(new TypeError("fetch failed")),
    ]) {
      const broken = makeUpstashStore(STORE_URL, STORE_TOKEN, reply as unknown as typeof fetch);
      const error = await broken.isMuted("u").catch((e: Error) => e);
      expect(error).toBeInstanceOf(Error);
      expect(String((error as Error).message)).not.toMatch(/store\.test|test-store-token/);
    }
  });
});

describe("Claude caller", () => {
  it("uses claude-haiku-5-5 at medium effort with caching, and passes the brain's request through", async () => {
    const create = vi.fn(async () => ({ id: "m" }));
    const ask = makeAskClaude("unused", { messages: { create } } as never);
    await ask({ system: "S", tools: [], messages: [{ role: "user", content: "hi" }], outputFormat: { type: "json_schema", schema: {} } });
    expect(create).toHaveBeenCalledWith({
      model: "claude-haiku-5-5",
      max_tokens: 4000,
      output_config: { effort: "medium", format: { type: "json_schema", schema: {} } },
      cache_control: { type: "ephemeral" },
      system: "S",
      tools: [],
      messages: [{ role: "user", content: "hi" }],
    });
    expect(CLAUDE_MODEL).toBe("claude-haiku-5-5");
  });
});

describe("POST /api/telegram with Haze Uncle switched on", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let errorLog: ReturnType<typeof vi.spyOn>;
  let fake: ReturnType<typeof fakeUpstash>;
  let claudeReplies: Array<{ reply: string; off_topic: boolean }>;

  function update(text: string, updateId: number, from = 7): unknown {
    return { update_id: updateId, message: { message_id: 1, date: 0, chat: { id: 100, type: "private" }, from: { id: from }, text } };
  }
  async function post(body: unknown): Promise<MockResponse> {
    const req = Object.assign(Readable.from([Buffer.from(JSON.stringify(body))]), {
      method: "POST",
      url: "/api/telegram",
      headers: { "x-telegram-bot-api-secret-token": SECRET },
    });
    const res = new MockResponse();
    await handler(req as unknown as IncomingMessage, res as unknown as ServerResponse);
    return res;
  }
  const telegramCalls = (method: string) =>
    fetchMock.mock.calls
      .filter(([url]) => String(url).startsWith(`https://api.telegram.org/bot${TOKEN}/${method}`))
      .map(([, init]) => JSON.parse((init as RequestInit).body as string));
  const claudeCalls = () => fetchMock.mock.calls.filter(([url]) => String(url).includes("api.anthropic.com"));

  beforeEach(() => {
    fake = fakeUpstash();
    claudeReplies = [];
    fetchMock = vi.fn(async (input: unknown, init?: RequestInit) => {
      const url = input instanceof Request ? input.url : String(input);
      if (url.startsWith(STORE_URL)) return fake.fetchFn(url, init);
      if (url.startsWith("https://api.telegram.org/")) return upstream({ ok: true, result: true });
      if (url.includes("api.anthropic.com")) {
        const next = claudeReplies.shift() ?? { reply: "Okay lah.", off_topic: false };
        return upstream({
          id: "msg_1",
          type: "message",
          role: "assistant",
          model: "claude-haiku-5-5",
          content: [{ type: "text", text: JSON.stringify(next) }],
          stop_reason: "end_turn",
          stop_sequence: null,
          usage: { input_tokens: 10, output_tokens: 5 },
        });
      }
      if (url.startsWith("https://app.test/api/data")) {
        return upstream({ ok: true, data: { regions: [], readings: [] } });
      }
      throw new Error(`unexpected fetch ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("TELEGRAM_BOT_TOKEN", TOKEN);
    vi.stubEnv("TELEGRAM_WEBHOOK_SECRET", SECRET);
    vi.stubEnv("APP_BASE_URL", "https://app.test");
    vi.stubEnv("ANTHROPIC_API_KEY", CLAUDE_KEY);
    vi.stubEnv("KV_REST_API_URL", STORE_URL);
    vi.stubEnv("KV_REST_API_TOKEN", STORE_TOKEN);
    errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("shows typing, asks Claude, and sends Haze Uncle's reply", async () => {
    claudeReplies.push({ reply: "Haze not bad today lah.", off_topic: false });
    expect((await post(update("how's the haze?", 1))).statusCode).toBe(200);
    expect(telegramCalls("sendChatAction")).toEqual([{ chat_id: 100, action: "typing" }]);
    expect(telegramCalls("sendMessage")).toEqual([{ chat_id: 100, text: "Haze not bad today lah." }]);
    expect(claudeCalls()).toHaveLength(1);
  });

  it("answers a repeated update only once", async () => {
    await post(update("/help", 5));
    await post(update("/help", 5));
    expect(telegramCalls("sendMessage")).toHaveLength(1);
  });

  it("bans after three off-topic messages and then stays silent", async () => {
    claudeReplies.push(...Array.from({ length: 3 }, () => ({ reply: "Only haze lah.", off_topic: true })));
    for (let i = 1; i <= 3; i++) await post(update(`joke ${i}`, i));
    expect(telegramCalls("sendMessage").at(-1)?.text).toBe(NOTICE_BAN);
    await post(update("/psi", 4));
    expect(telegramCalls("sendMessage")).toHaveLength(3);
  });

  it("never puts the Claude key, store token, bot token or webhook secret in a reply or log", async () => {
    claudeReplies.push({ reply: "Okay.", off_topic: false });
    await post(update("haze?", 1));
    fetchMock.mockImplementation(async () => {
      throw new TypeError("fetch failed");
    });
    await post(update("haze again?", 2));
    const seen = [
      ...fetchMock.mock.calls
        .filter(([url]) => String(url).startsWith("https://api.telegram.org/"))
        .map(([, init]) => String((init as RequestInit).body)),
      ...errorLog.mock.calls.map((args: unknown[]) => args.join(" ")),
    ].join("\n");
    for (const secret of [CLAUDE_KEY, STORE_TOKEN, TOKEN, SECRET]) expect(seen).not.toContain(secret);
  });

  it("uses the real psi fixture end to end through a tool call", async () => {
    const body = JSON.parse(fixtureText("psi-latest.json")) as {
      data: { items: Array<{ timestamp: string; updatedTimestamp: string; readings: { psi_twenty_four_hourly: Record<string, number> } }> };
    };
    const item = body.data.items.at(-1)!;
    let round = 0;
    fetchMock.mockImplementation(async (input: unknown, init?: RequestInit) => {
      const url = input instanceof Request ? input.url : String(input);
      if (url.startsWith(STORE_URL)) return fake.fetchFn(url, init);
      if (url.startsWith("https://api.telegram.org/")) return upstream({ ok: true, result: true });
      if (url.startsWith("https://app.test/api/data")) {
        return upstream({
          ok: true,
          data: {
            regions: [{ id: "west", name: "West", latitude: 1.35, longitude: 103.7 }],
            readings: [{ timestamp: item.timestamp, updatedTimestamp: item.updatedTimestamp, values: item.readings.psi_twenty_four_hourly }],
          },
        });
      }
      round++;
      const content =
        round === 1
          ? [{ type: "tool_use", id: "toolu_1", name: "get_psi", input: { region: "west" } }]
          : [{ type: "text", text: JSON.stringify({ reply: "West is 202, Very Unhealthy. Stay inside lah.", off_topic: false }) }];
      return upstream({
        id: `msg_${round}`,
        type: "message",
        role: "assistant",
        model: "claude-haiku-5-5",
        content,
        stop_reason: round === 1 ? "tool_use" : "end_turn",
        stop_sequence: null,
        usage: { input_tokens: 10, output_tokens: 5 },
      });
    });
    await post(update("west how?", 9));
    expect(telegramCalls("sendMessage")[0]?.text).toBe(
      "West is 202, Very Unhealthy. Stay inside lah.\n\nData from NEA via data.gov.sg. Not medical advice.",
    );
  });
});
