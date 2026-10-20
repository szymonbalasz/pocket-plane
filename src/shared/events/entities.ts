// Domain events of entities (ENT §9, protocol §16). All logged; none undoable.
import { z } from "zod";
import { defineEvent } from "./types";

/** `import.batch` via the entities store, one per created row; logged with campaignId null. */
export const EntityImported = defineEvent({
  type: "EntityImported",
  payload: z.object({ entityId: z.string(), source: z.string(), sourceKey: z.string() }).strict(),
  logged: true,
  undoable: false,
});

/** `entities.create` (incl. derive). */
export const EntityCreated = defineEvent({
  type: "EntityCreated",
  payload: z
    .object({
      entityId: z.string(),
      kind: z.enum(["character", "monster"]),
      derivedFromId: z.string().optional(),
      /** Sprint 6 (FR-ENT-32): a pet's owner PC. */
      companionOf: z.string().optional(),
    })
    .strict(),
  logged: true,
  undoable: false,
});

/** `entities.update`; changes also list every hook-changed instance row (FR-ENT-19). */
export const EntityUpdated = defineEvent({
  type: "EntityUpdated",
  payload: z.object({ entityId: z.string() }).strict(),
  logged: true,
  undoable: false,
});

/**
 * Re-import of a changed imported definition (compendium FR-CMP-08, OQ-FIX-18): one per updated
 * row, logged with campaignId null (the `imported-entity` upsert); hook-changed instances follow
 * in one more `ImportedEntityUpdated` per affected campaign, logged with that campaign.
 */
export const ImportedEntityUpdated = defineEvent({
  type: "ImportedEntityUpdated",
  payload: z.object({ entityId: z.string() }).strict(),
  logged: true,
  undoable: false,
});

/**
 * `pet.adjustHp` (sprint 6, FR-ENT-36): a pet's kept HP out of a fight; `entity` upsert (owner
 * full, other players the redacted row while present). Logged, not undoable.
 */
export const PetHpAdjusted = defineEvent({
  type: "PetHpAdjusted",
  payload: z.object({ petId: z.string(), before: z.int(), after: z.int() }).strict(),
  logged: true,
  undoable: false,
});
