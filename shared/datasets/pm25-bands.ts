/**
 * NEA's 1-hour PM2.5 concentration bands, in µg/m³.
 * Source: https://www.haze.gov.sg — check these values against haze.gov.sg whenever they are touched.
 * These bands describe the 1-hour PM2.5 concentration; they are not PSI.
 */
export const PM25_BANDS_SOURCE = "https://www.haze.gov.sg";

export interface Pm25Band {
  band: "I" | "II" | "III" | "IV";
  label: "Normal" | "Elevated" | "High" | "Very High";
  min: number;
  /** Inclusive upper bound; null for the open-ended top band. */
  max: number | null;
}

export const PM25_BANDS: readonly Pm25Band[] = [
  { band: "I", label: "Normal", min: 0, max: 55 },
  { band: "II", label: "Elevated", min: 56, max: 150 },
  { band: "III", label: "High", min: 151, max: 250 },
  { band: "IV", label: "Very High", min: 251, max: null },
];

/** The band of a 1-hour PM2.5 reading; null for no reading (never treated as 0) or an invalid value. */
export function pm25Band(value: number | null): Pm25Band | null {
  if (value === null || !Number.isFinite(value) || value < 0) return null;
  // Readings are integers; a fractional value belongs to the band whose upper bound it does not exceed.
  return PM25_BANDS.find((b) => b.max === null || value <= b.max) ?? null;
}
