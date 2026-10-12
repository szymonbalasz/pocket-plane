// Fixture library: units + bundles, bound to the loader.
import type { FixtureLibrary } from "@server/features/fixtures-adapters/fixture-types";
import { loadInProcess } from "@server/features/fixtures-adapters/loader";
import { bundles } from "./bundles";
import { units } from "./units";

export const library: FixtureLibrary = { fixtures: units, bundles };

/** In-process loader for `bun test` (FR-FIX-11). */
export function loadBundle(bundle: string, opts: { testMode?: boolean; dmSecret?: string } = {}) {
  return loadInProcess(library, bundle, opts);
}
