/**
 * Haze Uncle: everything that isn't a fixed command. Pure like the rest of the brain: Claude,
 * the store and the data all come in through `deps`, so it never fetches or reads settings.
 */
import type {
  JSONOutputFormat,
  Message,
  MessageParam,
  Tool,
  ToolResultBlockParam,
} from "@anthropic-ai/sdk/resources/messages/messages";
import { z } from "zod";
import { sgtDate } from "../sgt.js";
import { DISCLAIMER } from "./format.js";
import type { BotReply, GetData } from "./handle-command.js";
import {
  NOTICE_BAN,
  NOTICE_DAILY_CAP,
  NOTICE_REDIRECT,
  NOTICE_UNAVAILABLE,
  NOTICE_WARNING,
  SYSTEM_PROMPT,
} from "./persona.js";
import type { BotStore, ChatTurn } from "./store.js";
import { runTool, TOOLS } from "./tools.js";

export const DAILY_LIMIT = 30;
export const MEMORY_TURNS = 20; // the last 10 exchanges
export const MEMORY_TTL_SECONDS = 24 * 60 * 60;
export const STRIKE_WINDOW_SECONDS = 12 * 60 * 60;
export const MUTE_SECONDS = 24 * 60 * 60;
/** Most model calls in one answer (each tool round is one call). */
export const MAX_ROUNDS = 4;

/** One Claude request: everything but the model settings, which api/_bot/claude.ts owns. */
export interface ClaudeRequest {
  system: string;
  tools: Tool[];
  messages: MessageParam[];
  outputFormat: JSONOutputFormat;
}

/** Sends one request to Claude. Throws when the API call fails. */
export type AskClaude = (request: ClaudeRequest) => Promise<Message>;

export interface UncleDeps {
  ask: AskClaude;
  store: BotStore;
  getData: GetData;
  now: () => Date;
  /** Called just before Claude is asked, so the chat app can show "typing...". */
  onThinking?: () => void | Promise<void>;
  log: (line: string) => void;
}

/** Who wrote and where; keys are prefixed with the chat app so WhatsApp could share the store. */
export interface ChatContext {
  channel: string;
  chatId: string;
  userId: string;
}

export const OUTPUT_FORMAT: JSONOutputFormat = {
  type: "json_schema",
  schema: {
    type: "object",
    properties: { reply: { type: "string" }, off_topic: { type: "boolean" } },
    required: ["reply", "off_topic"],
    additionalProperties: false,
  },
};

const answerSchema = z.object({ reply: z.string().trim().min(1), off_topic: z.boolean() });

type UncleAnswer =
  | { kind: "answer"; reply: string; offTopic: boolean; usedData: boolean }
  | { kind: "refusal" }
  | { kind: "unavailable"; why: string };

const userKey = (c: ChatContext) => `${c.channel}:${c.userId}`;
const chatKey = (c: ChatContext) => `${c.channel}:${c.chatId}`;

/** True when Haze Uncle has muted this user (the brain then stays silent). */
export async function isMuted(ctx: ChatContext, store: BotStore): Promise<boolean> {
  return store.isMuted(userKey(ctx));
}

export async function forget(ctx: ChatContext, store: BotStore): Promise<void> {
  await store.clearHistory(chatKey(ctx));
}

/** Answers one free-text message in Haze Uncle's voice. Never throws. */
export async function askUncle(text: string, ctx: ChatContext, deps: UncleDeps): Promise<BotReply> {
  try {
    const used = await deps.store.countDailyUse(userKey(ctx), sgtDate(deps.now()));
    if (used > DAILY_LIMIT) return { text: NOTICE_DAILY_CAP };

    const history = await deps.store.loadHistory(chatKey(ctx));
    await deps.onThinking?.();
    const answer = await converse(history, text, deps);

    if (answer.kind === "unavailable") {
      deps.log(`haze uncle unavailable (${answer.why})`);
      return { text: NOTICE_UNAVAILABLE };
    }
    if (answer.kind === "refusal") return { text: NOTICE_REDIRECT };

    let reply = answer.reply;
    if (answer.usedData && !reply.includes(DISCLAIMER)) reply = `${reply}\n\n${DISCLAIMER}`;

    if (answer.offTopic) {
      const strikes = await deps.store.addStrike(userKey(ctx), deps.now().getTime(), STRIKE_WINDOW_SECONDS);
      if (strikes >= 3) {
        await deps.store.mute(userKey(ctx), MUTE_SECONDS);
        return { text: NOTICE_BAN };
      }
      if (strikes === 2) reply = `${reply}\n\n${NOTICE_WARNING}`;
    }

    const turns: ChatTurn[] = [...history, { role: "user", text }, { role: "assistant", text: reply }];
    await deps.store.saveHistory(chatKey(ctx), turns.slice(-MEMORY_TURNS), MEMORY_TTL_SECONDS);
    return { text: reply };
  } catch (error) {
    deps.log(`haze uncle failed (${error instanceof Error ? error.name : "Error"})`);
    return { text: NOTICE_UNAVAILABLE };
  }
}

/** The Claude conversation for one message, including any tool rounds. */
async function converse(history: ChatTurn[], text: string, deps: UncleDeps): Promise<UncleAnswer> {
  // Past turns go back as plain text only, so trimming old turns never edits anything
  // Claude has to see unchanged; tool results and reasoning stay within one answer.
  const messages: MessageParam[] = [
    ...history.map((t): MessageParam => ({ role: t.role, content: t.text })),
    { role: "user", content: text },
  ];
  let usedData = false;

  for (let round = 0; round < MAX_ROUNDS; round++) {
    let response: Message;
    try {
      response = await deps.ask({ system: SYSTEM_PROMPT, tools: TOOLS, messages, outputFormat: OUTPUT_FORMAT });
    } catch (error) {
      const status = (error as { status?: unknown }).status;
      return { kind: "unavailable", why: typeof status === "number" ? `HTTP ${status}` : "no response" };
    }

    if (response.stop_reason === "refusal") return { kind: "refusal" };

    if (response.stop_reason === "tool_use") {
      // The whole reply goes back unchanged (thinking blocks included), as the API requires.
      messages.push({ role: "assistant", content: response.content });
      const results: ToolResultBlockParam[] = [];
      for (const block of response.content) {
        if (block.type !== "tool_use") continue;
        const outcome = await runTool(block.name, block.input, deps.getData);
        if (!outcome.isError) usedData = true;
        results.push({
          type: "tool_result",
          tool_use_id: block.id,
          content: outcome.content,
          ...(outcome.isError ? { is_error: true } : {}),
        });
      }
      messages.push({ role: "user", content: results });
      continue;
    }

    if (response.stop_reason !== "end_turn") return { kind: "unavailable", why: `stop ${response.stop_reason}` };

    const raw = response.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
    let parsed;
    try {
      parsed = answerSchema.safeParse(JSON.parse(raw));
    } catch {
      return { kind: "unavailable", why: "reply is not JSON" };
    }
    if (!parsed.success) return { kind: "unavailable", why: "reply has the wrong shape" };
    return { kind: "answer", reply: parsed.data.reply, offTopic: parsed.data.off_topic, usedData };
  }
  return { kind: "unavailable", why: "too many tool rounds" };
}
