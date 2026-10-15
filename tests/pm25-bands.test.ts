import { describe, expect, it } from "vitest";
import { pm25Band } from "../shared/datasets/pm25-bands.js";

describe("NEA 1-hour PM2.5 bands", () => {
  it.each([
    [0, "I", "Normal"],
    [55, "I", "Normal"],
    [56, "II", "Elevated"],
    [150, "II", "Elevated"],
    [151, "III", "High"],
    [250, "III", "High"],
    [251, "IV", "Very High"],
    [900, "IV", "Very High"],
  ])("%i µg/m³ is Band %s %s", (value, band, label) => {
    expect(pm25Band(value)).toMatchObject({ band, label });
  });

  it("gives no band to a missing reading", () => {
    expect(pm25Band(null)).toBeNull();
    expect(pm25Band(-1)).toBeNull();
    expect(pm25Band(Number.NaN)).toBeNull();
  });
});
