/**
 * The one place that calls Claude (with the approved @anthropic-ai/sdk). The model and its
 * settings live here, so switching model is a one-line change.
 */
import Anthropic from "@anthropic-ai/sdk";
import type { AskClaude } from "../../shared/bot/haze-uncle.js";

export const CLAUDE_MODEL = "claude-haiku-5-5";
/** Room for thinking plus a short chat reply. */
export const MAX_TOKENS = 4000;
export const CLAUDE_TIMEOUT_MS = 25_000;

export function makeAskClaude(apiKey: string, client?: Anthropic): AskClaude {
  const anthropic = client ?? new Anthropic({ apiKey, timeout: CLAUDE_TIMEOUT_MS, maxRetries: 1 });
  return (request) =>
    anthropic.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: MAX_TOKENS,
      // Medium effort: a chat bot that must keep to its rules (see Context.md, Phase 2 plan).
      output_config: { effort: "medium", format: request.outputFormat },
      // Caches the unchanging system prompt and tools between requests.
      cache_control: { type: "ephemeral" },
      system: request.system,
      tools: request.tools,
      messages: request.messages,
    });
}
