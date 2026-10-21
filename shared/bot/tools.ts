/**
 * The two tools Haze Uncle may call. They are answered with the same getData the fixed
 * commands use (the app's own /api/data), plus the existing band and time code.
 */
import type { Tool } from "@anthropic-ai/sdk/resources/messages/messages";
import { REGION_ORDER } from "../datasets/regional.js";
import { formatSgtDateTime } from "../sgt.js";
import { type BotDatasetId, MEASURES } from "./format.js";
import type { GetData } from "./handle-command.js";

type InputSchema = Tool["input_schema"];

const regionInput: InputSchema = {
  type: "object",
  properties: {
    region: {
      type: "string",
      enum: ["all", ...REGION_ORDER],
      description: 'One of the five regions, or "all" for every region.',
    },
  },
  required: ["region"],
  additionalProperties: false,
};

export const TOOLS: Tool[] = [
  {
    name: "get_psi",
    description:
      "Latest 24-hour PSI (Pollutant Standards Index, no unit) in Singapore from NEA via data.gov.sg, with each region's band and NEA health recommendation and the reading time in Singapore time.",
    input_schema: regionInput,
    strict: true,
  },
  {
    name: "get_pm25",
    description:
      "Latest 1-hour PM2.5 concentration (µg/m³) in Singapore from NEA via data.gov.sg, with each region's band and NEA health recommendation and the reading time in Singapore time.",
    input_schema: regionInput,
    strict: true,
  },
];

const TOOL_DATASETS: Record<string, BotDatasetId> = { get_psi: "psi", get_pm25: "pm25" };

export interface ToolOutcome {
  /** The text handed back to Claude. */
  content: string;
  isError: boolean;
}

/** Runs one tool call. Never throws. */
export async function runTool(name: string, input: unknown, getData: GetData): Promise<ToolOutcome> {
  const dataset = Object.hasOwn(TOOL_DATASETS, name) ? TOOL_DATASETS[name] : undefined;
  const region = (input as { region?: unknown } | null)?.region;
  if (!dataset || typeof region !== "string" || (region !== "all" && !REGION_ORDER.includes(region))) {
    return { content: "Unknown tool or region.", isError: true };
  }

  let result;
  try {
    result = await getData(dataset);
  } catch {
    result = { ok: false as const };
  }
  const latest = result.ok ? result.data.readings.at(-1) : undefined;
  if (!result.ok || !latest) return { content: "Could not fetch the data right now.", isError: true };

  const measure = MEASURES[dataset];
  const regions = result.data.regions.filter((r) => region === "all" || r.id === region);
  return {
    isError: false,
    content: JSON.stringify({
      measure: measure.title,
      unit: dataset === "pm25" ? (result.data.unit ?? "µg/m³") : null,
      reading_time_singapore: formatSgtDateTime(latest.timestamp),
      regions: regions.map((r) => {
        const value = latest.values[r.id] ?? null;
        const band = measure.band(value);
        return value === null || band === null
          ? { region: r.name, value: null, note: "No reading" }
          : { region: r.name, value, band: band.label, recommendation: band.recommendation };
      }),
    }),
  };
}
