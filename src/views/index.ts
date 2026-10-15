import type { ComponentType } from "react";
import type { DatasetId } from "../../shared/datasets/registry";
import { Pm25View } from "./Pm25View";

/** One screen per dataset; a dataset without a screen fails the typecheck. */
export const views = {
  pm25: Pm25View,
} satisfies Record<DatasetId, ComponentType>;
