// FR-DICEX-106: bludgeoning dice, the DM's direction (2026-11-06): a hammer; nothing while rolling,
// only the landing pop (whileRolling: false). Not built yet: null keeps no effect until this file
// exports a RichKindDef (see kind.ts and fire.ts; tests in bludgeoning.test.ts).
import type { RichKindDef } from "./kind";

export const bludgeoning: RichKindDef | null = null;
