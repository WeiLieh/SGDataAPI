/**
 * The chat bot's "brain": turns what a person typed into a reply. It knows nothing about
 * Telegram (or any other chat app), makes no network calls and reads no settings: the data
 * comes through the getData function it is given, and the reply is plain text that any
 * chat adapter can send.
 */
import { REGION_ORDER } from "../datasets/regional.js";
import { type BotDatasetId, FETCH_FAILED, formatReading, type RegionalSnapshot } from "./format.js";

/** The result of asking /api/data for one dataset's latest reading. */
export type DataResult = { ok: true; data: RegionalSnapshot } | { ok: false };

export type GetData = (dataset: BotDatasetId) => Promise<DataResult>;

/** A reply any chat adapter can send. */
export interface BotReply {
  text: string;
}

const REGION_LIST = REGION_ORDER.join(", ");

export const HELP_TEXT = [
  "HazeUncle: Singapore air quality from data.gov.sg.",
  [
    "/psi - 24-hour PSI for all five regions",
    "/psi <region> - one region, e.g. /psi north",
    "/pm25 - 1-hour PM2.5 for all five regions",
    "/pm25 <region> - one region, e.g. /pm25 west",
    "/forget - clear what HazeUncle remembers of this chat",
    "/help - this message",
  ].join("\n"),
  'Or just ask in your own words, e.g. "Can I go jogging in the west now?"',
  `Regions: ${REGION_LIST}.`,
].join("\n\n");

export const START_TEXT = `Hello! ${HELP_TEXT}`;

const DATA_COMMANDS: Record<string, BotDatasetId> = { "/psi": "psi", "/pm25": "pm25" };

/** The command word of a message, lowercased; "/psi@BotName" (group chats) becomes "/psi". */
export function commandOf(text: string): string {
  const first = text.trim().split(/\s+/)[0] ?? "";
  return first.toLowerCase().split("@")[0] ?? "";
}

/** Answers one fixed command (or, without Haze Uncle, any text). Never throws. */
export async function handleCommand(text: string, getData: GetData): Promise<BotReply> {
  const [, ...rest] = text.trim().split(/\s+/);
  const command = commandOf(text);

  if (command === "/start") return { text: START_TEXT };
  if (command === "/help") return { text: HELP_TEXT };

  const dataset = Object.hasOwn(DATA_COMMANDS, command) ? DATA_COMMANDS[command] : undefined;
  if (!dataset) {
    const prefix = command.startsWith("/") ? "Sorry, I don't know that command.\n\n" : "";
    return { text: prefix + HELP_TEXT };
  }

  const asked = rest.join(" ").toLowerCase();
  if (asked !== "" && !REGION_ORDER.includes(asked)) {
    return { text: `I don't know the region "${rest.join(" ")}". Try one of: ${REGION_LIST}.` };
  }

  let result: DataResult;
  try {
    result = await getData(dataset);
  } catch {
    result = { ok: false };
  }
  if (!result.ok) return { text: FETCH_FAILED };
  return { text: formatReading(dataset, result.data, asked === "" ? null : asked) };
}
