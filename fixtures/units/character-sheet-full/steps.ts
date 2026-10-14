// Typed setup steps for the CHARX intents. `char.edit` and the row intents are built per server
// (they take its definition-changed hooks), so steps name them; inputs are still type-checked.
import type { Refs, SetupStep } from "@server/features/fixtures-adapters/fixture-types";
import {
  CHARX_INTENTS,
  type CharEditIntent,
  type CharPutRowIntent,
} from "@shared/character-sheet/sheet";
import { ENTITY_TYPE } from "@shared/entities/schemas";

export const editStep = (input: (r: Refs) => CharEditIntent): SetupStep => ({
  command: CHARX_INTENTS.edit,
  input,
});

export const putRowStep = (input: (r: Refs) => CharPutRowIntent): SetupStep => ({
  command: CHARX_INTENTS.putRow,
  input,
});

/** The entity a fixture created (or the first of them). */
export const entityOf = (r: Refs, key: string) => r.id(key, ENTITY_TYPE);
