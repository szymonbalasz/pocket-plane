// Roll macros (FR-DICEX-64–67, TT1): `dicex.saveMacro`, `dicex.deleteMacro`, `dicex.moveMacro`.
// A player edits rows they created (`createdBy` = them) on their own characters or "Me"; the DM's
// rows are read-only for players (review A #14). The DM edits any row; a DM macro on an owned PC
// is that player's by default ("DM only" → `playerId` null). Same values → no write, no event;
// else rows + event-log row + `MacroSaved` / `MacroDeleted` in one transaction (ADR-0016).
import {
  DeleteMacroInput,
  DICEX_MACRO_INTENTS,
  type MacroResult,
  MoveMacroInput,
  ROLL_MACRO_TYPE,
  type RollMacroRecord,
  SaveMacroInput,
} from "@shared/dice-extras/macros";
import { MacroDeleted, MacroSaved } from "@shared/events/dice-extras";
import { and, asc, eq, isNull } from "drizzle-orm";
import { type CommandEnv, defineCommand } from "../../commands/commands";
import { forbidden, notFound } from "../../commands/errors";
import type { Tx } from "../../db/client";
import { entity, rollMacro } from "../../db/schema";
import type { RecordChange } from "../../events/types";
import { campaignOf } from "../scenes-map/rows";
import { assertMacroRoom, readMacro, toMacroRecord } from "./table-rows";

type Read = Pick<Tx, "select">;
type List = { playerId: string | null; creatureId: string | null };

const NOT_FOUND = "Macro not found";
export const READ_ONLY = "The DM's macros are read-only";

const sameList = (a: List, b: List) => a.playerId === b.playerId && a.creatureId === b.creatureId;

/** One list (`playerId`, `creatureId`) in `order`. */
export function listOf(read: Read, campaignId: string, list: List): RollMacroRecord[] {
  return read
    .select()
    .from(rollMacro)
    .where(
      and(
        eq(rollMacro.campaignId, campaignId),
        list.playerId === null ? isNull(rollMacro.playerId) : eq(rollMacro.playerId, list.playerId),
        list.creatureId === null
          ? isNull(rollMacro.creatureId)
          : eq(rollMacro.creatureId, list.creatureId),
      ),
    )
    .orderBy(asc(rollMacro.order), asc(rollMacro.id))
    .all()
    .map(toMacroRecord);
}

/** Writes `order` 0…n-1 over `rows` (ids in their new order); the changed rows' upserts. */
export function writeOrder(
  env: Pick<CommandEnv, "tx" | "ctx">,
  campaignId: string,
  rows: readonly RollMacroRecord[],
): RecordChange[] {
  const out: RecordChange[] = [];
  rows.forEach((r, order) => {
    if (r.order === order) return;
    env.tx
      .update(rollMacro)
      .set({ order, updatedAt: env.ctx.clock.iso() })
      .where(eq(rollMacro.id, r.id))
      .run();
    out.push({
      type: ROLL_MACRO_TYPE,
      id: r.id,
      before: r,
      after: readMacro(env.tx, campaignId, r.id),
    });
  });
  return out;
}

/**
 * FR-DICEX-65: the creature a macro rolls as. Player: an own character (another's → `forbidden`,
 * unknown / a monster → `not_found`). DM: any creature of the campaign. Returns the PC's owner.
 */
function creatureOwner(env: CommandEnv, campaignId: string, creatureId: string): string | null {
  const row = env.tx
    .select({ kind: entity.kind, owner: entity.ownerPlayerId })
    .from(entity)
    .where(and(eq(entity.id, creatureId), eq(entity.campaignId, campaignId)))
    .get();
  if (env.actor.role === "player") {
    if (row?.kind !== "character") throw notFound("Character not found");
    if (row.owner !== env.actor.playerId) throw forbidden("Not your character");
    return row.owner;
  }
  if (!row) throw notFound("Creature not found");
  return row.kind === "character" ? row.owner : null;
}

/** A macro the actor may change: player → own visible row they created; DM → any. */
function editableMacro(env: CommandEnv, campaignId: string, id: string): RollMacroRecord {
  const m = readMacro(env.tx, campaignId, id);
  if (env.actor.role === "player") {
    if (!m || m.playerId !== env.actor.playerId) throw notFound(NOT_FOUND);
    if (m.createdBy !== env.actor.playerId) throw forbidden(READ_ONLY);
    return m;
  }
  if (!m) throw notFound(NOT_FOUND);
  return m;
}

