import type { Pm25Region } from "../../shared/datasets/pm25";

export const DEFAULT_REGION = "central";
const STORAGE_KEY = "sgweather.region";

/** Rough bounding box of Singapore; a position outside it falls back to Central. */
const SINGAPORE = { minLat: 1.15, maxLat: 1.48, minLon: 103.6, maxLon: 104.1 };

export function isInSingapore(latitude: number, longitude: number): boolean {
  return (
    latitude >= SINGAPORE.minLat &&
    latitude <= SINGAPORE.maxLat &&
    longitude >= SINGAPORE.minLon &&
    longitude <= SINGAPORE.maxLon
  );
}

/** The region whose data.gov.sg label point is nearest; Central outside Singapore. */
export function nearestRegion(latitude: number, longitude: number, regions: Pm25Region[]): string {
  if (!isInSingapore(latitude, longitude)) return DEFAULT_REGION;
  // At Singapore's latitude a degree of longitude is almost exactly a degree of latitude.
  let best: { id: string; distance: number } | null = null;
  for (const region of regions) {
    if (region.latitude === null || region.longitude === null) continue;
    const distance = Math.hypot(region.latitude - latitude, region.longitude - longitude);
    if (!best || distance < best.distance) best = { id: region.id, distance };
  }
  return best?.id ?? DEFAULT_REGION;
}

/** The region to show: the remembered one if it exists in the data, else Central, else the first. */
export function resolveRegion(remembered: string | null, regions: Pm25Region[]): string | null {
  const ids = regions.map((r) => r.id);
  if (remembered && ids.includes(remembered)) return remembered;
  if (ids.includes(DEFAULT_REGION)) return DEFAULT_REGION;
  return ids[0] ?? null;
}

/** Only the region id is stored on the phone, never a reading. Storage may be unavailable. */
export function loadRememberedRegion(): string | null {
  try {
    return globalThis.localStorage?.getItem(STORAGE_KEY) ?? null;
  } catch {
    return null;
  }
}

export function rememberRegion(id: string): void {
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, id);
  } catch {
    // Private mode or blocked storage: the choice simply isn't remembered.
  }
}
