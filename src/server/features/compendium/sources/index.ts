// Bundled sources (FR-CMP-06): repo files only, never the network. `cmp.import` takes a key from
// here, never client data (OQ-CMP-17). Loaded and adapted once per process (both are pure).
import { type AdapterResult, adaptOpen5e } from "../adapter/open5e";
import { type BundledSource, loadSrd51 } from "./srd-5.1";

export const BUNDLED_SOURCE_KEYS = ["srd-5.1"] as const;
export type BundledSourceKey = (typeof BUNDLED_SOURCE_KEYS)[number];

const loaders: Record<BundledSourceKey, () => BundledSource> = { "srd-5.1": loadSrd51 };

export interface AdaptedSource {
  bundled: BundledSource;
  adapted: AdapterResult;
}

const cache = new Map<BundledSourceKey, AdaptedSource>();

export function bundledSource(key: BundledSourceKey): AdaptedSource {
  let s = cache.get(key);
  if (!s) {
    const bundled = loaders[key]();
    s = { bundled, adapted: adaptOpen5e(bundled.responses) };
    cache.set(key, s);
  }
  return s;
}
