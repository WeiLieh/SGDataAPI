import { pm25 } from "./pm25.js";
import type { AnyDatasetDefinition } from "./types.js";

/** Every dataset the app serves. Adding a dataset: see "How to add a dataset" in README.md. */
export const registry = {
  pm25,
} satisfies Record<string, AnyDatasetDefinition>;

export type DatasetId = keyof typeof registry;

export const datasetIds = Object.keys(registry) as DatasetId[];

export function isDatasetId(value: string): value is DatasetId {
  return Object.hasOwn(registry, value);
}
