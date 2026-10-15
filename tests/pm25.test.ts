import { describe, expect, it } from "vitest";
import { normalizePm25, pm25, pm25BodySchema, validatePm25Date } from "../shared/datasets/pm25.js";
import { sgtDate } from "../shared/sgt.js";
import { fixtureJson } from "./helpers.js";

const latest = fixtureJson("pm25-latest.json");

function parse(body: unknown) {
  return pm25BodySchema.parse(body);
}

describe("pm25 normalize on the real response", () => {
  const data = normalizePm25(parse(latest));

  it("returns five regions in order with names and coordinates", () => {
    expect(data.unit).toBe("µg/m³");
    expect(data.regions).toEqual([
      { id: "central", name: "Central", latitude: 1.35735, longitude: 103.82 },
      { id: "north", name: "North", latitude: 1.41803, longitude: 103.82 },
      { id: "south", name: "South", latitude: 1.29587, longitude: 103.82 },
      { id: "east", name: "East", latitude: 1.35735, longitude: 103.94 },
      { id: "west", name: "West", latitude: 1.35735, longitude: 103.7 },
    ]);
  });

  it("returns the 21:00 SGT reading", () => {
    expect(data.readings).toEqual([
      {
        timestamp: "2026-10-15T21:00:00+08:00",
        updatedTimestamp: "2026-10-15T21:15:35+08:00",
        values: { central: 217, north: 125, south: 144, east: 182, west: 156 },
      },
    ]);
  });
});

describe("pm25 defensive parsing", () => {
  function withItems(items: unknown[], regionMetadata?: unknown[]) {
    const body = structuredClone(latest) as { data: { items: unknown[]; regionMetadata: unknown[] } };
    body.data.items = items;
    if (regionMetadata) body.data.regionMetadata = regionMetadata;
    return body;
  }
  const item = (values: Record<string, number | null>, timestamp = "2026-10-15T21:00:00+08:00") => ({
    date: "2026-10-15",
    timestamp,
    updatedTimestamp: timestamp,
    readings: { pm25_one_hourly: values },
  });

  it("matches a capitalised or padded region name", () => {
    const body = withItems([item({ North: 1, " south ": 2, WEST: 3, east: 4, central: 5 })]);
    (body.data.regionMetadata[0] as { name: string }).name = " North ";
    const data = normalizePm25(parse(body));
    expect(data.regions.map((r) => r.id)).toEqual(["central", "north", "south", "east", "west"]);
    expect(data.readings[0]?.values).toEqual({ central: 5, north: 1, south: 2, east: 4, west: 3 });
    expect(data.regions.find((r) => r.id === "north")?.latitude).toBe(1.41803);
  });

  it("treats a region missing from a reading as null, not 0", () => {
    const data = normalizePm25(parse(withItems([item({ north: 10, south: 20, east: 30, central: 40 })])));
    expect(data.readings[0]?.values.west).toBeNull();
  });

  it("keeps a region with readings but no metadata, without coordinates, after the known regions", () => {
    const data = normalizePm25(
      parse(withItems([item({ north: 1, south: 2, east: 3, west: 4, central: 5, offshore: 6, alpha: 7 })])),
    );
    expect(data.regions.map((r) => r.id)).toEqual(["central", "north", "south", "east", "west", "alpha", "offshore"]);
    expect(data.regions.at(-1)).toEqual({ id: "offshore", name: "Offshore", latitude: null, longitude: null });
    expect(data.readings[0]?.values.offshore).toBe(6);
  });

  it("accepts other ISO 8601 offsets", () => {
    expect(() => parse(withItems([item({ north: 1 }, "2026-10-15T13:00:00Z")]))).not.toThrow();
    expect(() => parse(withItems([item({ north: 1 }, "2026-10-15T21:00:00+0800")]))).not.toThrow();
  });

  it("fails the schema on an unparseable or offset-less timestamp", () => {
    expect(pm25BodySchema.safeParse(withItems([item({ north: 1 }, "not a time")])).success).toBe(false);
    expect(pm25BodySchema.safeParse(withItems([item({ north: 1 }, "2026-10-15T21:00:00+08:0")])).success).toBe(false);
    expect(pm25BodySchema.safeParse(withItems([item({ north: 1 }, "2026-10-15T21:00:00")])).success).toBe(false);
    expect(pm25BodySchema.safeParse(withItems([item({ north: 1 }, "2026-13-45T21:00:00+08:00")])).success).toBe(false);
  });

  it("sorts readings oldest to newest and drops duplicate timestamps", () => {
    const data = normalizePm25(
      parse(
        withItems([
          item({ north: 3 }, "2026-10-15T21:00:00+08:00"),
          item({ north: 1 }, "2026-10-15T19:00:00+08:00"),
          item({ north: 3 }, "2026-10-15T13:00:00Z"),
          item({ north: 2 }, "2026-10-15T20:00:00+08:00"),
        ]),
      ),
    );
    expect(data.readings.map((r) => r.values.north)).toEqual([1, 2, 3]);
  });
});

describe("pm25 date parameter", () => {
  // 22:00 SGT on 2026-10-15.
  const now = new Date("2026-10-15T14:00:00Z");

  it.each(["2026-10-15", "2026-10-15T21:00:00", "2024-02-29", "2026-10-14T23:59:59"])("accepts %s", (value) => {
    expect(validatePm25Date(value, now)).toEqual({ ok: true, value });
  });

  it.each(["2026-02-30", "2026-10-15T24:00:00", "15/10/2026", "2026-10-15T21:00", "", "2026-10-15T21:60:00", "2025-02-29"])(
    "rejects %s as a bad format or calendar date",
    (value) => {
      expect(validatePm25Date(value, now)).toEqual({
        ok: false,
        error: "Use YYYY-MM-DD or YYYY-MM-DDTHH:mm:ss (Singapore time).",
      });
    },
  );

  it.each(["2026-10-16", "2026-10-15T22:00:01"])("rejects %s as in the future", (value) => {
    expect(validatePm25Date(value, now)).toEqual({ ok: false, error: "Date is in the future (Singapore time)." });
  });

  it("rejects tomorrow in SGT against the real clock", () => {
    const realNow = new Date();
    const tomorrow = sgtDate(new Date(realNow.getTime() + 24 * 60 * 60 * 1000));
    expect(validatePm25Date(tomorrow, realNow)).toEqual({
      ok: false,
      error: "Date is in the future (Singapore time).",
    });
  });

  it("uses the SGT date, not the UTC date, near midnight", () => {
    // 00:30 SGT on 2026-10-16 is still 2026-10-15 in UTC.
    const justAfterMidnight = new Date("2026-10-15T16:30:00Z");
    expect(validatePm25Date("2026-10-16", justAfterMidnight).ok).toBe(true);
  });
});

describe("pm25 cacheSeconds", () => {
  const now = new Date("2026-10-15T14:00:00Z");
  it("is 300 for latest or today's SGT date and 86400 for an earlier day", () => {
    expect(pm25.cacheSeconds({}, now)).toBe(300);
    expect(pm25.cacheSeconds({ date: "2026-10-15" }, now)).toBe(300);
    expect(pm25.cacheSeconds({ date: "2026-10-15T08:00:00" }, now)).toBe(300);
    expect(pm25.cacheSeconds({ date: "2026-10-14" }, now)).toBe(86400);
  });
});
