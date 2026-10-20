// Pets (sprint 6, #252, FR-ENT-31–37, ADR-0056): `entities.createPet` behind `POST /api/pets`
// (the server copies any monster, imported included), `petPresent` (FR-ENT-37: other players get
// a pet only while it is present) and the owner copies a character's owner change rewrites
// (FR-ENT-34). Presence and copies run inside the causing command's transaction and return the
// rows for its event; nothing here emits but the create.
import {
  CreatePetBody,
  ENTITY_TYPE,
  type EntityRecord,
  type EntityResponse,
  type MonsterStatBlock,
  withAttackIds,
} from "@shared/entities/schemas";
import { EntityCreated } from "@shared/events/entities";
import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import { defineCommand } from "../../commands/commands";
import { invalid } from "../../commands/errors";
import type { Tx } from "../../db/client";
import { combatant, entity, token } from "../../db/schema";
import type { RecordChange } from "../../events/types";
import {
  type DmCampaignEnv,
  dmActor,
  dmCampaign,
  dmOnly,
  errorResponse,
  jsonBody,
} from "../../http";
import type { Services } from "../../services";
import { combatantChange, toCombatantRecord } from "../combat-tracker/rows";
import { setTokenOwnerIn } from "../scenes-map/token-owner";
import {
  assertPetCaps,
  campaignOf,
  nameTaken,
  ownerCharacter,
  resolveDefinition,
} from "./commands";
import type { HookEnv } from "./definition-hooks";
import { getRow, toEntityRecord } from "./rows";

export const CREATE_PET = "entities.createPet";

type Read = Pick<Tx, "select">;

const record = (tx: Read, id: string): EntityRecord =>
  toEntityRecord(getRow(tx as Tx, id) as NonNullable<ReturnType<typeof getRow>>);

/**
 * FR-ENT-32: "Owlbear" taken → "Owlbear (Mira)", then "Owlbear (Mira) 2", " 3"… (FR-ENT-08 is
 * case-insensitive among the campaign's monsters).
 */
export function petName(tx: Read, cid: string, stem: string, ownerName: string): string {
  if (!nameTaken(tx, cid, "monster", stem)) return stem;
  const base = `${stem} (${ownerName})`;
  if (!nameTaken(tx, cid, "monster", base)) return base;
  for (let n = 2; ; n++) {
    const name = `${base} ${n}`;
    if (!nameTaken(tx, cid, "monster", name)) return name;
  }
}

/**
 * `entities.createPet` (FR-ENT-32): copies the base's stat block (attack rows get stable ids,
 * FR-CBT-117), portrait and `tokenShape`; `derivedFromId` = base; owner copies from the PC;
 * `hpCurrent = hpMax`; caps FR-ENT-35. One transaction; `EntityCreated` with `companionOf`.
 */
export const createPet = defineCommand({
  name: CREATE_PET,
  input: CreatePetBody,
  execute(input, env): EntityRecord {
    const { tx, ctx } = env;
    const cid = campaignOf(env.actor);
    const base = resolveDefinition(env, input.baseDefinitionId);
    if (base.kind !== "monster") {
      throw invalid("A pet is a creature, not a character", [
        { path: ["baseDefinitionId"], message: "Not a monster" },
      ]);
    }
    const owner = ownerCharacter(tx, cid, input.companionOf, "companionOf");
    assertPetCaps(tx, cid, owner);
    const statBlock = withAttackIds(base.statBlock as MonsterStatBlock, () => ctx.ids.next());
    const id = ctx.ids.next();
    const now = ctx.clock.iso();
    tx.insert(entity)
      .values({
        id,
        kind: "monster",
        campaignId: cid,
        name: petName(tx, cid, input.name ?? base.name, owner.name),
        portraitAssetId: base.portraitAssetId,
        tokenShape: base.tokenShape,
        statBlock,
        ownerPlayerId: owner.ownerPlayerId,
        hpCurrent: statBlock.hpMax,
        derivedFromId: base.id,
        companionOf: owner.id,
        turnMode: input.turnMode ?? "after-owner",
        petPresent: false,
        createdAt: now,
        updatedAt: now,
      })
      .run();
    const after = record(tx, id);
    env.emit({
      type: EntityCreated.type,
      campaignId: cid,
      payload: { entityId: id, kind: "monster", derivedFromId: base.id, companionOf: owner.id },
      changes: [{ type: ENTITY_TYPE, id, before: null, after }],
    });
    return after;
  },
});

