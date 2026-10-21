/**
 * The brain's front door, used by every chat adapter: a muted user gets silence, fixed
 * commands are answered for free, and any other text goes to Haze Uncle (when he is set up).
 */
import { commandOf, type BotReply, type GetData, handleCommand } from "./handle-command.js";
import { askUncle, type ChatContext, forget, isMuted, type UncleDeps } from "./haze-uncle.js";

export const FORGET_DONE = "Done. HazeUncle has forgotten this chat.";
export const FORGET_OFF = "Chat memory is not switched on, so there is nothing to forget.";
export const FORGET_FAILED = "I couldn't clear the chat memory right now, please try again.";

export interface RespondDeps {
  getData: GetData;
  /** Null when Claude or the store is not set up: the bot then answers like Phase 1. */
  uncle: Omit<UncleDeps, "getData"> | null;
}

/** The reply to send, or null to stay silent (a muted user). Never throws. */
export async function respond(text: string, ctx: ChatContext, deps: RespondDeps): Promise<BotReply | null> {
  const { uncle } = deps;
  if (uncle) {
    try {
      if (await isMuted(ctx, uncle.store)) return null;
    } catch (error) {
      uncle.log(`mute check failed (${error instanceof Error ? error.name : "Error"})`);
    }
  }

  const command = commandOf(text);
  if (command === "/forget") {
    if (!uncle) return { text: FORGET_OFF };
    try {
      await forget(ctx, uncle.store);
      return { text: FORGET_DONE };
    } catch (error) {
      uncle.log(`forget failed (${error instanceof Error ? error.name : "Error"})`);
      return { text: FORGET_FAILED };
    }
  }

  if (!uncle || command === "" || command.startsWith("/")) return handleCommand(text, deps.getData);
  return askUncle(text, ctx, { ...uncle, getData: deps.getData });
}
