import type { Pm25Band } from "../../shared/datasets/pm25-bands";

/** Colour tone of each NEA PM2.5 band, per the UI entries in Context.md (Elevated and High are both yellow). */
export type BandTone = "green" | "yellow" | "red" | "none";

const TONES: Record<Pm25Band["band"], BandTone> = {
  I: "green",
  II: "yellow",
  III: "yellow",
  IV: "red",
};

export function bandTone(band: Pm25Band | null): BandTone {
  return band ? TONES[band.band] : "none";
}
