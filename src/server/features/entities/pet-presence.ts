// Pet presence (sprint 6, FR-ENT-37, ADR-0056): `petPresent` = the pet has an active companion
// combatant the DM didn't hide (BL-114) or an unhidden token on the active scene; other players receive a pet only while it
// is true. Re-derived in the transaction of every command that changes either (combat join / End,
// token writes through the scene visibility hook, scene switches through the scene hook); the
// rows join the causing event. Kept free of command imports: the scenes-map registries load it.
import { ENTITY_TYPE, type EntityRecord } from "@shared/entities/schemas";
import { TOKEN_TYPE, type TokenRecord } from "@shared/scenes-map/schemas";
import { and, eq, inArray, isNotNull, ne } from "drizzle-orm";
import type { CommandEnv } from "../../commands/commands";
import type { Tx } from "../../db/client";
import { combatant, entity, scene, token } from "../../db/schema";
import type { RecordChange } from "../../events/types";
import type { SceneHook } from "../scenes-map/scene-hooks";
import type { SceneVisibilityHook } from "../scenes-map/visibility-hooks";
import { getRow, toEntityRecord } from "./rows";

type Env = Pick<CommandEnv, "tx" | "ctx" | "actor">;
type Read = Pick<Tx, "select">;

const record = (tx: Read, id: string): EntityRecord =>
  toEntityRecord(getRow(tx as Tx, id) as NonNullable<ReturnType<typeof getRow>>);

/**
 * FR-ENT-37: rewrites `petPresent` of the campaign's pets (all, or `petIds`): an active
 * companion combatant the DM didn't hide (BL-114), or an unhidden token on the active scene (`excludeSceneId`: a scene being
 * deleted counts as gone). Returns the `entity` changes (other players: upsert or delete).
 */
export function syncPetPresence(
  env: Env,
  campaignId: string,
  opts: { petIds?: readonly string[]; excludeSceneId?: string } = {},
): RecordChange[] {
  const { tx, ctx } = env;
  if (opts.petIds && opts.petIds.length === 0) return [];
  const pets = tx
    .select({ id: entity.id, petPresent: entity.petPresent })
    .from(entity)
    .where(
      and(
        eq(entity.campaignId, campaignId),
        isNotNull(entity.companionOf),
        ...(opts.petIds ? [inArray(entity.id, [...opts.petIds])] : []),
      ),
    )
    .all();
  if (pets.length === 0) return [];
  const ids = pets.map((p) => p.id);
  // BL-114 (#343): a combatant the DM hid doesn't make its pet present. A bound one is hidden by
  // its token's flag, read here: this runs in the token write's visibility hooks, before the
  // token-changed hooks copy it to the combatant (fog never counts, as for `shown`); a token-less
  // one by its own flag (Add hidden).
  const fighting = new Set(
    tx
      .select({ id: combatant.entityId, hidden: combatant.hidden, tokenHidden: token.hidden })
      .from(combatant)
      .leftJoin(token, eq(token.id, combatant.tokenId))
      .where(and(inArray(combatant.entityId, ids), eq(combatant.active, true)))
      .all()
      .filter((r) => !(r.tokenHidden ?? r.hidden))
      .map((r) => r.id),
  );
  const active = tx
    .select({ id: scene.id })
    .from(scene)
    .where(
      and(
        eq(scene.campaignId, campaignId),
        eq(scene.active, true),
        ...(opts.excludeSceneId ? [ne(scene.id, opts.excludeSceneId)] : []),
      ),
    )
    .get();
  const shown = new Set(
    active
      ? tx
          .select({ id: token.definitionId })
          .from(token)
          .where(
            and(
              eq(token.sceneId, active.id),
              eq(token.hidden, false),
              inArray(token.definitionId, ids),
            ),
          )
          .all()
          .map((r) => r.id)
      : [],
  );
  const out: RecordChange[] = [];
  for (const p of pets) {
    const present = fighting.has(p.id) || shown.has(p.id);
    if (present === p.petPresent) continue;
    const before = record(tx, p.id);
    tx.update(entity)
      .set({ petPresent: present, updatedAt: ctx.clock.iso() })
      .where(eq(entity.id, p.id))
      .run();
    out.push({ type: ENTITY_TYPE, id: p.id, before, after: record(tx, p.id) });
  }
  return out;
}

/** The pet a token is of, or null (one indexed read). */
function petOfToken(tx: Read, t: TokenRecord): string | null {
  const row = tx
    .select({ id: entity.id, companionOf: entity.companionOf })
    .from(entity)
    .where(eq(entity.id, t.definitionId))
    .get();
  return row?.companionOf ? row.id : null;
}

/**
 * Scene visibility hook line (FR-ENT-37): every token write (place, duplicate, hide / reveal,
 * delete, …) of a pet's token re-derives that pet's presence; the rows join the write's event.
 */
export const petPresenceVisibilityHook: SceneVisibilityHook = {
  name: "entities.pet-presence",
  rederive(env, change) {
    if (change.type !== TOKEN_TYPE) return [];
    const t = (change.after ?? change.before) as TokenRecord | null;
    if (!t) return [];
    const pet = petOfToken(env.tx, t);
    return pet ? syncPetPresence(env, t.campaignId, { petIds: [pet] }) : [];
  },
};

/**
 * Scene lifecycle hook line (FR-ENT-37): a scene switch, the active scene's delete, or the scene
 * going off for an overview (FR-OVW-44).
 */
export const petPresenceSceneHook: SceneHook = {
  name: "entities.pet-presence",
  activated: (env, s) => syncPetPresence(env, s.campaignId),
  deleting: (env, s) =>
    s.active ? syncPetPresence(env, s.campaignId, { excludeSceneId: s.id }) : [],
  deactivated: (env, s) => syncPetPresence(env, s.campaignId),
};
