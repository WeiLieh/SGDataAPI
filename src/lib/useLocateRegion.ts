import { useCallback, useRef, useState } from "react";
import type { Pm25Region } from "../../shared/datasets/pm25";
import { DEFAULT_REGION, nearestRegion } from "./regions";

/** Wait at most this long for a position before falling back to Central (owner's choice). */
export const LOCATE_TIMEOUT_MS = 5000;

export type LocateStatus = "idle" | "locating" | "fallback";

/**
 * Asks the browser for the phone's position only when `locate` is called (a tap on
 * "Use my location"). The position is used here, on the phone, and never sent or stored.
 */
export function useLocateRegion(
  regions: Pm25Region[],
  onRegion: (id: string) => void,
): { status: LocateStatus; locate: () => void } {
  const [status, setStatus] = useState<LocateStatus>("idle");
  const run = useRef(0);

  const locate = useCallback(() => {
    const id = ++run.current;
    let settled = false;
    const finish = (region: string | null) => {
      if (settled || id !== run.current) return;
      settled = true;
      clearTimeout(timer);
      onRegion(region ?? DEFAULT_REGION);
      setStatus(region ? "idle" : "fallback");
    };
    const timer = setTimeout(() => finish(null), LOCATE_TIMEOUT_MS);
    setStatus("locating");

    if (!("geolocation" in navigator)) {
      finish(null);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => finish(nearestRegion(position.coords.latitude, position.coords.longitude, regions)),
      () => finish(null),
      { enableHighAccuracy: false, timeout: LOCATE_TIMEOUT_MS, maximumAge: 10 * 60 * 1000 },
    );
  }, [regions, onRegion]);

  return { status, locate };
}
