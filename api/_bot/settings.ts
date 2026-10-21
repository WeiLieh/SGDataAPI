/**
 * The bot's settings, read only here and only on the server. None of them is ever sent to
 * a chat, written into a response or logged.
 */
export interface BotSettings {
  /** From BotFather; used only to send replies to Telegram. */
  botToken: string | null;
  /** The secret_token the webhook was registered with; every request must carry it. */
  webhookSecret: string | null;
  /** Where this deployment's own /api/data lives, e.g. "https://sg-data-api.vercel.app". */
  appBaseUrl: string | null;
  /** Vercel's "Protection Bypass for Automation" secret, so previews can call their own /api/data. */
  bypassSecret: string | null;
  /** Haze Uncle's Claude key; without it plain messages get the help text. */
  anthropicApiKey: string | null;
  /** The Upstash Redis REST address and token (Vercel's Upstash integration sets them). */
  storeUrl: string | null;
  storeToken: string | null;
}

function value(env: NodeJS.ProcessEnv, name: string): string | null {
  const v = env[name]?.trim();
  return v ? v : null;
}

/**
 * APP_BASE_URL wins (set for Production). Without it, a Vercel deployment uses its own
 * address, which Vercel provides as VERCEL_URL (used by previews).
 */
export function readBotSettings(env: NodeJS.ProcessEnv = process.env): BotSettings {
  const explicit = value(env, "APP_BASE_URL");
  const vercelUrl = value(env, "VERCEL_URL");
  const base = explicit ?? (vercelUrl ? `https://${vercelUrl}` : null);
  return {
    botToken: value(env, "TELEGRAM_BOT_TOKEN"),
    webhookSecret: value(env, "TELEGRAM_WEBHOOK_SECRET"),
    appBaseUrl: base ? base.replace(/\/+$/, "") : null,
    bypassSecret: value(env, "VERCEL_AUTOMATION_BYPASS_SECRET"),
    anthropicApiKey: value(env, "ANTHROPIC_API_KEY"),
    storeUrl: value(env, "KV_REST_API_URL") ?? value(env, "UPSTASH_REDIS_REST_URL"),
    storeToken: value(env, "KV_REST_API_TOKEN") ?? value(env, "UPSTASH_REDIS_REST_TOKEN"),
  };
}

/** One log line per failure, never containing a setting's value. */
export function logBot(line: string): void {
  console.error(`[api/telegram] ${line.replace(/\s+/g, " ").trim()}`);
}
