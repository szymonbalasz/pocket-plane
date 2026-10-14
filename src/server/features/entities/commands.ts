// entities.create / entities.update (FR-ENT-04, 07–12, 17, 19), their internal create / update
// (`createIn` / `updateIn`, CHARX OQ-CHARX-19) and resolveDefinition.
// DM authority; campaign = `actor.campaignId`, fixed at request authentication (CON-21).
import {
  type CharacterStatBlock,
  CreateEntityBody,
  type DefinitionRecord,
  ENTITY_TYPE,
  type EntityKind,
  type EntityRecord,
  entityNameKey,
  kindRegistry,
  type StatBlock,
  UpdateEntityBody,
  withClassTotals,
} from "@shared/entities/schemas";
import { EntityCreated, EntityUpdated } from "@shared/events/entities";
import type { Issue } from "@shared/protocol/codes";
import { and, eq, isNull, or } from "drizzle-orm";
import type { z } from "zod";
import { type CommandEnv, defineCommand, IdSchema } from "../../commands/commands";
import { conflict, forbidden, invalid, notFound, zodIssues } from "../../commands/errors";
import type { Tx } from "../../db/client";
import { entity, player } from "../../db/schema";
import type { Actor, RecordChange } from "../../events/types";
import { requireAsset } from "../assets-pipeline/commands";
import type { DefinitionHooks } from "./definition-hooks";
import { getRow, toDefinitionRecord, toEntityRecord } from "./rows";

export const CREATE = "entities.create";
export const UPDATE = "entities.update";

export const READ_ONLY_MESSAGE = "Imported definitions are read-only. Derive a custom one.";

type Env = { tx: Tx; actor: Actor };
/** What the internal create / update need: a command env minus `emit` (they never emit). */
export type EntityEnv = Pick<CommandEnv, "tx" | "ctx" | "actor">;

function campaignOf(actor: Actor): string {
  if (!actor.campaignId) throw conflict("No active campaign");
  return actor.campaignId;
}

/**
 * FR-ENT-12: a definition that is global or in the actor's campaign, else `not_found`.
 * Every command storing a definition reference uses it. Invalid stored row → `internal`.
 */
export function resolveDefinition(env: Env, id: string): DefinitionRecord {
  const cid = env.actor.campaignId;
  const row = env.tx
    .select()
    .from(entity)
    .where(
      and(
        eq(entity.id, id),
        cid ? or(isNull(entity.campaignId), eq(entity.campaignId, cid)) : isNull(entity.campaignId),
      ),
    )
    .get();
  if (!row) throw notFound("Definition not found");
  return toDefinitionRecord(row);
}

/** FR-ENT-08: unique case-insensitive among the campaign's entities of that kind. */
function assertNameFree(tx: Tx, cid: string, kind: EntityKind, name: string, exceptId?: string) {
  const key = entityNameKey(name);
  const clash = tx
    .select({ id: entity.id, name: entity.name })
    .from(entity)
    .where(and(eq(entity.campaignId, cid), eq(entity.kind, kind)))
    .all()
    .some((e) => e.id !== exceptId && entityNameKey(e.name) === key);
  if (clash) throw conflict(`A ${kind} named "${name}" already exists in this campaign`);
}

/** FR-ENT-10: owner must be a player of the campaign. */
function assertOwner(tx: Tx, cid: string, ownerPlayerId: string) {
  const row = tx
    .select({ id: player.id })
    .from(player)
    .where(and(eq(player.id, ownerPlayerId), eq(player.campaignId, cid)))
    .get();
  if (!row) {
    throw invalid("Owner must be a player of this campaign", [
      { path: ["ownerPlayerId"], message: "Not a player of this campaign" },
    ]);
  }
}

function portrait(env: Env, id: string | null | undefined): string | null {
  if (id === undefined || id === null) return null;
  return requireAsset(env, id).id;
}

const stored = (tx: Tx, id: string) =>
  toEntityRecord(getRow(tx, id) as NonNullable<ReturnType<typeof getRow>>);

export type CreateEntityInput = z.output<typeof CreateEntityBody>;

/**
 * Internal create (CHARX FR-CHARX-08, OQ-CHARX-19): the `POST` path minus HTTP and the event.
 * Validated body in; the caller emits its own event with `change`. Character blocks get
 * `level` / `className` from `classes` (FR-CHARX-04); `hpCurrent = hpMax`.
 */
export function createIn(
  env: EntityEnv,
  input: CreateEntityInput,
): { record: EntityRecord; change: RecordChange } {
  const { tx, ctx } = env;
  const cid = campaignOf(env.actor);
  assertNameFree(tx, cid, input.kind, input.name);
  const portraitAssetId = portrait(env, input.portraitAssetId);
  let derivedFromId: string | null = null;
  let ownerPlayerId: string | null = null;
  let hpCurrent: number | null = null;
  let statBlock: StatBlock = input.statBlock;
  if (input.kind === "monster") {
    if (input.derivedFromId !== undefined) {
      const base = resolveDefinition(env, input.derivedFromId);
      if (base.kind !== "monster") throw notFound("Definition not found");
      derivedFromId = base.id;
    }
  } else {
    assertOwner(tx, cid, input.ownerPlayerId);
    ownerPlayerId = input.ownerPlayerId;
    statBlock = withClassTotals(input.statBlock);
    hpCurrent = statBlock.hpMax;
  }
  const id = ctx.ids.next();
  const now = ctx.clock.iso();
  tx.insert(entity)
    .values({
      id,
      kind: input.kind,
      campaignId: cid,
      name: input.name,
      portraitAssetId,
      tokenShape: input.tokenShape ?? null,
      statBlock,
      ownerPlayerId,
      hpCurrent,
      derivedFromId,
      createdAt: now,
      updatedAt: now,
    })
    .run();
  const record = stored(tx, id);
  return { record, change: { type: ENTITY_TYPE, id, before: null, after: record } };
}

