import { readdirSync, readFileSync } from "node:fs";
import type { ContentBlock, Message, MessageParam } from "@anthropic-ai/sdk/resources/messages/messages";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { normalizePsi, psiBodySchema } from "../shared/datasets/psi.js";
import { DISCLAIMER } from "../shared/bot/format.js";
import { HELP_TEXT, type GetData } from "../shared/bot/handle-command.js";
import {
  type AskClaude,
  type ChatContext,
  type ClaudeRequest,
  DAILY_LIMIT,
  MEMORY_TURNS,
  OUTPUT_FORMAT,
} from "../shared/bot/haze-uncle.js";
import {
  NOTICE_BAN,
  NOTICE_DAILY_CAP,
  NOTICE_REDIRECT,
  NOTICE_UNAVAILABLE,
  NOTICE_WARNING,
  SYSTEM_PROMPT,
} from "../shared/bot/persona.js";
import { FORGET_DONE, FORGET_OFF, type RespondDeps, respond } from "../shared/bot/respond.js";
import type { BotStore, ChatTurn } from "../shared/bot/store.js";
import { TOOLS } from "../shared/bot/tools.js";
import { fixtureJson } from "./helpers.js";

const psi = normalizePsi(psiBodySchema.parse(fixtureJson("psi-latest.json")));
const HOUR = 60 * 60 * 1000;
const CTX: ChatContext = { channel: "telegram", chatId: "100", userId: "7" };

/** An in-memory BotStore that honours expiry against a clock the test controls. */
class FakeStore implements BotStore {
  clock = Date.parse("2026-10-21T02:00:00Z");
  seen = new Set<string>();
  mutes = new Map<string, number>();
  strikes = new Map<string, number[]>();
  daily = new Map<string, number>();
  memory = new Map<string, { turns: ChatTurn[]; until: number }>();
  failing = false;

  private check() {
    if (this.failing) throw Object.assign(new Error("down"), { name: "StoreError" });
  }
  async markUpdateSeen(key: string) {
    this.check();
    if (this.seen.has(key)) return false;
    this.seen.add(key);
    return true;
  }
  async isMuted(user: string) {
    this.check();
    return (this.mutes.get(user) ?? 0) > this.clock;
  }
  async mute(user: string, seconds: number) {
    this.check();
    this.mutes.set(user, this.clock + seconds * 1000);
  }
  async addStrike(user: string, nowMs: number, windowSeconds: number) {
    this.check();
    const kept = (this.strikes.get(user) ?? []).filter((t) => t > nowMs - windowSeconds * 1000);
    kept.push(nowMs);
    this.strikes.set(user, kept);
    return kept.length;
  }
  async countDailyUse(user: string, day: string) {
    this.check();
    const key = `${user}:${day}`;
    const n = (this.daily.get(key) ?? 0) + 1;
    this.daily.set(key, n);
    return n;
  }
  async loadHistory(chat: string) {
    this.check();
    const m = this.memory.get(chat);
    return m && m.until > this.clock ? m.turns : [];
  }
  async saveHistory(chat: string, turns: ChatTurn[], ttl: number) {
    this.check();
    this.memory.set(chat, { turns, until: this.clock + ttl * 1000 });
  }
  async clearHistory(chat: string) {
    this.check();
    this.memory.delete(chat);
  }
}

function message(content: unknown[], stop: Message["stop_reason"]): Message {
  return {
    id: "msg_test",
    type: "message",
    role: "assistant",
    model: "claude-haiku-5-5",
    content: content as ContentBlock[],
    stop_reason: stop,
    stop_sequence: null,
    usage: { input_tokens: 1, output_tokens: 1 },
  } as unknown as Message;
}
const answer = (reply: string, offTopic = false) =>
  message([{ type: "text", text: JSON.stringify({ reply, off_topic: offTopic }), citations: null }], "end_turn");
const toolCall = (name: string, region: string) =>
  message(
    [
      { type: "thinking", thinking: "", signature: "sig-1" },
      { type: "tool_use", id: "toolu_1", name, input: { region } },
    ],
    "tool_use",
  );

let store: FakeStore;
let ask: ReturnType<typeof vi.fn<AskClaude>>;
let getData: ReturnType<typeof vi.fn<GetData>>;
let logs: string[];
let onThinking: ReturnType<typeof vi.fn<() => void>>;

