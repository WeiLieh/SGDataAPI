import { pm25Band } from "../../shared/datasets/pm25-bands";
import { psiBand } from "../../shared/datasets/psi-bands";
import type { DatasetId } from "../../shared/datasets/registry";
import { bandTone, psiTone, type BandTone } from "../lib/colors";

/** A reading's band as a screen shows it: descriptor, recommendation and colour tone. */
export interface ScreenBand {
  label: string;
  recommendation: string;
  tone: BandTone;
}

/** What differs between the PM2.5 and PSI screens; everything else is the same screen. */
export interface ScreenConfig {
  dataset: DatasetId;
  /** Title of the top card. */
  title: string;
  /** Short name used in loading and error texts. */
  name: string;
  /** Unit shown after the big number; null for an index value such as PSI. */
  unit: string | null;
  band: (value: number | null) => ScreenBand | null;
  legend: Array<{ tone: BandTone; label: string }>;
  /** Dataset name in the data.gov.sg licence credit. */
  creditName: string;
}

export const PM25_SCREEN: ScreenConfig = {
  dataset: "pm25",
  title: "Air Quality - PM2.5",
  name: "PM2.5",
  unit: "µg/m³",
  band(value) {
    const band = pm25Band(value);
    return band && { label: band.label, recommendation: band.recommendation, tone: bandTone(band) };
  },
  legend: [
    { tone: "green", label: "0–55" },
    { tone: "yellow", label: "56–150" },
    { tone: "orange", label: "151–250" },
    { tone: "red", label: "≥251" },
  ],
  creditName: "PM2.5",
};

export const PSI_SCREEN: ScreenConfig = {
  dataset: "psi",
  title: "Air Quality - PSI",
  name: "PSI",
  unit: null,
  band(value) {
    const band = psiBand(value);
    return band && { label: band.label, recommendation: band.recommendation, tone: psiTone(band) };
  },
  legend: [
    { tone: "green", label: "0–50" },
    { tone: "yellow", label: "51–100" },
    { tone: "amber", label: "101–200" },
    { tone: "orange", label: "201–300" },
    { tone: "red", label: "≥301" },
  ],
  creditName: "Pollutant Standards Index (PSI)",
};
