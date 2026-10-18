import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import handler from "../api/data.js";
import { normalizePsi, psi, psiBodySchema } from "../shared/datasets/psi.js";
import { psiBand } from "../shared/datasets/psi-bands.js";
import { psiTone } from "../src/lib/colors.js";
import { PM25_SCREEN, PSI_SCREEN } from "../src/views/screens.js";
import { call, fixtureJson, fixtureText, upstream } from "./helpers.js";

const sample = fixtureJson<Record<string, unknown>>("psi-latest.json");

describe("psi normalize on the real response", () => {
  const data = normalizePsi(psiBodySchema.parse(sample));

  it("returns five regions in order with coordinates", () => {
    expect(data.regions.map((r) => r.id)).toEqual(["central", "north", "south", "east", "west"]);
    expect(data.regions[1]).toEqual({ id: "north", name: "North", latitude: 1.41803, longitude: 103.82 });
  });

  it("uses only the 24-hour PSI, no unit, ignoring pollutant measurements and sub-indices", () => {
    expect(data).not.toHaveProperty("unit");
    expect(data.readings).toEqual([
      {
        timestamp: "2026-10-17T20:00:00+08:00",
        updatedTimestamp: "2026-10-17T20:30:51+08:00",
        values: { central: 185, north: 131, south: 161, east: 178, west: 202 },
      },
    ]);
  });

  it("parses without the spec-only psi_three_hourly, and fails without psi_twenty_four_hourly", () => {
    const body = structuredClone(sample) as { data: { items: Array<{ readings: Record<string, unknown> }> } };
    expect(body.data.items[0]?.readings).not.toHaveProperty("psi_three_hourly");
    delete body.data.items[0]!.readings.psi_twenty_four_hourly;
    expect(psiBodySchema.safeParse(body).success).toBe(false);
  });

  it("caches like PM2.5 and names PSI in its 404 message", () => {
    const now = new Date("2026-10-17T14:00:00Z");
    expect(psi.cacheSeconds({}, now)).toBe(300);
    expect(psi.cacheSeconds({ date: "2026-10-16" }, now)).toBe(86400);
    expect(psi.notFoundMessage({ date: "2026-10-17" })).toBe("data.gov.sg has no PSI readings for 2026-10-17.");
    expect(psi.notFoundMessage({})).toBe("data.gov.sg has no PSI readings right now.");
  });
});

describe("PSI bands", () => {
  it.each([
    [0, "Good"],
    [50, "Good"],
    [51, "Moderate"],
    [100, "Moderate"],
    [101, "Unhealthy"],
    [200, "Unhealthy"],
    [201, "Very Unhealthy"],
    [300, "Very Unhealthy"],
    [301, "Hazardous"],
    [500, "Hazardous"],
  ])("PSI %i is %s", (value, label) => {
    expect(psiBand(value)?.label).toBe(label);
  });

  it("carries the owner's recommendations and colour tones", () => {
    expect(psiBand(150)?.recommendation).toBe("Reduce prolonged or strenuous outdoor physical exertion.");
    expect(psiBand(350)?.recommendation).toBe("Minimise or avoid all outdoor activity.");
    expect([30, 80, 150, 250, 350].map((v) => psiTone(psiBand(v)))).toEqual([
      "green",
      "yellow",
      "amber",
      "orange",
      "red",
    ]);
    expect(psiTone(psiBand(null))).toBe("none");
  });

  it("gives no band to a missing reading", () => {
    expect(psiBand(null)).toBeNull();
    expect(psiBand(-1)).toBeNull();
  });
});

describe("PSI and PM2.5 screens", () => {
  it("titles the cards per measure, and PSI has no unit", () => {
    expect(PM25_SCREEN.title).toBe("Air Quality - PM2.5");
    expect(PSI_SCREEN.title).toBe("Air Quality - PSI");
    expect(PM25_SCREEN.unit).toBe("µg/m³");
    expect(PSI_SCREEN.unit).toBeNull();
    expect(PSI_SCREEN.creditName).toBe("Pollutant Standards Index (PSI)");
  });

  it("has a five-band PSI legend and a four-band PM2.5 legend", () => {
    expect(PSI_SCREEN.legend.map((l) => `${l.label} ${l.tone}`)).toEqual([
      "0–50 green",
      "51–100 yellow",
      "101–200 amber",
      "201–300 orange",
      "≥301 red",
    ]);
    expect(PM25_SCREEN.legend).toHaveLength(4);
  });

  it("gives the PSI screen the descriptor, recommendation and tone of a value", () => {
    expect(PSI_SCREEN.band(185)).toEqual({
      label: "Unhealthy",
      recommendation: "Reduce prolonged or strenuous outdoor physical exertion.",
      tone: "amber",
    });
    expect(PSI_SCREEN.band(null)).toBeNull();
  });
});

describe("GET /api/data?dataset=psi", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("DATAGOV_API_KEY", "");
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("reads the PSI endpoint from the registry and returns the 24-hour PSI", async () => {
    fetchMock.mockResolvedValueOnce(upstream(fixtureText("psi-latest.json")));
    const res = await call(handler, "/api/data?dataset=psi&date=2026-10-17");
    expect(res.statusCode).toBe(200);
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe("https://api-open.data.gov.sg/v2/real-time/api/psi?date=2026-10-17");
    const body = res.json();
    expect(body.source).toMatchObject({ datasetId: "d_fe37906a0182569d891506e815e819b7" });
    expect(body.data.readings[0].values.west).toBe(202);
  });

  it("maps a 404 to a PSI message, like PM2.5", async () => {
    fetchMock.mockResolvedValueOnce(upstream(fixtureText("pm25-error-404.json"), 404));
    const res = await call(handler, "/api/data?dataset=psi&date=2026-10-17");
    expect(res.statusCode).toBe(404);
    expect(res.json().error.message).toBe("data.gov.sg has no PSI readings for 2026-10-17.");
  });

  it("rejects a bad date like PM2.5", async () => {
    const res = await call(handler, "/api/data?dataset=psi&date=bad");
    expect(res.statusCode).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
