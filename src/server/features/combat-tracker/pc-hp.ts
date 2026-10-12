// PC HP seam (FR-CBT-22): PC HP lives on the character; the only writer is character-sheet's
// `characters.adjustHp(env, characterId, delta)` (FR-CHAR-13). Not on main yet (built in
// parallel by build/character-sheet): until it merges a PC target answers `conflict`.
import type { CommandEnv } from "../../commands/commands";
import { conflict } from "../../commands/errors";
import type { RecordChange } from "../../events/types";

export interface PcHpResult {
  hpBefore: number;
  hpAfter: number;
  change: RecordChange;
}

export function adjustPcHp(
  _env: Pick<CommandEnv, "tx" | "ctx" | "actor">,
  _characterId: string,
  _delta: number,
): PcHpResult {
  throw conflict("PC HP needs character-sheet (characters.adjustHp), not merged yet");
}