function deps(): RespondDeps {
  return {
    getData,
    uncle: { ask, store, now: () => new Date(store.clock), onThinking, log: (l) => logs.push(l) },
  };
}
/** Copies of each request Claude received (the brain keeps adding to one messages array). */
const requests = (): ClaudeRequest[] => ask.mock.calls.map(([r]) => structuredClone(r));

beforeEach(() => {
  store = new FakeStore();
  ask = vi.fn<AskClaude>();
  getData = vi.fn<GetData>(async () => ({ ok: true, data: psi }));
  logs = [];
  onThinking = vi.fn<() => void>();
});

describe("Haze Uncle: routing", () => {
  it("answers fixed commands without Claude, and sends plain text to Claude", async () => {
    expect((await respond("/help", CTX, deps()))?.text).toBe(HELP_TEXT);
    expect((await respond("/psi west", CTX, deps()))?.text).toContain("West: 202, Very Unhealthy");
    expect((await respond("/weather", CTX, deps()))?.text).toContain(HELP_TEXT);
    expect((await respond("   ", CTX, deps()))?.text).toBe(HELP_TEXT);
    expect(ask).not.toHaveBeenCalled();

    ask.mockResolvedValueOnce(answer("Hello hello! Ask Uncle about the haze, can?"));
    expect((await respond("hi uncle", CTX, deps()))?.text).toBe("Hello hello! Ask Uncle about the haze, can?");
    expect(onThinking).toHaveBeenCalledTimes(1);
  });

  it("answers plain text with the help text when Haze Uncle is not set up", async () => {
    const off: RespondDeps = { getData, uncle: null };
    expect((await respond("is the haze bad?", CTX, off))?.text).toBe(HELP_TEXT);
    expect((await respond("/forget", CTX, off))?.text).toBe(FORGET_OFF);
  });

  it("names HazeUncle, /forget and free questions in the help text (PB-1)", () => {
    expect(HELP_TEXT.startsWith("HazeUncle: Singapore air quality from data.gov.sg.")).toBe(true);
    expect(HELP_TEXT).toContain("/forget - clear what HazeUncle remembers of this chat");
    expect(HELP_TEXT).not.toContain("SG Weather bot");
  });
});

describe("Haze Uncle: the Claude request", () => {
  it("sends the fixed system prompt, both tools and the JSON answer format", async () => {
    ask.mockResolvedValueOnce(answer("Can lah."));
    await respond("Can I jog now?", CTX, deps());
    const [req] = requests();
    expect(req?.system).toBe(SYSTEM_PROMPT);
    expect(req?.tools.map((t) => t.name)).toEqual(["get_psi", "get_pm25"]);
    expect(req?.outputFormat).toEqual(OUTPUT_FORMAT);
    expect(req?.messages).toEqual([{ role: "user", content: "Can I jog now?" }]);
    expect(TOOLS.every((t) => t.strict === true)).toBe(true);
  });

  it("answers a tool call from /api/data, passes Claude's turn back unchanged, and adds the disclaimer", async () => {
    ask.mockResolvedValueOnce(toolCall("get_psi", "west")).mockResolvedValueOnce(answer("West PSI 202 now, Very Unhealthy leh."));
    const reply = await respond("How's the west?", CTX, deps());

    expect(getData).toHaveBeenCalledWith("psi");
    const second = requests()[1]!;
    const [, assistantTurn, toolTurn] = second.messages as [MessageParam, MessageParam, MessageParam];
    expect(assistantTurn).toEqual({ role: "assistant", content: toolCall("get_psi", "west").content });
    const result = (toolTurn.content as Array<{ type: string; content: string; is_error?: boolean }>)[0]!;
    expect(result.type).toBe("tool_result");
    expect(result.is_error).toBeUndefined();
    expect(JSON.parse(result.content)).toEqual({
      measure: "PSI (24-hour)",
      unit: null,
      reading_time_singapore: "8:00 pm, 17 Oct 2026",
      regions: [
        {
          region: "West",
          value: 202,
          band: "Very Unhealthy",
          recommendation: "Avoid prolonged or strenuous outdoor physical exertion.",
        },
      ],
    });
    expect(reply?.text).toBe(`West PSI 202 now, Very Unhealthy leh.\n\n${DISCLAIMER}`);
  });

  it("reports a failed data call to Claude as an error and adds no disclaimer", async () => {
    getData.mockResolvedValue({ ok: false });
    ask.mockResolvedValueOnce(toolCall("get_pm25", "all")).mockResolvedValueOnce(answer("Aiyo, cannot get the data now."));
    const reply = await respond("PM2.5 now?", CTX, deps());
    const toolTurn = requests()[1]!.messages[2]!;
    expect(toolTurn.content).toEqual([
      { type: "tool_result", tool_use_id: "toolu_1", content: "Could not fetch the data right now.", is_error: true },
    ]);
    expect(reply?.text).toBe("Aiyo, cannot get the data now.");
  });

  it("rejects a tool call for an unknown region without fetching", async () => {
    ask.mockResolvedValueOnce(toolCall("get_psi", "jurong")).mockResolvedValueOnce(answer("Which region ah?"));
    await respond("Jurong?", CTX, deps());
    expect(getData).not.toHaveBeenCalled();
    expect((requests()[1]!.messages[2]!.content as Array<{ is_error?: boolean }>)[0]?.is_error).toBe(true);
  });
});

