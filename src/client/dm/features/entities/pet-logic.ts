// Make pet / New pet dialog rules (FR-ENT-32, ENT §7 S6): owner choices, the prefilled name (the
// server's FR-ENT-32 rule mirrored so the default is never taken), the inline name check
// (FR-ENT-08) and the `POST /api/pets` body. Pure; the dialog is `pet-dialog.tsx`.
import type { PlayerRecord } from "@shared/campaign-management/schemas";
import {
  CreatePetBody,
  EntityName,
  EntityRecord,
  entityNameKey,
  PETS_PER_PC_MAX,
  TURN_MODES,
  type TurnMode,
} from "@shared/entities/schemas";

/** FR-ENT-32: the dialog's turn mode labels, in RadioGroup order. */
export const TURN_MODE_LABEL: Record<TurnMode, string> = {
  "after-owner": "After the owner",
  "in-owner-turn": "In the owner's turn",
  own: "Own initiative",
};
export const PET_TURN_MODES: readonly TurnMode[] = TURN_MODES;

export const NAME_TAKEN = "Name taken";

export interface OwnerOption {
  /** The owner PC (a character with a player). */
  id: string;
  name: string;
  playerName: string;
  pets: number;
  /** FR-ENT-35: already at 3 pets. */
  full: boolean;
}

/** Campaign entities that parse (DM store rows: full records). */
export function parsedEntities(entities: readonly unknown[]): EntityRecord[] {
  const out: EntityRecord[] = [];
  for (const r of entities) {
    const p = EntityRecord.safeParse(r);
    if (p.success) out.push(p.data);
  }
  return out;
}

/** "Pet of" choices: every PC with a player, by name; pets counted per FR-ENT-35. */
export function ownerOptions(
  entities: readonly EntityRecord[],
  players: readonly PlayerRecord[],
): OwnerOption[] {
  const playerName = new Map(players.map((p) => [p.id, p.name]));
  const pets = new Map<string, number>();
  for (const e of entities) {
    if (e.kind === "monster" && e.companionOf !== null) {
      pets.set(e.companionOf, (pets.get(e.companionOf) ?? 0) + 1);
    }
  }
  return entities
    .flatMap((e) =>
      e.kind === "character" && playerName.has(e.ownerPlayerId)
        ? [
            {
              id: e.id,
              name: e.name,
              playerName: playerName.get(e.ownerPlayerId) ?? "",
              pets: pets.get(e.id) ?? 0,
              full: (pets.get(e.id) ?? 0) >= PETS_PER_PC_MAX,
            },
          ]
        : [],
    )
    .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}

/** FR-ENT-08 keys of the campaign's monster names (imported rows aren't in the campaign). */
export function monsterNameKeys(entities: readonly EntityRecord[]): Set<string> {
  return new Set(entities.filter((e) => e.kind === "monster").map((e) => entityNameKey(e.name)));
}

/**
 * FR-ENT-32's name rule, as the server applies it: the stem, else "‹stem› (‹PC›)", then " 2",
 * " 3"… The dialog prefills this, so the default is always free.
 */
export function suggestedPetName(stem: string, ownerName: string, taken: ReadonlySet<string>) {
  const free = (n: string) => !taken.has(entityNameKey(n));
  if (free(stem)) return stem;
  const base = `${stem} (${ownerName})`;
  if (free(base)) return base;
  for (let n = 2; ; n++) if (free(`${base} ${n}`)) return `${base} ${n}`;
}

/** Inline name error (FR-ENT-08 before sending), or null. */
export function petNameError(name: string, taken: ReadonlySet<string>): string | null {
  const parsed = EntityName.safeParse(name);
  if (!parsed.success) return parsed.error.issues[0]?.message ?? "Invalid name";
  return taken.has(entityNameKey(parsed.data)) ? NAME_TAKEN : null;
}

export interface PetDraft {
  baseId: string | null;
  ownerId: string | null;
  name: string;
  mode: TurnMode;
}

/** The `POST /api/pets` body, or null while the draft can't be sent. */
export function petBody(d: PetDraft, taken: ReadonlySet<string>): CreatePetBody | null {
  if (d.baseId === null || d.ownerId === null || petNameError(d.name, taken) !== null) return null;
  const body = CreatePetBody.safeParse({
    baseDefinitionId: d.baseId,
    companionOf: d.ownerId,
    name: d.name.trim(),
    turnMode: d.mode,
  });
  return body.success ? body.data : null;
}
