// entities.create / entities.update (FR-ENT-04, 07–12, 17, 19) and resolveDefinition.
// DM authority; campaign = `actor.campaignId`, fixed at request authentication (CON-21).
import {
  CreateEntityBody,
  type DefinitionRecord,
  ENTITY_TYPE,
  type EntityKind,
  type EntityRecord,
  entityNameKey,
  kindRegistry,
  UpdateEntityBody,
} from "@shared/entities/schemas";
import { EntityCreated, EntityUpdated } from "@shared/events/entities";
import type { Issue } from "@shared/protocol/codes";
import { and, eq, isNull, or } from "drizzle-orm";
import { defineCommand, IdSchema } from "../../commands/commands";
import { conflict, forbidden, invalid, notFound, zodIssues } from "../../commands/errors";
import type { Tx } from "../../db/client";
import { entity, player } from "../../db/schema";
import type { Actor } from "../../events/types";
import { requireAsset } from "../assets-pipeline/commands";
import type { DefinitionHooks } from "./definition-hooks";
import { getRow, toDefinitionRecord, toEntityRecord } from "./rows";

export const CREATE = "entities.create";
export const UPDATE = "entities.update";

export const READ_ONLY_MESSAGE = "Imported definitions are read-only. Derive a custom one.";

type Env = { tx: Tx; actor: Actor };

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

/** `entities.create` incl. derive (FR-ENT-04, 08, 09, 10, 17). */
export const createEntity = defineCommand({
  name: CREATE,
  input: CreateEntityBody,
  execute(input, env): EntityRecord {
    const { tx, ctx, emit } = env;
    const cid = campaignOf(env.actor);
    assertNameFree(tx, cid, input.kind, input.name);
    const portraitAssetId = portrait(env, input.portraitAssetId);
    let derivedFromId: string | null = null;
    let ownerPlayerId: string | null = null;
    let hpCurrent: number | null = null;
    if (input.kind === "monster") {
      if (input.derivedFromId !== undefined) {
        const base = resolveDefinition(env, input.derivedFromId);
        if (base.kind !== "monster") throw notFound("Definition not found");
        derivedFromId = base.id;
      }
    } else {
      assertOwner(tx, cid, input.ownerPlayerId);
      ownerPlayerId = input.ownerPlayerId;
      hpCurrent = input.statBlock.hpMax;
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
        statBlock: input.statBlock,
        ownerPlayerId,
        hpCurrent,
        derivedFromId,
        createdAt: now,
        updatedAt: now,
      })
      .run();
    const after = toEntityRecord(getRow(tx, id) as NonNullable<ReturnType<typeof getRow>>);
    emit({
      type: EntityCreated.type,
      campaignId: cid,
      payload: {
        entityId: id,
        kind: input.kind,
        ...(derivedFromId ? { derivedFromId } : {}),
      },
      changes: [{ type: ENTITY_TYPE, id, before: null, after }],
    });
    return after;
  },
});

export const UpdateEntityInput = UpdateEntityBody.extend({ id: IdSchema });

/** `entities.update`: whole replace (FR-ENT-07, 11, 17, 19). */
export function updateEntityCommand(hooks: DefinitionHooks) {
  return defineCommand({
    name: UPDATE,
    input: UpdateEntityInput,
    execute(input, env): EntityRecord {
      const { tx, ctx, actor, emit } = env;
      const row = getRow(tx, input.id);
      // FR-ENT-07: imported → forbidden, no change, event or log entry.
      if (row && row.campaignId === null) throw forbidden(READ_ONLY_MESSAGE);
      const cid = campaignOf(actor);
      if (!row || row.campaignId !== cid) throw notFound("Definition not found");
      const before = toEntityRecord(row);

      const parsed = kindRegistry[before.kind].statBlock.safeParse(input.statBlock);
      if (!parsed.success) {
        const issues: Issue[] = zodIssues(parsed.error).map((i) => ({
          path: ["statBlock", ...i.path],
          message: i.message,
        }));
        throw invalid("Invalid stat block", issues);
      }
      const statBlock = parsed.data;
      let ownerPlayerId: string | null = null;
      let hpCurrent: number | null = null;
      if (before.kind === "monster") {
        if (input.ownerPlayerId !== undefined) {
          throw invalid("Monsters have no owner", [
            { path: ["ownerPlayerId"], message: "Not allowed for monsters" },
          ]);
        }
      } else {
        if (input.ownerPlayerId === undefined) {
          throw invalid("Characters need an owner", [
            { path: ["ownerPlayerId"], message: "Required" },
          ]);
        }
        assertOwner(tx, cid, input.ownerPlayerId);
        ownerPlayerId = input.ownerPlayerId;
        // FR-ENT-11: clamp to the new hpMax in the same transaction.
        hpCurrent = Math.min(before.hpCurrent, statBlock.hpMax);
      }
      assertNameFree(tx, cid, before.kind, input.name, before.id);
      const portraitAssetId = portrait(env, input.portraitAssetId);

      tx.update(entity)
        .set({
          name: input.name,
          portraitAssetId,
          statBlock,
          ownerPlayerId,
          hpCurrent,
          updatedAt: ctx.clock.iso(),
        })
        .where(eq(entity.id, before.id))
        .run();
      const after = toEntityRecord(getRow(tx, before.id) as NonNullable<ReturnType<typeof getRow>>);
      // FR-ENT-19: instance refreshes inside this transaction; a throw rolls everything back.
      const hookChanges = hooks.run({ tx, ctx, actor }, before, after);
      emit({
        type: EntityUpdated.type,
        campaignId: cid,
        payload: { entityId: before.id },
        changes: [{ type: ENTITY_TYPE, id: before.id, before, after }, ...hookChanges],
      });
      return after;
    },
  });
}
