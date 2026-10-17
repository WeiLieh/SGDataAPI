import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import handler from "../api/data.js";
import { normalizePsi, psi, psiBodySchema, type PsiData } from "../shared/datasets/psi.js";
import { psiBand } from "../shared/datasets/psi-bands.js";
import { PSI_COLOURS } from "../src/lib/colors.js";
import { needsPreviousDay, psiHourRows } from "../src/lib/psiHistory.js";
import { mergePsiDays } from "../src/lib/usePsiHistory.js";
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

  it("carries the owner's recommendations and colours", () => {
    expect(psiBand(150)?.recommendation).toBe("Reduce prolonged or strenuous outdoor physical exertion.");
    expect(psiBand(350)?.recommendation).toBe("Minimise or avoid all outdoor activity.");
    expect(PSI_COLOURS).toEqual({
      Good: "#1e7b34",
      Moderate: "#ffcd00",
      Unhealthy: "#f2a900",
      "Very Unhealthy": "#f28c28",
      Hazardous: "#d93025",
    });
  });

  it("gives no band to a missing reading", () => {
    expect(psiBand(null)).toBeNull();
    expect(psiBand(-1)).toBeNull();
  });
});

function hourly(hours: string[], value = 60): PsiData {
  return {
    regions: [{ id: "central", name: "Central", latitude: 1.35735, longitude: 103.82 }],
    readings: hours.map((h) => ({ timestamp: h, updatedTimestamp: h, values: { central: value } })),
  };
}

describe("past 12 hours", () => {
  it("gives the 12 clock hours ending at the latest reading, newest first, with a gap as no reading", () => {
    const hours = Array.from({ length: 14 }, (_, i) => `2026-10-17T${String(i + 7).padStart(2, "0")}:00:00+08:00`);
    const withGap = hours.filter((h) => !h.includes("T15:"));
    const rows = psiHourRows(hourly(withGap).readings);
    expect(rows).toHaveLength(12);
    expect(rows[0]?.timestamp).toBe("2026-10-17T20:00:00+08:00");
    expect(rows[11]?.timestamp).toBe("2026-10-17T09:00:00+08:00");
    const gap = rows.find((r) => r.reading === null);
    expect(gap && Date.parse(gap.timestamp)).toBe(Date.parse("2026-10-17T15:00:00+08:00"));
    expect(rows.filter((r) => r.reading === null)).toHaveLength(1);
  });

  it("crosses midnight when yesterday's readings are merged in", () => {
    const yesterday = hourly(["2026-10-16T21:00:00+08:00", "2026-10-16T22:00:00+08:00", "2026-10-16T23:00:00+08:00"], 40);
    const today = hourly(Array.from({ length: 9 }, (_, i) => `2026-10-17T0${i}:00:00+08:00`), 70);
    const merged = mergePsiDays(yesterday, today);
    const rows = psiHourRows(merged.readings);
    expect(rows.map((r) => r.reading?.values.central)).toEqual([70, 70, 70, 70, 70, 70, 70, 70, 70, 40, 40, 40]);
    expect(rows[11]?.timestamp).toBe("2026-10-16T21:00:00+08:00");
  });

  it("asks for yesterday only when the latest SGT hour is before 11:00", () => {
    expect(needsPreviousDay("2026-10-17T10:00:00+08:00")).toBe(true);
    expect(needsPreviousDay("2026-10-17T11:00:00+08:00")).toBe(false);
    expect(needsPreviousDay("2026-10-17T00:00:00+08:00")).toBe(true);
    expect(needsPreviousDay("2026-10-17T03:00:00Z")).toBe(false); // 11:00 SGT
  });

  it("is empty when there are no readings", () => {
    expect(psiHourRows([])).toEqual([]);
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
