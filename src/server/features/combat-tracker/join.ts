// Creatures joining combat, shared by Start (FR-CBT-64/65) and combat-extras' add (FR-CBTX-44):
// created tokens around an anchor cell, HP by mode (rolled → one DM-only `roll` entry). Monster
// initiative before adding: `rollInitiativeFor` (initiative.ts). Sprint 7 (FR-CBT-141): a monster
// binding a token from an earlier fight keeps that fight's HP; a pet's tokens keep its owner
// (FR-MAP-88's safety net).
import type { GridCell, HpMode } from "@shared/combat-tracker/schemas";
import { ROLL_KIND } from "@shared/dice-roll-log/roll-kind";
import { clampRolledHp, hpRollSpec } from "@shared/entities/hp-formula";
import {
  type DefinitionRecord,
  effectiveStats,
  type MonsterRecord,
  type StatBlock,
} from "@shared/entities/schemas";
import { cellToPx, freeCellsNear, pxToCell } from "@shared/scenes-map/geometry";
import type { SceneRecord, TokenRecord } from "@shared/scenes-map/schemas";
import { and, asc, eq } from "drizzle-orm";
import type { CommandEnv } from "../../commands/commands";
import { CommandError, conflict } from "../../commands/errors";
import type { Tx } from "../../db/client";
import { combatant, encounter, gameLogEntry, token } from "../../db/schema";
import type { RecordChange } from "../../events/types";
import { dice, gameLog } from "../dice-roll-log";
import { placeTokenIn } from "../scenes-map/commands";
import { sceneTokens } from "../scenes-map/rows";
import { setTokenOwnerIn } from "../scenes-map/token-owner";

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
 * lists the token creates (each followed by its fog re-derive rows, FR-FOG-35) for the caller's
 * event. Caps → `conflict` "Scene is full". Image: `imageOf`.
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

  /** `ownerPlayerId` (sprint 6, FR-MAP-75): a summon's token takes its owner's player. */
  place(def: DefinitionRecord, hidden: boolean, ownerPlayerId?: string): TokenRecord {
    const size = def.statBlock.size;
    const cell = freeCellsNear(this.scene, this.tokens, this.at, size, 1)[0] ?? this.at;
    try {
      const { token, change, dependants } = placeTokenIn(this.env, {
        sceneId: this.scene.id,
        definitionId: def.id,
        col: cell.col,
        row: cell.row,
        hidden,
        ...(ownerPlayerId !== undefined ? { ownerPlayerId } : {}),
        ...this.imageOf(def),
      });
      this.tokens.push(token);
      // FR-FOG-35 (#216): a placed PC token is a vision source; its re-derive rows follow it.
      this.changes.push(change, ...dependants);
      return token;
    } catch (err) {
      if (err instanceof CommandError && err.code === "conflict") throw conflict(SCENE_FULL);
      throw err;
    }
  }

  /**
   * FR-CBT-65 (sim-5 glitch 4): the portrait (`placeTokenIn`'s default); none (imported
   * definitions never have one) → the image of the definition's latest token on this scene, as
   * Ctrl-D copies it (FR-MAP-17); none there either → no image.
   */
  private imageOf(def: DefinitionRecord): { imageAssetId?: string } {
    if (def.portraitAssetId) return {};
    const art = this.tokens.findLast((t) => t.definitionId === def.id && t.imageAssetId !== null);
    return art?.imageAssetId ? { imageAssetId: art.imageAssetId } : {};
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

/** FR-CBT-141: a token's last combatant (the latest-ended inactive row with that `tokenId`). */
export interface KeptHp {
  entityId: string;
  encounterId: string;
  name: string;
  hp: number;
  hpMax: number;
}

/**
 * FR-CBT-141 (sprint 7, OQ-CBT-92 A): per token id, its last combatant in an ended encounter of
 * the campaign (latest `endedAt`, ties → the higher `seq`). One pass over the campaign's monster
 * combatant rows; no column (derived in the binding command's transaction).
 */
export function keptHpByToken(tx: Tx, cid: string): Map<string, KeptHp> {
  const rows = tx
    .select({
      tokenId: combatant.tokenId,
      entityId: combatant.entityId,
      encounterId: combatant.encounterId,
      name: combatant.name,
      hp: combatant.hpCurrent,
      hpMax: combatant.hpMax,
    })
    .from(combatant)
    .innerJoin(encounter, eq(encounter.id, combatant.encounterId))
    .where(
      and(
        eq(combatant.campaignId, cid),
        eq(combatant.kind, "monster"),
        eq(combatant.active, false),
        eq(encounter.status, "ended"),
      ),
    )
    .orderBy(asc(encounter.endedAt), asc(combatant.seq))
    .all();
  const out = new Map<string, KeptHp>();
  for (const r of rows) {
    if (r.tokenId === null || r.hp === null || r.hpMax === null) continue;
    const { entityId, encounterId, name, hp, hpMax } = r;
    // Ordered oldest first: the last write per token is its latest-ended row.
    out.set(r.tokenId, { entityId, encounterId, name, hp, hpMax });
  }
  return out;
}

/** FR-CBT-141: the token's kept row if it was the same creature (`entityId`), else none. */
export const keptFor = (
  kept: ReadonlyMap<string, KeptHp>,
  tokenId: string | null,
  entityId: string,
): KeptHp | null => {
  const k = tokenId ? kept.get(tokenId) : undefined;
  return k && k.entityId === entityId ? k : null;
};

/** FR-CBT-141's binding order: a token kept at 0 binds after the living ones (then by `seq`). */
export const downedLast = <T extends { id: string; definitionId: string; seq: number }>(
  tokens: readonly T[],
  kept: ReadonlyMap<string, KeptHp>,
): T[] => {
  const down = (t: T) => (keptFor(kept, t.id, t.definitionId)?.hp === 0 ? 1 : 0);
  return [...tokens].sort((a, b) => down(a) - down(b) || a.seq - b.seq);
};

/**
 * FR-CBT-141: the HP a kept row starts with: its `hpMax` / `hpCurrent` (a rolled max kept);
 * when an average row's max no longer matches the definition's (edited since), FR-CBT-06 / -67's
 * rule: the new max, a full row stays full, else clamped. "Rolled" = the old fight logged its
 * DM-only "HP (…)" roll for it (`monsterHp`). Not an `hp_change` (no fact, seams S8).
 */
export function keptHp(tx: Tx, k: KeptHp, def: DefinitionRecord): { hp: number; hpMax: number } {
  const max = effectiveStats(def as { statBlock: StatBlock }).hpMax;
  if (k.hpMax === max || rolledIn(tx, k)) return { hp: Math.min(k.hp, k.hpMax), hpMax: k.hpMax };
  return { hpMax: max, hp: k.hp === k.hpMax ? max : Math.min(k.hp, max) };
}

function rolledIn(tx: Tx, k: KeptHp): boolean {
  return tx
    .select({ payload: gameLogEntry.payload })
    .from(gameLogEntry)
    .where(
      and(
        eq(gameLogEntry.encounterId, k.encounterId),
        eq(gameLogEntry.kind, ROLL_KIND),
        eq(gameLogEntry.actorName, k.name),
        eq(gameLogEntry.public, false),
      ),
    )
    .all()
    .some((e) => {
      const first = Array.isArray(e.payload) ? (e.payload[0] as { label?: unknown }) : null;
      return typeof first?.label === "string" && first.label.startsWith("HP (");
    });
}

/**
 * FR-MAP-88 (sprint 7): every token of a joining pet carries the pet's owner. A safety net only
 * (nothing clears it today, FU0's replay): rows only where a token differs.
 */
export function petTokenOwners(env: CommandEnv, pet: MonsterRecord): RecordChange[] {
  const ids = env.tx
    .select({ id: token.id })
    .from(token)
    .where(eq(token.definitionId, pet.id))
    .orderBy(asc(token.seq))
    .all();
  return ids.flatMap((t) => setTokenOwnerIn(env, t.id, pet.ownerPlayerId));
}
