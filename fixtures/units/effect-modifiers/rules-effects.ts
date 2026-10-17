import { loadBundle } from "../../index";

/** In-process load of MOD §13.1's `rules-effects` bundle (`bun test` only, FR-FIX-11). */
export const loadRulesEffects = (opts: { testMode?: boolean; dmSecret?: string } = {}) =>
  loadBundle("rules-effects", opts);
