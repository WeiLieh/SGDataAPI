/**
 * Sends one reply through Telegram's Bot API with plain fetch (no library).
 * Telegram requires the token inside the request URL; that URL is never logged or returned.
 */
import { logBot } from "./settings.js";

export const SEND_TIMEOUT_MS = 8_000;

/** Returns true when Telegram accepted the message. */
export async function sendTelegramMessage(
  token: string,
  chatId: number,
  text: string,
  fetchFn: typeof fetch = fetch,
): Promise<boolean> {
  try {
    const res = await fetchFn(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text }),
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    });
    if (!res.ok) {
      logBot(`sendMessage HTTP ${res.status}`);
      return false;
    }
    return true;
  } catch (error) {
    const name = error instanceof Error ? error.name : "Error";
    logBot(`sendMessage failed (${name})`);
    return false;
  }
}

/** Shows "typing..." in the chat while Haze Uncle thinks. Best effort: failures are only logged. */
export async function sendTypingAction(token: string, chatId: number, fetchFn: typeof fetch = fetch): Promise<void> {
  try {
    const res = await fetchFn(`https://api.telegram.org/bot${token}/sendChatAction`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, action: "typing" }),
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    });
    if (!res.ok) logBot(`sendChatAction HTTP ${res.status}`);
  } catch (error) {
    logBot(`sendChatAction failed (${error instanceof Error ? error.name : "Error"})`);
  }
}
