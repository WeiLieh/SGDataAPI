import type { Pm25Band } from "../../shared/datasets/pm25-bands";
import type { PsiBand } from "../../shared/datasets/psi-bands";

/** Colour tone of each NEA PM2.5 band, per the UI entries in Context.md (Normal green, Elevated yellow, High orange, Very High red). */
export type BandTone = "green" | "yellow" | "orange" | "red" | "none";

const TONES: Record<Pm25Band["band"], BandTone> = {
  I: "green",
  II: "yellow",
  III: "orange",
  IV: "red",
};

export function bandTone(band: Pm25Band | null): BandTone {
  return band ? TONES[band.band] : "none";
}

/**
 * PSI band colours, per the UI entries in Context.md: Good green, Moderate yellow, Unhealthy a
 * darker yellow (first pass, between Moderate and Very Unhealthy), Very Unhealthy orange,
 * Hazardous red.
 */
export const PSI_COLOURS: Record<PsiBand["label"], string> = {
  Good: "#1e7b34",
  Moderate: "#ffcd00",
  Unhealthy: "#f2a900",
  "Very Unhealthy": "#f28c28",
  Hazardous: "#d93025",
};