describe("Haze Uncle: memory", () => {
  it("replays past exchanges as plain text and keeps only the last 10 exchanges", async () => {
    const old: ChatTurn[] = Array.from({ length: MEMORY_TURNS }, (_, i) => ({
      role: i % 2 === 0 ? "user" : "assistant",
      text: `turn ${i}`,
    }));
    await store.saveHistory("telegram:100", old, 3600);
    ask.mockResolvedValueOnce(answer("Okay."));
    await respond("next", CTX, deps());

    const sent = requests()[0]!.messages;
    expect(sent).toHaveLength(MEMORY_TURNS + 1);
    expect(sent[0]).toEqual({ role: "user", content: "turn 0" });
    const saved = await store.loadHistory("telegram:100");
    expect(saved).toHaveLength(MEMORY_TURNS);
    expect(saved.at(-2)).toEqual({ role: "user", text: "next" });
    expect(saved.at(-1)).toEqual({ role: "assistant", text: "Okay." });
  });

  it("forgets after 24 hours of silence, or at once with /forget", async () => {
    ask.mockResolvedValue(answer("Okay."));
    await respond("first", CTX, deps());
    store.clock += 25 * HOUR;
    await respond("later", CTX, deps());
    expect(requests()[1]!.messages).toEqual([{ role: "user", content: "later" }]);

    expect((await respond("/forget", CTX, deps()))?.text).toBe(FORGET_DONE);
    expect(await store.loadHistory("telegram:100")).toEqual([]);
  });

  it("keeps each chat's memory separate", async () => {
    ask.mockResolvedValue(answer("Okay."));
    await respond("in chat 100", CTX, deps());
    await respond("in chat 200", { ...CTX, chatId: "200" }, deps());
    expect(requests()[1]!.messages).toEqual([{ role: "user", content: "in chat 200" }]);
  });
});

describe("Haze Uncle: strikes, mutes and the daily cap", () => {
  it("warns on the 2nd off-topic message, bans on the 3rd, then stays silent, commands included", async () => {
    ask.mockResolvedValue(answer("Uncle only talk haze lah.", true));
    expect((await respond("tell me a joke", CTX, deps()))?.text).toBe("Uncle only talk haze lah.");
    expect((await respond("another joke", CTX, deps()))?.text).toBe(`Uncle only talk haze lah.\n\n${NOTICE_WARNING}`);
    expect((await respond("one more", CTX, deps()))?.text).toBe(NOTICE_BAN);

    ask.mockClear();
    expect(await respond("/psi", CTX, deps())).toBeNull();
    expect(await respond("sorry uncle", CTX, deps())).toBeNull();
    expect(ask).not.toHaveBeenCalled();
    // Another user is not affected.
    expect((await respond("/help", { ...CTX, userId: "8" }, deps()))?.text).toBe(HELP_TEXT);
  });

  it("lifts the mute after 24 hours", async () => {
    ask.mockResolvedValue(answer("No lah.", true));
    for (const t of ["a", "b", "c"]) await respond(t, CTX, deps());
    store.clock += 23 * HOUR;
    expect(await respond("/help", CTX, deps())).toBeNull();
    store.clock += 2 * HOUR;
    expect((await respond("/help", CTX, deps()))?.text).toBe(HELP_TEXT);
  });

  it("counts strikes over a rolling 12 hours only", async () => {
    ask.mockResolvedValue(answer("No lah.", true));
    await respond("a", CTX, deps());
    store.clock += 13 * HOUR;
    expect((await respond("b", CTX, deps()))?.text).toBe("No lah.");
    expect((await respond("c", CTX, deps()))?.text).toContain(NOTICE_WARNING);
  });

  it("does not count on-topic answers or safety refusals as strikes", async () => {
    ask.mockResolvedValueOnce(message([], "refusal"));
    expect((await respond("something odd", CTX, deps()))?.text).toBe(NOTICE_REDIRECT);
    ask.mockResolvedValue(answer("Haze okay today.", false));
    await respond("haze?", CTX, deps());
    expect(store.strikes.get("telegram:7")).toBeUndefined();
  });

  it(`stops at ${DAILY_LIMIT} Claude answers per person per Singapore day, without asking Claude`, async () => {
    ask.mockResolvedValue(answer("Okay."));
    for (let i = 0; i < DAILY_LIMIT; i++) expect((await respond(`q${i}`, CTX, deps()))?.text).toBe("Okay.");
    expect((await respond("one more", CTX, deps()))?.text).toBe(NOTICE_DAILY_CAP);
    expect(ask).toHaveBeenCalledTimes(DAILY_LIMIT);
    expect((await respond("/psi central", CTX, deps()))?.text).toContain("Central: 185");
    // Midnight in Singapore (16:00 UTC) starts a new day.
    store.clock = Date.parse("2026-10-21T16:00:00Z");
    expect((await respond("new day", CTX, deps()))?.text).toBe("Okay.");
  });
});

