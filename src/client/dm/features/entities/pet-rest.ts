// DM REST for pets (FR-ENT-32, -33): `POST /api/pets` and the whole-replace `PUT` the Party
// Companions menu sends (rename, turn mode, owner, release: the loaded fields plus the change).
// The session module is imported lazily (it reads localStorage at load; keeps registries testable).
import type {
  CreatePetBody,
  EntityResponse,
  MonsterRecord,
  TurnMode,
  UpdateEntityBody,
} from "@shared/entities/schemas";
import { loadChunk } from "@ui/lib/lazy-chunk";

async function session() {
  // A stale chunk (BL-91): the caller's existing error + the stale notice.
  return loadChunk(() => import("../campaign-management/session"), { notice: true });
}

export interface PetChange {
  name?: string;
  turnMode?: TurnMode;
  /** null releases the pet (FR-ENT-33). */
  companionOf?: string | null;
}

/** FR-ENT-33: the whole replace of a loaded pet with `change` applied. */
export function petPutBody(pet: MonsterRecord, change: PetChange): UpdateEntityBody {
  const companionOf = change.companionOf === undefined ? pet.companionOf : change.companionOf;
  return {
    name: change.name ?? pet.name,
    portraitAssetId: pet.portraitAssetId,
    tokenShape: pet.tokenShape,
    statBlock: pet.statBlock as Record<string, unknown>,
    companionOf,
    // A release clears the mode with the owner (the server nulls it anyway).
    turnMode: companionOf === null ? null : (change.turnMode ?? pet.turnMode),
  };
}

export const petRest = {
  async create(body: CreatePetBody) {
    const { api, dmCall } = await session();
    return dmCall<EntityResponse>(api.api.pets.$post({ json: body }));
  },
  async update(pet: MonsterRecord, change: PetChange) {
    const { api, dmCall } = await session();
    return dmCall<EntityResponse>(
      api.api.entities[":id"].$put({ param: { id: pet.id }, json: petPutBody(pet, change) }),
    );
  },
};
