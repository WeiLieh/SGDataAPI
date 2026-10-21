import { readdirSync, readFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { Readable } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import handler from "../api/telegram.js";
import { readBotSettings } from "../api/_bot/settings.js";
import { FETCH_FAILED } from "../shared/bot/format.js";
import { HELP_TEXT } from "../shared/bot/handle-command.js";
import { fixtureText, MockResponse, upstream } from "./helpers.js";

// Test values only; real ones live in Vercel's settings.
const TOKEN = "123456:test-bot-token";
const SECRET = "test-webhook-secret";
const BYPASS = "test-bypass-secret";

function update(text: string | null, chatId = 42): unknown {
  const message: Record<string, unknown> = { message_id: 1, date: 0, chat: { id: chatId, type: "private" } };
  if (text !== null) message.text = text;
  else message.photo = [{ file_id: "x" }];
  return { update_id: 1, message };
}

async function post(
  body: unknown,
  headers: Record<string, string> = { "x-telegram-bot-api-secret-token": SECRET },
  method = "POST",
): Promise<MockResponse> {
  const raw = typeof body === "string" ? body : JSON.stringify(body);
  const req = Object.assign(Readable.from([Buffer.from(raw)]), { method, url: "/api/telegram", headers });
  const res = new MockResponse();
  await handler(req as unknown as IncomingMessage, res as unknown as ServerResponse);
  return res;
}

let fetchMock: ReturnType<typeof vi.fn>;
let errorLog: ReturnType<typeof vi.spyOn>;

/** Fakes the app's own /api/data and Telegram's sendMessage. */
function routes(dataReply: () => Response | Promise<Response> = () => upstream({ ok: true, data: psiData() })) {
  fetchMock.mockImplementation(async (url: string) => {
    if (String(url).startsWith("https://api.telegram.org/")) return upstream({ ok: true, result: {} });
    return dataReply();
  });
}

function psiData(): unknown {
  // The real psi fixture, in the shape /api/data returns.
  const body = JSON.parse(fixtureText("psi-latest.json")) as {
    data: { items: Array<{ timestamp: string; updatedTimestamp: string; readings: { psi_twenty_four_hourly: unknown } }> };
  };
  const item = body.data.items.at(-1)!;
  return {
    regions: ["central", "north", "south", "east", "west"].map((id) => ({
      id,
      name: id[0]!.toUpperCase() + id.slice(1),
      latitude: 1.35,
      longitude: 103.8,
    })),
    readings: [
      { timestamp: item.timestamp, updatedTimestamp: item.updatedTimestamp, values: item.readings.psi_twenty_four_hourly },
    ],
  };
}

function telegramCalls(): Array<{ chat_id: number; text: string }> {
  return fetchMock.mock.calls
    .filter(([url]) => String(url).startsWith("https://api.telegram.org/"))
    .map(([, init]) => JSON.parse((init as RequestInit).body as string));
}

function dataCalls(): Array<[string, RequestInit]> {
  return fetchMock.mock.calls.filter(([url]) => !String(url).startsWith("https://api.telegram.org/")) as Array<
    [string, RequestInit]
  >;
}

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  vi.stubEnv("TELEGRAM_BOT_TOKEN", TOKEN);
  vi.stubEnv("TELEGRAM_WEBHOOK_SECRET", SECRET);
  vi.stubEnv("APP_BASE_URL", "https://app.test/");
  vi.stubEnv("VERCEL_URL", "");
  vi.stubEnv("VERCEL_AUTOMATION_BYPASS_SECRET", "");
  errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("POST /api/telegram: who may call it", () => {
  it("answers 405 to anything but POST, without doing anything", async () => {
    const res = await post(update("/psi"), { "x-telegram-bot-api-secret-token": SECRET }, "GET");
    expect(res.statusCode).toBe(405);
    expect(res.getHeader("allow")).toBe("POST");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("answers 401 without the secret header or with a wrong one", async () => {
    expect((await post(update("/psi"), {})).statusCode).toBe(401);
    expect((await post(update("/psi"), { "x-telegram-bot-api-secret-token": "wrong" })).statusCode).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects everything with 503 while TELEGRAM_WEBHOOK_SECRET is not set", async () => {
    vi.stubEnv("TELEGRAM_WEBHOOK_SECRET", "");
    expect((await post(update("/psi"))).statusCode).toBe(503);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("POST /api/telegram: replies", () => {
  it("gets PSI from the app's own /api/data and sends the brain's reply to the same chat", async () => {
    routes();
    const res = await post(update("/psi west", 777));
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });

    const [[url, init]] = dataCalls() as [[string, RequestInit]];
    expect(url).toBe("https://app.test/api/data?dataset=psi");
    expect(init.headers).toEqual({ Accept: "application/json" });

    const [sent] = telegramCalls();
    expect(sent?.chat_id).toBe(777);
    expect(sent?.text).toContain("West: 202, Very Unhealthy");
    expect(String(fetchMock.mock.calls.at(-1)?.[0])).toBe(`https://api.telegram.org/bot${TOKEN}/sendMessage`);
  });

  it("answers /help without touching /api/data", async () => {
    routes();
    await post(update("/help"));
    expect(dataCalls()).toHaveLength(0);
    expect(telegramCalls()[0]?.text).toBe(HELP_TEXT);
  });

  it("ignores anything that is not a plain text message, and bad JSON, with 200", async () => {
    routes();
    expect((await post(update(null))).statusCode).toBe(200);
    expect((await post({ update_id: 2, edited_message: { chat: { id: 1 }, text: "/psi" } })).statusCode).toBe(200);
    expect((await post("not json")).statusCode).toBe(200);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("apologises, still with 200, when /api/data fails, is blocked, times out or answers nonsense", async () => {
    const failures: Array<() => Response | Promise<Response>> = [
      () => upstream({ ok: false, dataset: "psi", error: { status: 502, message: "x" } }, 502),
      () => new Response("<html>Authentication Required</html>", { status: 401 }),
      () => Promise.reject(new DOMException("The operation was aborted due to timeout", "TimeoutError")),
      () => upstream({ ok: true, data: { something: "else" } }),
      () => new Response("not json", { status: 200 }),
    ];
    for (const failure of failures) {
      fetchMock.mockReset();
      routes(failure);
      const res = await post(update("/psi"));
      expect(res.statusCode).toBe(200);
      expect(telegramCalls()[0]?.text).toBe(FETCH_FAILED);
    }
  });

  it("still answers Telegram with 200 when sending the reply fails", async () => {
    fetchMock.mockImplementation(async (url: string) =>
      String(url).startsWith("https://api.telegram.org/")
        ? upstream({ ok: false, description: "Bad Request: chat not found" }, 400)
        : upstream({ ok: true, data: psiData() }),
    );
    expect((await post(update("/psi"))).statusCode).toBe(200);
    expect(errorLog).toHaveBeenCalledWith("[api/telegram] sendMessage HTTP 400");
  });

  it("does not send anything when TELEGRAM_BOT_TOKEN is not set", async () => {
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "");
    routes();
    expect((await post(update("/help"))).statusCode).toBe(200);
    expect(telegramCalls()).toHaveLength(0);
  });
});

describe("bot settings and previews", () => {
  it("uses VERCEL_URL when APP_BASE_URL is not set, and sends the preview bypass secret as a header", async () => {
    vi.stubEnv("APP_BASE_URL", "");
    vi.stubEnv("VERCEL_URL", "sg-data-api-git-telegram-bot.vercel.app");
    vi.stubEnv("VERCEL_AUTOMATION_BYPASS_SECRET", BYPASS);
    routes();
    await post(update("/psi"));
    const [[url, init]] = dataCalls() as [[string, RequestInit]];
    expect(url).toBe("https://sg-data-api-git-telegram-bot.vercel.app/api/data?dataset=psi");
    expect(init.headers).toEqual({ Accept: "application/json", "x-vercel-protection-bypass": BYPASS });
    expect(url).not.toContain(BYPASS);
  });

  it("apologises when no base URL is known at all", async () => {
    vi.stubEnv("APP_BASE_URL", "");
    routes();
    await post(update("/psi"));
    expect(dataCalls()).toHaveLength(0);
    expect(telegramCalls()[0]?.text).toBe(FETCH_FAILED);
  });

  it("trims blanks: an empty setting counts as not set", () => {
    expect(readBotSettings({ TELEGRAM_BOT_TOKEN: "  ", APP_BASE_URL: " https://a.test// " })).toEqual({
      botToken: null,
      webhookSecret: null,
      appBaseUrl: "https://a.test",
      bypassSecret: null,
    });
  });
});

describe("no secret ever leaks", () => {
  it("keeps the token and secrets out of every reply, sent message and log line", async () => {
    vi.stubEnv("VERCEL_AUTOMATION_BYPASS_SECRET", BYPASS);
    const seen: string[] = [];
    for (const [text, dataReply] of [
      ["/psi", () => upstream({ ok: true, data: psiData() })],
      ["/pm25 central", () => upstream({}, 500)],
      ["/psi", () => Promise.reject(new TypeError("fetch failed"))],
      ["/start", () => upstream({ ok: true, data: psiData() })],
    ] as const) {
      fetchMock.mockReset();
      fetchMock.mockImplementation(async (url: string) =>
        String(url).startsWith("https://api.telegram.org/") ? upstream({ ok: false }, 401) : dataReply(),
      );
      const res = await post(update(text));
      seen.push(res.body, JSON.stringify(res.headers), ...telegramCalls().map((c) => c.text));
    }
    seen.push(...errorLog.mock.calls.map((args: unknown[]) => args.join(" ")));
    const all = seen.join("\n");
    for (const secret of [TOKEN, SECRET, BYPASS]) expect(all).not.toContain(secret);
    expect(errorLog.mock.calls.length).toBeGreaterThan(0);
  });
});

describe("the bot stays separate from the data.gov.sg fetching code", () => {
  const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
  const botFiles = [
    "api/telegram.ts",
    ...readdirSync(new URL("../api/_bot/", import.meta.url)).map((f) => `api/_bot/${f}`),
    ...readdirSync(new URL("../shared/bot/", import.meta.url)).map((f) => `shared/bot/${f}`),
  ];

  it.each(botFiles)("%s imports nothing that fetches from data.gov.sg", (file) => {
    expect(read(file)).not.toMatch(/_lib\/(fetch-dataset|realtime|env|errors)/);
    expect(read(file)).not.toMatch(/datasets\/registry/);
  });

  it("keeps the brain pure: no fetch, no settings", () => {
    for (const file of botFiles.filter((f) => f.startsWith("shared/bot/"))) {
      expect(read(file)).not.toMatch(/\bfetch\(|process\.env/);
    }
  });
});
