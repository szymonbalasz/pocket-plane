// MOD's definition-changed hook line (FR-MOD-07, FR-ENT-19): keeps each character preset's
// `ownerPlayerId` copy equal to the character's owner, in the owner change's transaction. The
// changes are listed in the entity event, so the old owner gets deletes and the new one upserts.
import type { EntityRecord } from "@shared/entities/schemas";
import { eq } from "drizzle-orm";
import { effectPreset } from "../../db/schema";
import type { RecordChange } from "../../events/types";
import type { HookEnv } from "../entities/definition-hooks";
import { presetChange, presetsOfCharacter, readPreset } from "./rows";

export function presetOwnerHook(
  env: HookEnv,
  _before: EntityRecord,
  after: EntityRecord,
): RecordChange[] {
  if (after.kind !== "character") return [];
  const owner = after.ownerPlayerId;
  return presetsOfCharacter(env.tx, after.id)
    .filter((p) => p.ownerPlayerId !== owner)
    .map((p) => {
      env.tx
        .update(effectPreset)
        .set({ ownerPlayerId: owner, updatedAt: env.ctx.clock.iso() })
        .where(eq(effectPreset.id, p.id))
        .run();
      return presetChange(p, readPreset(env.tx, p.id));
    });
}
