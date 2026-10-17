import { useState } from "react";
import type { DatasetId } from "../shared/datasets/registry";
import { views } from "./views";

export function App() {
  // Always opens on PM2.5; the chosen tab is not remembered (owner's decision).
  const [active, setActive] = useState<DatasetId>("pm25");
  const View = views[active];
  return <View onSwitch={setActive} />;
}
