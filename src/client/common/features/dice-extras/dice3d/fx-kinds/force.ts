// FR-DICEX-106: force dice, the DM's direction (2026-11-06): transparent blue force fields popping
// outwards. Not built yet: null keeps today's subtle effect (die-fx.ts) until this file exports a
// RichKindDef (see kind.ts and fire.ts; tests in force.test.ts).
import type { RichKindDef } from "./kind";

export const force: RichKindDef | null = null;
