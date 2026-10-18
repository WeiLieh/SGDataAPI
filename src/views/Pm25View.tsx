import { AirQualityScreen } from "./AirQualityScreen";
import { PM25_SCREEN } from "./screens";
import type { ViewProps } from "./TopBar";

/** PM2.5 tab: the shared air-quality screen with PM2.5 data, bands and wording. */
export function Pm25View({ onSwitch }: ViewProps) {
  return <AirQualityScreen config={PM25_SCREEN} onSwitch={onSwitch} />;
}
