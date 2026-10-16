// Explored memory codec (FR-FOG-37): a `fog-explored` row's box + runs (FR-FOG-04 codec) decoded
// as a mask whose cell 1 = explored for that player, 0 = not. Outside the box: not explored.
// Corrupt runs → nothing explored (memory only ever shows map pixels, never records). Pure.
import { decodeRuns, type FogMask } from "./mask";
import type { FogBox } from "./schemas";

export function exploredMask(row: { box: FogBox; runs: string }): FogMask {
  const n = row.box[2] * row.box[3];
  const cells = decodeRuns(row.runs, n, "clear") ?? new Uint8Array(n);
  return { fill: "clear", box: row.box, cells };
}
