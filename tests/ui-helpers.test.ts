import { afterEach, describe, expect, it, vi } from "vitest";
import { normalizePm25, pm25BodySchema } from "../shared/datasets/pm25.js";
import { pm25Band } from "../shared/datasets/pm25-bands.js";
import { bandTone } from "../src/lib/colors.js";
import {
  isInSingapore,
  loadRememberedRegion,
  nearestRegion,
  rememberRegion,
  resolveRegion,
} from "../src/lib/regions.js";
import { formatSgtDateTime, staleHours } from "../src/lib/time.js";
import { fixtureJson } from "./helpers.js";

const regions = normalizePm25(pm25BodySchema.parse(fixtureJson("pm25-latest.json"))).regions;

describe("formatSgtDateTime", () => {
  it("matches the mockup format with the year, in Singapore time", () => {
    expect(formatSgtDateTime("2026-10-16T21:00:00+08:00")).toBe("9:00 pm, 16 Oct 2026");
    expect(formatSgtDateTime("2026-10-16T09:30:39+08:00")).toBe("9:30 am, 16 Oct 2026");
    // 16:05 UTC is 00:05 the next day in Singapore.
    expect(formatSgtDateTime("2026-10-16T16:05:00Z")).toBe("12:05 am, 17 Oct 2026");
  });
});

describe("staleHours", () => {
  const reading = "2026-10-16T21:00:00+08:00";
  it("is null up to 2 hours after the reading's hour", () => {
    expect(staleHours(reading, new Date("2026-10-16T21:59:00+08:00"))).toBeNull();
    expect(staleHours(reading, new Date("2026-10-16T23:00:00+08:00"))).toBeNull();
  });
  it("gives whole hours once more than 2 hours old", () => {
    expect(staleHours(reading, new Date("2026-10-16T23:00:01+08:00"))).toBe(2);
    expect(staleHours(reading, new Date("2026-10-17T00:59:00+08:00"))).toBe(3);
  });
});

describe("band colours", () => {
  it("follows the owner's colour code; Elevated and High are both yellow", () => {
    expect(bandTone(pm25Band(55))).toBe("green");
    expect(bandTone(pm25Band(56))).toBe("yellow");
    expect(bandTone(pm25Band(250))).toBe("yellow");
    expect(bandTone(pm25Band(251))).toBe("red");
    expect(bandTone(pm25Band(null))).toBe("none");
  });
});

describe("nearestRegion", () => {
  it.each([
    [1.44, 103.79, "north"], // Woodlands
    [1.28, 103.85, "south"], // Marina Bay
    [1.36, 103.99, "east"], // Changi
    [1.34, 103.69, "west"], // Jurong West
    [1.36, 103.83, "central"], // Bishan
  ])("%f, %f is %s", (lat, lon, region) => {
    expect(nearestRegion(lat, lon, regions)).toBe(region);
  });

  it("falls back to Central outside Singapore", () => {
    expect(isInSingapore(1.5, 103.75)).toBe(false); // Johor Bahru
    expect(nearestRegion(1.5, 103.75, regions)).toBe("central");
    expect(nearestRegion(51.5, -0.12, regions)).toBe("central");
  });
});

describe("selected region", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("prefers the remembered region, then Central, then the first region", () => {
    expect(resolveRegion("east", regions)).toBe("east");
    expect(resolveRegion(null, regions)).toBe("central");
    expect(resolveRegion("atlantis", regions)).toBe("central");
    expect(resolveRegion(null, regions.filter((r) => r.id !== "central"))).toBe("north");
    expect(resolveRegion(null, [])).toBeNull();
  });

  it("stores only the region id, and survives storage being unavailable", () => {
    const store = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
    });
    rememberRegion("west");
    expect([...store.entries()]).toEqual([["sgweather.region", "west"]]);
    expect(loadRememberedRegion()).toBe("west");

    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    });
    expect(loadRememberedRegion()).toBeNull();
    expect(() => rememberRegion("west")).not.toThrow();
  });
});
