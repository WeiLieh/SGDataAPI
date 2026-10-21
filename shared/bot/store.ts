/**
 * What Haze Uncle needs from storage, described without naming any database, so the brain
 * stays pure and a different store (or a fake in tests) can stand in. Every entry the real
 * store writes expires on its own.
 */

/** One remembered message. Only plain text is kept: no data readings, no model reasoning. */
export interface ChatTurn {
  role: "user" | "assistant";
  text: string;
}

export interface BotStore {
  /** True the first time a key is seen within the hour, false for a repeat (Telegram retries). */
  markUpdateSeen(key: string): Promise<boolean>;
  isMuted(userKey: string): Promise<boolean>;
  mute(userKey: string, seconds: number): Promise<void>;
  /** Records one strike at nowMs and returns how many fall within the last windowSeconds. */
  addStrike(userKey: string, nowMs: number, windowSeconds: number): Promise<number>;
  /** Adds one to the user's count for a Singapore day ("YYYY-MM-DD") and returns the new count. */
  countDailyUse(userKey: string, day: string): Promise<number>;
  loadHistory(chatKey: string): Promise<ChatTurn[]>;
  saveHistory(chatKey: string, turns: ChatTurn[], ttlSeconds: number): Promise<void>;
  clearHistory(chatKey: string): Promise<void>;
}
