import { AirQualityScreen } from "./AirQualityScreen";
import { PSI_SCREEN } from "./screens";
import type { ViewProps } from "./TopBar";

/** PSI tab: the shared air-quality screen with the latest 24-hour PSI (no unit), PSI bands and wording. */
export function PsiView({ onSwitch }: ViewProps) {
  return <AirQualityScreen config={PSI_SCREEN} onSwitch={onSwitch} />;
}
