import type { Pm25Band } from "../../shared/datasets/pm25-bands";
import type { PsiBand } from "../../shared/datasets/psi-bands";

/**
 * Colour tones used by the screens; the colours themselves are CSS variables in styles.css.
 * "amber" is the darker yellow of PSI's Unhealthy band.
 */
export type BandTone = "green" | "yellow" | "amber" | "orange" | "red" | "none";

/** PM2.5, per Context.md: Normal green, Elevated yellow, High orange, Very High red. */
const PM25_TONES: Record<Pm25Band["band"], BandTone> = {
  I: "green",
  II: "yellow",
  III: "orange",
  IV: "red",
};

export function bandTone(band: Pm25Band | null): BandTone {
  return band ? PM25_TONES[band.band] : "none";
}

/**
 * PSI, per Context.md: Good green, Moderate yellow, Unhealthy a darker yellow (#F2A900, first
 * pass), Very Unhealthy orange, Hazardous red.
 */
const PSI_TONES: Record<PsiBand["label"], BandTone> = {
  Good: "green",
  Moderate: "yellow",
  Unhealthy: "amber",
  "Very Unhealthy": "orange",
  Hazardous: "red",
};

export function psiTone(band: PsiBand | null): BandTone {
  return band ? PSI_TONES[band.label] : "none";
}
