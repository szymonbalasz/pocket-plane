// FR-SCN-29/30 on the client: the campaign's diagonal rule from the store's `map-settings` row (no
// row = `5-10-5`) and the distance texts that follow it: the ruler (FR-MAP-22) and the drag's
// movement indicator (FR-MAP-37). One distance fn for everyone: `distanceFt(a, b, rule)`.
// DOM-free.
import type { RecordMap } from "@shared/protocol/store";
import { distanceFt } from "@shared/scene-tools/geometry";
import {
  DEFAULT_DIAGONAL_RULE,
  DiagonalRule,
  MAP_SETTINGS_TYPE,
} from "@shared/scene-tools/schemas";

type Cell = { col: number; row: number };

/** The rule in the store: the campaign's one `map-settings` row, else the default. */
export function diagonalRuleIn(records: RecordMap): DiagonalRule {
  const rows = records[MAP_SETTINGS_TYPE];
  const row = rows ? (Object.values(rows)[0] as { diagonalRule?: unknown } | undefined) : undefined;
  const r = DiagonalRule.safeParse(row?.diagonalRule);
  return r.success ? r.data : DEFAULT_DIAGONAL_RULE;
}

/** Ruler label (FR-MAP-22) under the campaign's rule. */
export const rulerText = (a: Cell, b: Cell, rule: DiagonalRule): string =>
  `${distanceFt(a, b, rule)} ft`;

/** The Ruler panel's "Diagonals" choices (SCN §7). */
export const DIAGONAL_OPTIONS: readonly { rule: DiagonalRule; label: string; hint: string }[] = [
  { rule: "5-10-5", label: "5/10/5", hint: "Every second diagonal counts 10 ft" },
  { rule: "5", label: "5 ft", hint: "Every diagonal counts 5 ft" },
];
