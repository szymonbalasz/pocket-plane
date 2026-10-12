// Sheet roll-route registry (FR-CHAR-16, #135, OQ-CHAR-13, protocol §26). APPEND-ONLY
// (AGENTS §9.9): a feature adds one import and one line; nothing else changes here.
// Initiative / Attack ask these routes first, in order; no claim → `char.roll`.
// Contract: `RollRoute` in `./routing`. combat-tracker adds its `cbt.rollInitiative` /
// `cbt.attack` route here (FR-CBT-30).
import type { RollRoute } from "./routing";

export const rollRoutes: readonly RollRoute[] = [];
