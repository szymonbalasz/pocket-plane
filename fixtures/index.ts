// Fixture library: units + bundles, bound to the loader.
import type { FixtureLibrary } from "@server/features/fixtures-adapters/fixture-types";
import { type InProcessOptions, loadInProcess } from "@server/features/fixtures-adapters/loader";
import { bundles } from "./bundles";
import { units } from "./units";

export const library: FixtureLibrary = { fixtures: units, bundles };

/**
 * In-process loader for `bun test` (FR-FIX-11); `now` anchors the clock (FR-FIX-29). Served
 * from the bundle snapshot cache unless `cache: false` / `"verify"` (fixtures-adapters/cache.ts).
 */
export function loadBundle(bundle: string, opts: InProcessOptions = {}) {
  return loadInProcess(library, bundle, opts);
}