/** FR-DICEX-65: whose list a saved macro joins. */
function targetList(
  env: CommandEnv,
  input: SaveMacroInput,
  owner: string | null,
  before: RollMacroRecord | null,
): List {
  const creatureId = input.creatureId;
  if (env.actor.role === "player") return { playerId: env.actor.playerId, creatureId };
  if (input.dmOnly) return { playerId: null, creatureId };
  if (owner !== null) return { playerId: owner, creatureId };
  // A player's own general macro edited by the DM stays theirs.
  if (before && before.creatureId === creatureId) return { playerId: before.playerId, creatureId };
  return { playerId: null, creatureId };
}

export const saveMacro = defineCommand({
  name: DICEX_MACRO_INTENTS.saveMacro,
  input: SaveMacroInput,
  roles: ["dm", "player"],
  authorize(input, env) {
    if (env.actor.role === "player" && input.dmOnly !== undefined) {
      throw forbidden("Only the DM can hide a macro");
    }
  },
  execute(input, env): MacroResult {
    const cid = campaignOf(env.actor);
    const before = input.id === undefined ? null : editableMacro(env, cid, input.id);
    const owner = input.creatureId === null ? null : creatureOwner(env, cid, input.creatureId);
    const list = targetList(env, input, owner, before);
    const fields = {
      name: input.name,
      expression: input.expression,
      category: input.category,
      ...list,
    };
    if (
      before &&
      before.name === fields.name &&
      before.expression === fields.expression &&
      before.category === fields.category &&
      sameList(before, list)
    ) {
      return { macroId: before.id };
    }
    const now = env.ctx.clock.iso();
    const moved = before !== null && !sameList(before, list);
    if (!before || moved) assertMacroRoom(env.tx, cid, list);
    const order = before && !moved ? before.order : listOf(env.tx, cid, list).length;
    const id = before?.id ?? env.ctx.ids.next();
    if (before) {
      env.tx
        .update(rollMacro)
        .set({ ...fields, order, updatedAt: now })
        .where(eq(rollMacro.id, id))
        .run();
    } else {
      const createdBy = env.actor.role === "player" ? env.actor.playerId : null;
      env.tx
        .insert(rollMacro)
        .values({ id, campaignId: cid, ...fields, order, createdBy, updatedAt: now })
        .run();
    }
    const changes: RecordChange[] = [
      { type: ROLL_MACRO_TYPE, id, before, after: readMacro(env.tx, cid, id) },
    ];
    // The old list closes its gap.
    if (before && moved) changes.push(...writeOrder(env, cid, listOf(env.tx, cid, before)));
    env.emit({ type: MacroSaved.type, campaignId: cid, payload: { macroId: id }, changes });
    return { macroId: id };
  },
});

export const deleteMacro = defineCommand({
  name: DICEX_MACRO_INTENTS.deleteMacro,
  input: DeleteMacroInput,
  roles: ["dm", "player"],
  execute({ id }, env): MacroResult {
    const cid = campaignOf(env.actor);
    const before = editableMacro(env, cid, id);
    env.tx.delete(rollMacro).where(eq(rollMacro.id, id)).run();
    const changes: RecordChange[] = [
      { type: ROLL_MACRO_TYPE, id, before, after: null },
      ...writeOrder(env, cid, listOf(env.tx, cid, before)),
    ];
    env.emit({ type: MacroDeleted.type, campaignId: cid, payload: { macroId: id }, changes });
    return { macroId: id };
  },
});

export const moveMacro = defineCommand({
  name: DICEX_MACRO_INTENTS.moveMacro,
  input: MoveMacroInput,
  roles: ["dm", "player"],
  execute({ id, index }, env): MacroResult {
    const cid = campaignOf(env.actor);
    const m = editableMacro(env, cid, id);
    const rows = listOf(env.tx, cid, m);
    const from = rows.findIndex((r) => r.id === id);
    const to = Math.min(index, rows.length - 1);
    if (from === to) return { macroId: id };
    const [moved] = rows.splice(from, 1);
    rows.splice(to, 0, moved as RollMacroRecord);
    const changes = writeOrder(env, cid, rows);
    env.emit({ type: MacroSaved.type, campaignId: cid, payload: { macroId: id }, changes });
    return { macroId: id };
  },
});