/** `POST /api/pets` (FR-ENT-32; REST prep, ADR-0021 D): DM only → `201 {entity}`. */
export function petRoutes(s: Services) {
  return new Hono<DmCampaignEnv>().post(
    "/pets",
    dmOnly(s),
    dmCampaign(s),
    jsonBody(CreatePetBody),
    (c) => {
      try {
        const pet = s.commands.run(CREATE_PET, c.req.valid("json"), {
          actor: dmActor(c.get("campaignId")),
        }) as EntityRecord;
        return c.json({ entity: pet } satisfies EntityResponse, 201);
      } catch (err) {
        return errorResponse(c, err, s);
      }
    },
  );
}

// ---------- owner copies (FR-ENT-34) ----------

const tokensOf = (tx: Read, definitionId: string) =>
  tx.select({ id: token.id }).from(token).where(eq(token.definitionId, definitionId)).all();

/**
 * Definition-changed hook line (FR-ENT-34, review 3): a character's owner change rewrites
 * `ownerPlayerId` on its pets, their tokens, its active companion combatants and the tokens
 * bound to them; a pet's `companionOf` change or release rewrites its tokens' owner (FR-MAP-74,
 * FR-ENT-33). Every row is listed for `EntityUpdated.changes`.
 */
export function petOwnerCopiesHook(
  env: HookEnv,
  before: EntityRecord,
  after: EntityRecord,
): RecordChange[] {
  const { tx, ctx } = env;
  const out: RecordChange[] = [];
  if (after.kind === "monster") {
    if (before.kind !== "monster") return [];
    if (before.companionOf === after.companionOf && before.ownerPlayerId === after.ownerPlayerId) {
      return [];
    }
    for (const t of tokensOf(tx, after.id))
      out.push(...setTokenOwnerIn(env, t.id, after.ownerPlayerId));
    return out;
  }
  if (before.kind !== "character" || before.ownerPlayerId === after.ownerPlayerId) return [];
  const owner = after.ownerPlayerId;
  const pets = tx
    .select({ id: entity.id })
    .from(entity)
    .where(eq(entity.companionOf, after.id))
    .all();
  for (const p of pets) {
    const prev = record(tx, p.id);
    tx.update(entity)
      .set({ ownerPlayerId: owner, updatedAt: ctx.clock.iso() })
      .where(eq(entity.id, p.id))
      .run();
    out.push({ type: ENTITY_TYPE, id: p.id, before: prev, after: record(tx, p.id) });
    for (const t of tokensOf(tx, p.id)) out.push(...setTokenOwnerIn(env, t.id, owner));
  }
  const companions = tx
    .select()
    .from(combatant)
    .where(and(eq(combatant.ownerCharacterId, after.id), eq(combatant.active, true)))
    .all()
    .map(toCombatantRecord);
  for (const c of companions) {
    tx.update(combatant).set({ ownerPlayerId: owner }).where(eq(combatant.id, c.id)).run();
    const now = toCombatantRecord(
      tx
        .select()
        .from(combatant)
        .where(eq(combatant.id, c.id))
        .get() as typeof combatant.$inferSelect,
    );
    out.push(combatantChange(c, now));
    if (c.tokenId) out.push(...setTokenOwnerIn(env, c.tokenId, owner));
  }
  return out;
}
