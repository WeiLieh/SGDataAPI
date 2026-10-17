/**
 * PSI bands from the owner's table (2026-10-16, following NEA): descriptor and health
 * recommendation per band. PSI is an index value with no unit. Colours live in src/lib/colors.ts.
 */
export interface PsiBand {
  label: "Good" | "Moderate" | "Unhealthy" | "Very Unhealthy" | "Hazardous";
  min: number;
  /** Inclusive upper bound; null for the open-ended top band. */
  max: number | null;
  recommendation: string;
}

export const PSI_BANDS: readonly PsiBand[] = [
  { label: "Good", min: 0, max: 50, recommendation: "Normal activities for everyone." },
  { label: "Moderate", min: 51, max: 100, recommendation: "Normal activities for everyone." },
  {
    label: "Unhealthy",
    min: 101,
    max: 200,
    recommendation: "Reduce prolonged or strenuous outdoor physical exertion.",
  },
  {
    label: "Very Unhealthy",
    min: 201,
    max: 300,
    recommendation: "Avoid prolonged or strenuous outdoor physical exertion.",
  },
  { label: "Hazardous", min: 301, max: null, recommendation: "Minimise or avoid all outdoor activity." },
];

/** The band of a 24-hour PSI value; null for no reading (never treated as 0) or an invalid value. */
export function psiBand(value: number | null): PsiBand | null {
  if (value === null || !Number.isFinite(value) || value < 0) return null;
  return PSI_BANDS.find((b) => b.max === null || value <= b.max) ?? null;
}
