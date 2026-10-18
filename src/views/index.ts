import type { ComponentType } from "react";
import type { DatasetId } from "../../shared/datasets/registry";
import { Pm25View } from "./Pm25View";
import { PsiView } from "./PsiView";
import type { ViewProps } from "./TopBar";

/** One screen per dataset; a dataset without a screen fails the typecheck. */
export const views = {
  pm25: Pm25View,
  psi: PsiView,
} satisfies Record<DatasetId, ComponentType<ViewProps>>;
