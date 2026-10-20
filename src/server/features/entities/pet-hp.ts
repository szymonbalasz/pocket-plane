// `pet.adjustHp` (sprint 6, FR-ENT-36): a pet's kept HP outside a fight. WS intent for the DM and
// the pet's owner; one transaction; `PetHpAdjusted` with the `entity` upsert (owner full, other
// players the redacted row with its band while present, FR-ENT-37). Logged, not undoable.
import { clampHp } from "@shared/character-sheet/logic";
import {
  PET_ADJUST_HP,
  PET_HP_IN_FIGHT,
  PetAdjustHpIntent,
  type PetAdjustHpResult,
} from "@shared/entities/pet-hp";
import { ENTITY_TYPE, isPet } from "@shared/entities/schemas";
import { PetHpAdjusted } from "@shared/events/entities";
import { and, eq } from "drizzle-orm";
import { defineCommand } from "../../commands/commands";
import { conflict, forbidden, notFound } from "../../commands/errors";
import { combatant, entity } from "../../db/schema";
import { campaignOf } from "./commands";
import { getRow, toEntityRecord } from "./rows";

export const petAdjustHp = defineCommand({
  name: PET_ADJUST_HP,
  input: PetAdjustHpIntent,
  roles: ["dm", "player"],
  execute({ petId, delta }, env): PetAdjustHpResult {
    const { tx, actor } = env;
    const cid = campaignOf(actor);
    const row = getRow(tx, petId);
    const before = row && row.campaignId === cid ? toEntityRecord(row) : null;
    if (before?.kind !== "monster" || !isPet(before)) throw notFound("Pet not found");
    if (actor.role === "player" && before.ownerPlayerId !== actor.playerId) {
      throw forbidden("Not your pet");
    }
    // FR-ENT-36: in a fight its HP lives on the combatant (FR-CBT-113).
    const fighting = tx
      .select({ id: combatant.id })
      .from(combatant)
      .where(and(eq(combatant.entityId, petId), eq(combatant.active, true)))
      .get();
    if (fighting) throw conflict(PET_HP_IN_FIGHT);
    const hpMax = before.statBlock.hpMax;
    const hpBefore = before.hpCurrent ?? hpMax;
    const hpAfter = clampHp(hpBefore, delta, hpMax);
    // Unchanged after the clamp → ack, no event.
    if (hpAfter === hpBefore) return { before: hpBefore, after: hpAfter };
    tx.update(entity)
      .set({ hpCurrent: hpAfter, updatedAt: env.ctx.clock.iso() })
      .where(eq(entity.id, petId))
      .run();
    const after = toEntityRecord(getRow(tx, petId) as NonNullable<ReturnType<typeof getRow>>);
    env.emit({
      type: PetHpAdjusted.type,
      campaignId: cid,
      payload: { petId, before: hpBefore, after: hpAfter },
      changes: [{ type: ENTITY_TYPE, id: petId, before, after }],
    });
    return { before: hpBefore, after: hpAfter };
  },
});
