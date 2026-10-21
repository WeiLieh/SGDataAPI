import { describe, expect, it, vi } from "vitest";
import { normalizePm25, pm25BodySchema } from "../shared/datasets/pm25.js";
import { normalizePsi, psiBodySchema } from "../shared/datasets/psi.js";
import { DISCLAIMER, FETCH_FAILED, type RegionalSnapshot } from "../shared/bot/format.js";
import { type GetData, HELP_TEXT, handleCommand, START_TEXT } from "../shared/bot/handle-command.js";
import { fixtureJson } from "./helpers.js";

const pm25 = normalizePm25(pm25BodySchema.parse(fixtureJson("pm25-latest.json")));
const psi = normalizePsi(psiBodySchema.parse(fixtureJson("psi-latest.json")));

/** A getData that answers from the real fixtures and records what was asked. */
function fixtureData() {
  return vi.fn<GetData>(async (dataset) => ({ ok: true, data: dataset === "pm25" ? pm25 : psi }));
}

describe("bot brain: help", () => {
  it("answers /start with a greeting and the help, /help with the help", async () => {
    const getData = fixtureData();
    expect((await handleCommand("/start", getData)).text).toBe(START_TEXT);
    expect((await handleCommand("/help", getData)).text).toBe(HELP_TEXT);
    expect(HELP_TEXT).toContain("/psi <region>");
    expect(HELP_TEXT).toContain("Regions: central, north, south, east, west.");
    expect(getData).not.toHaveBeenCalled();
  });

  it("answers an unknown command with an apology and the help", async () => {
    const reply = await handleCommand("/weather", fixtureData());
    expect(reply.text).toBe(`Sorry, I don't know that command.\n\n${HELP_TEXT}`);
  });

  it("answers plain chat text and empty text with the help", async () => {
    expect((await handleCommand("hello there", fixtureData())).text).toBe(HELP_TEXT);
    expect((await handleCommand("   ", fixtureData())).text).toBe(HELP_TEXT);
  });
});

describe("bot brain: /psi", () => {
  it("lists all five regions with value, band and recommendation when no region is given", async () => {
    const getData = fixtureData();
    const reply = await handleCommand("/psi", getData);
    expect(getData).toHaveBeenCalledWith("psi");
    expect(reply.text).toBe(
      [
        "PSI (24-hour)",
        "Central: 185, Unhealthy\nReduce prolonged or strenuous outdoor physical exertion.",
        "North: 131, Unhealthy\nReduce prolonged or strenuous outdoor physical exertion.",
        "South: 161, Unhealthy\nReduce prolonged or strenuous outdoor physical exertion.",
        "East: 178, Unhealthy\nReduce prolonged or strenuous outdoor physical exertion.",
        "West: 202, Very Unhealthy\nAvoid prolonged or strenuous outdoor physical exertion.",
        "Reading for 8:00 pm, 17 Oct 2026 (Singapore time)",
        DISCLAIMER,
      ].join("\n\n"),
    );
  });

  it("answers one region, in any capitalisation, and ignores extra spaces", async () => {
    const reply = await handleCommand("  /PSI   West ", fixtureData());
    expect(reply.text).toBe(
      [
        "PSI (24-hour)",
        "West: 202, Very Unhealthy\nAvoid prolonged or strenuous outdoor physical exertion.",
        "Reading for 8:00 pm, 17 Oct 2026 (Singapore time)",
        DISCLAIMER,
      ].join("\n\n"),
    );
  });

  it("accepts the group-chat form /psi@BotName", async () => {
    const reply = await handleCommand("/psi@SgWeatherBot north", fixtureData());
    expect(reply.text).toContain("North: 131, Unhealthy");
  });
});

describe("bot brain: /pm25", () => {
  it("shows the unit and PM2.5 bands, and never says PSI", async () => {
    const getData = fixtureData();
    const reply = await handleCommand("/pm25 central", getData);
    expect(getData).toHaveBeenCalledWith("pm25");
    expect(reply.text).toBe(
      [
        "PM2.5 (1-hour)",
        "Central: 217 µg/m³, High\nAvoid strenuous outdoor activity.",
        "Reading for 9:00 pm, 15 Oct 2026 (Singapore time)",
        DISCLAIMER,
      ].join("\n\n"),
    );
    expect((await handleCommand("/pm25", getData)).text).not.toContain("PSI");
  });
});

describe("bot brain: errors and gaps", () => {
  it("names a bad region and lists the valid ones, without fetching", async () => {
    const getData = fixtureData();
    const reply = await handleCommand("/psi Jurong", getData);
    expect(reply.text).toBe('I don\'t know the region "Jurong". Try one of: central, north, south, east, west.');
    expect(getData).not.toHaveBeenCalled();
  });

  it('shows "No reading" for a missing value, never 0', async () => {
    const latest = psi.readings.at(-1)!;
    const gap: RegionalSnapshot = { ...psi, readings: [{ ...latest, values: { ...latest.values, east: null } }] };
    const reply = await handleCommand("/psi", async () => ({ ok: true, data: gap }));
    expect(reply.text).toContain("East: No reading");
    expect(reply.text).not.toContain("East: 0");
    const missing: RegionalSnapshot = { ...psi, regions: psi.regions.filter((r) => r.id !== "south") };
    expect((await handleCommand("/psi south", async () => ({ ok: true, data: missing }))).text).toContain(
      "South: No reading",
    );
  });

  it("apologises without details when the data call fails, throws, or returns no readings", async () => {
    expect((await handleCommand("/psi", async () => ({ ok: false }))).text).toBe(FETCH_FAILED);
    expect(
      (
        await handleCommand("/pm25", async () => {
          throw new Error("secret internal detail");
        })
      ).text,
    ).toBe(FETCH_FAILED);
    expect((await handleCommand("/pm25", async () => ({ ok: true, data: { ...pm25, readings: [] } }))).text).toBe(
      FETCH_FAILED,
    );
  });
});