/** `entities.create` incl. derive (FR-ENT-04, 08, 09, 10, 17). */
export const createEntity = defineCommand({
  name: CREATE,
  input: CreateEntityBody,
  execute(input, env): EntityRecord {
    const { record, change } = createIn(env, input);
    env.emit({
      type: EntityCreated.type,
      campaignId: record.campaignId,
      payload: {
        entityId: record.id,
        kind: record.kind,
        ...(record.derivedFromId ? { derivedFromId: record.derivedFromId } : {}),
      },
      changes: [change],
    });
    return record;
  },
});

export const UpdateEntityInput = UpdateEntityBody.extend({ id: IdSchema });

/**
 * What `updateIn` writes: the `PUT` body (whole replace, FR-ENT-11) plus, for characters, an
 * optional `hpCurrent` the caller decided (CHARX FR-CHARX-15, see `followHpMax`); still clamped
 * to 0…hpMax. Absent → FR-ENT-11's clamp.
 */
export type UpdateNext = z.output<typeof UpdateEntityBody> & { hpCurrent?: number };

/**
 * FR-CHARX-15 (FR-CBT-06's rule): `hpCurrent` after an HP max change. A draft always follows
 * the new max; otherwise full HP follows it, anything else is clamped (FR-ENT-11).
 */
export function followHpMax(
  before: { hpCurrent: number; hpMax: number },
  hpMaxAfter: number,
  opts: { draft: boolean },
): number {
  if (opts.draft || before.hpCurrent === before.hpMax) return hpMaxAfter;
  return Math.min(before.hpCurrent, hpMaxAfter);
}

/**
 * Internal update (CHARX FR-CHARX-13/15, OQ-CHARX-19): the `PUT` path minus HTTP and the event,
 * definition-changed hooks included (FR-ENT-19). `changes` = the `entity` change, then every
 * hook-changed row, for the caller's event. Imported → `forbidden`; other campaign → `not_found`.
 */
export function updateIn(
  env: EntityEnv,
  id: string,
  next: UpdateNext,
  hooks: DefinitionHooks,
): { before: EntityRecord; record: EntityRecord; changes: RecordChange[] } {
  const { tx, ctx, actor } = env;
  const row = getRow(tx, id);
  // FR-ENT-07: imported → forbidden, no change, event or log entry.
  if (row && row.campaignId === null) throw forbidden(READ_ONLY_MESSAGE);
  const cid = campaignOf(actor);
  if (!row || row.campaignId !== cid) throw notFound("Definition not found");
  const before = toEntityRecord(row);

  const parsed = kindRegistry[before.kind].statBlock.safeParse(next.statBlock);
  if (!parsed.success) {
    const issues: Issue[] = zodIssues(parsed.error).map((i) => ({
      path: ["statBlock", ...i.path],
      message: i.message,
    }));
    throw invalid("Invalid stat block", issues);
  }
  let statBlock: StatBlock = parsed.data;
  let ownerPlayerId: string | null = null;
  let hpCurrent: number | null = null;
  if (before.kind === "monster") {
    if (next.ownerPlayerId !== undefined) {
      throw invalid("Monsters have no owner", [
        { path: ["ownerPlayerId"], message: "Not allowed for monsters" },
      ]);
    }
    if (next.hpCurrent !== undefined) throw new Error("Monster definitions have no hpCurrent");
  } else {
    if (next.ownerPlayerId === undefined) {
      throw invalid("Characters need an owner", [{ path: ["ownerPlayerId"], message: "Required" }]);
    }
    assertOwner(tx, cid, next.ownerPlayerId);
    ownerPlayerId = next.ownerPlayerId;
    const block = withClassTotals(parsed.data as CharacterStatBlock);
    statBlock = block;
    // FR-ENT-11: clamp to the new hpMax in the same transaction.
    hpCurrent = Math.max(0, Math.min(next.hpCurrent ?? before.hpCurrent, block.hpMax));
  }
  assertNameFree(tx, cid, before.kind, next.name, before.id);
  const portraitAssetId = portrait(env, next.portraitAssetId);

  tx.update(entity)
    .set({
      name: next.name,
      portraitAssetId,
      // FR-ENT-11/22: whole replace; omitted → null. Placed tokens keep their shape.
      tokenShape: next.tokenShape ?? null,
      statBlock,
      ownerPlayerId,
      hpCurrent,
      updatedAt: ctx.clock.iso(),
    })
    .where(eq(entity.id, before.id))
    .run();
  const record = stored(tx, before.id);
  // FR-ENT-19: instance refreshes inside this transaction; a throw rolls everything back.
  const hookChanges = hooks.run({ tx, ctx, actor }, before, record);
  return {
    before,
    record,
    changes: [{ type: ENTITY_TYPE, id: before.id, before, after: record }, ...hookChanges],
  };
}

/** `entities.update`: whole replace (FR-ENT-07, 11, 17, 19). */
export function updateEntityCommand(hooks: DefinitionHooks) {
  return defineCommand({
    name: UPDATE,
    input: UpdateEntityInput,
    execute({ id, ...next }, env): EntityRecord {
      const { record, changes } = updateIn(env, id, next, hooks);
      env.emit({
        type: EntityUpdated.type,
        campaignId: record.campaignId,
        payload: { entityId: id },
        changes,
      });
      return record;
    },
  });
}
