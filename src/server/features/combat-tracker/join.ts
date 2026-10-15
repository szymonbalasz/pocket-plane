// Creatures joining combat, shared by Start (FR-CBT-64/65) and combat-extras' add (FR-CBTX-44):
// created tokens around an anchor cell, HP by mode (rolled → one DM-only `roll` entry). Monster
// initiative before adding: `rollInitiativeFor` (initiative.ts).
import type { GridCell, HpMode } from "@shared/combat-tracker/schemas";
import { ROLL_KIND } from "@shared/dice-roll-log/roll-kind";
import { clampRolledHp, hpRollSpec } from "@shared/entities/hp-formula";
import { type DefinitionRecord, effectiveStats, type StatBlock } from "@shared/entities/schemas";
import { cellToPx, freeCellsNear, pxToCell } from "@shared/scenes-map/geometry";
import type { SceneRecord, TokenRecord } from "@shared/scenes-map/schemas";
import type { CommandEnv } from "../../commands/commands";
import { CommandError, conflict } from "../../commands/errors";
import type { RecordChange } from "../../events/types";
import { dice, gameLog } from "../dice-roll-log";
import { placeTokenIn } from "../scenes-map/commands";
import { sceneTokens } from "../scenes-map/rows";

/** FR-CBT-65: scene / campaign token caps. */
export const SCENE_FULL = "Scene is full";

/**
 * FR-CBT-65: `at` clamped into the map (its cell's centre moved onto the map, then that cell);
 * omitted → the map's centre cell.
 */
export function anchorCell(s: SceneRecord, at?: GridCell): GridCell {
  const inside = (v: number, max: number) => Math.min(Math.max(v, 0), Math.max(0, max - 0.001));
  if (!at) return pxToCell(s, s.mapWidth / 2, s.mapHeight / 2);
  const half = s.gridCellSize / 2;
  const { x, y } = cellToPx(s, at.col, at.row);
  return pxToCell(s, inside(x + half, s.mapWidth), inside(y + half, s.mapHeight));
}

/**
 * FR-CBT-65: created tokens go to `freeCellsNear(anchor)` (FR-MAP-48), one at a time so tokens
 * placed earlier in the command count as occupied; no free cell left → the anchor (overlap
 * allowed). Each token via scenes-map's `placeTokenIn` in the caller's transaction; `changes`
 * lists the token creates for the caller's event. Caps → `conflict` "Scene is full".
 */
export class TokenPlacer {
  readonly changes: RecordChange[] = [];
  readonly at: GridCell;
  private readonly tokens: TokenRecord[];

  constructor(
    private readonly env: CommandEnv,
    private readonly scene: SceneRecord,
    at?: GridCell,
  ) {
    this.at = anchorCell(scene, at);
    this.tokens = sceneTokens(env.tx, scene.id);
  }

  place(def: DefinitionRecord, hidden: boolean): TokenRecord {
    const size = def.statBlock.size;
    const cell = freeCellsNear(this.scene, this.tokens, this.at, size, 1)[0] ?? this.at;
    try {
      const { token, change } = placeTokenIn(this.env, {
        sceneId: this.scene.id,
        definitionId: def.id,
        col: cell.col,
        row: cell.row,
        hidden,
      });
      this.tokens.push(token);
      this.changes.push(change);
      return token;
    } catch (err) {
      if (err instanceof CommandError && err.code === "conflict") throw conflict(SCENE_FULL);
      throw err;
    }
  }
}

/**
 * FR-CBT-64: a monster's HP. `average` → `effectiveStats.hpMax`; `rolled` → the definition's
 * `hpFormula` via `dice.evaluate`, clamped 1–999, plus one DM-only `roll` entry (category
 * `other`, label "HP (2d6)", actor = the combatant's name). A definition without a formula (lost
 * since the encounter was saved) → average.
 */
export function monsterHp(
  env: CommandEnv,
  def: DefinitionRecord,
  mode: HpMode,
  name: string,
  encounterId: string,
): { hp: number; entry: RecordChange | null } {
  const formula = def.statBlock.hpFormula;
  const average = effectiveStats(def as { statBlock: StatBlock }).hpMax;
  if (mode !== "rolled" || !formula) return { hp: average, entry: null };
  const expression = hpRollSpec(formula);
  const r = dice.evaluate(env, {
    expression,
    mode: "normal",
    category: "other",
    label: `HP (${expression})`,
    actor: { kind: "entity", id: def.id, name },
    source: "cbt",
  });
  const entry = gameLog.append(env, {
    kind: ROLL_KIND,
    category: "other",
    actorName: name,
    payload: [dice.rollPayloadItem(r)],
    rollIds: [r.id],
    encounterId,
    public: false,
  });
  return { hp: clampRolledHp(r.total), entry };
}