describe("Haze Uncle: failures", () => {
  it("gives the 'brain not working' notice when Claude fails, and logs only the status", async () => {
    ask.mockRejectedValueOnce(Object.assign(new Error("credit balance is too low"), { status: 400 }));
    expect((await respond("haze?", CTX, deps()))?.text).toBe(NOTICE_UNAVAILABLE);
    expect(logs).toEqual(["haze uncle unavailable (HTTP 400)"]);
  });

  it.each([
    ["a reply that is not JSON", message([{ type: "text", text: "Hello!", citations: null }], "end_turn")],
    ["a reply with the wrong shape", message([{ type: "text", text: '{"reply":""}', citations: null }], "end_turn")],
    ["a cut-off reply", message([{ type: "text", text: "{", citations: null }], "max_tokens")],
  ])("gives the same notice for %s, and saves nothing", async (_label, bad) => {
    ask.mockResolvedValueOnce(bad);
    expect((await respond("haze?", CTX, deps()))?.text).toBe(NOTICE_UNAVAILABLE);
    expect(await store.loadHistory("telegram:100")).toEqual([]);
  });

  it("stops after 4 rounds of tool calls", async () => {
    ask.mockResolvedValue(toolCall("get_psi", "all"));
    expect((await respond("haze?", CTX, deps()))?.text).toBe(NOTICE_UNAVAILABLE);
    expect(ask).toHaveBeenCalledTimes(4);
  });

  it("gives the notice when the store is down, but fixed commands still work", async () => {
    store.failing = true;
    expect((await respond("haze?", CTX, deps()))?.text).toBe(NOTICE_UNAVAILABLE);
    expect((await respond("/psi north", CTX, deps()))?.text).toContain("North: 131, Unhealthy");
    expect(ask).not.toHaveBeenCalled();
  });
});

describe("Haze Uncle: the owner's notices and the brain's purity", () => {
  it("uses the owner's notice texts, tidied", () => {
    expect(NOTICE_DAILY_CAP).toBe(
      "Wah, you ask Uncle 30 questions today already! Uncle need to rest his voice liao. Come back tomorrow lah hor? /psi and /pm25 still can use anytime.",
    );
    expect(NOTICE_UNAVAILABLE).toBe(
      "Aiyo, Uncle’s brain now not working. Try again later, can? Meanwhile /psi and /pm25 still working.",
    );
    expect(NOTICE_BAN).toContain("three times liao");
    expect(NOTICE_WARNING).toContain("Uncle go away for one whole day");
  });

  it("keeps the system prompt free of anything that changes per request", () => {
    expect(SYSTEM_PROMPT).not.toMatch(/\d{4}-\d{2}-\d{2}/);
  });

  it("imports the Anthropic SDK in shared/bot only for types", () => {
    const dir = new URL("../shared/bot/", import.meta.url);
    for (const file of readdirSync(dir)) {
      const source = readFileSync(new URL(file, dir), "utf8");
      const imports = source.matchAll(/import\s+(type\s+)?[^;]*?from\s+"@anthropic-ai\/sdk[^"]*"/gs);
      for (const [statement, typeOnly] of imports) expect(typeOnly, `${file}: ${statement}`).toBeDefined();
    }
  });
});
