// Shared lookups / guards for combat intents: the started encounter, its combatants, what a
// player may see (FR-CBT-27) and own (FR-CBT-11, FR-CBT-16).
import { resolveSheetAttack, type SheetAttack } from "@shared/character-sheet/logic";
import { withCardIds } from "@shared/combat-tracker/companion";
import type { CombatantRecord, EncounterRecord } from "@shared/combat-tracker/schemas";
import { effectiveStats, type StatBlock } from "@shared/entities/schemas";
import { eq } from "drizzle-orm";
import type { CommandEnv } from "../../commands/commands";
import { conflict, forbidden, notFound } from "../../commands/errors";
import { entity } from "../../db/schema";
import { sheetAttack } from "../character-sheet/attack";
import { combatantVisibility } from "./records";
import { campaignOf, getCombatant, readEncounter, startedEncounter } from "./rows";

export function requireStarted(env: Pick<CommandEnv, "tx" | "actor">): EncounterRecord {
  const enc = startedEncounter(env.tx, campaignOf(env.actor));
  if (!enc) throw conflict("No encounter is running");
  return enc;
}

/**
 * An active combatant of the started encounter, or `not_found`. For a player, also visible
 * (else `not_found`, #130); `own` → a PC owned by them or (sprint 6, FR-CBT-114) a companion with
 * `ownerPlayerId` = them (else `forbidden`).
 */
export function activeCombatant(
  env: Pick<CommandEnv, "tx" | "actor">,
  id: string,
  opts: { own?: boolean; allowRemoved?: boolean } = {},
): { c: CombatantRecord; enc: EncounterRecord } {
  const cid = campaignOf(env.actor);
  const c = getCombatant(env.tx, cid, id);
  const enc = readEncounter(env.tx, c.encounterId);
  if (enc.status !== "started" || !c.active) throw notFound("Combatant not found");
  if (env.actor.role === "player") {
    if (combatantVisibility(c) === "hidden") throw notFound("Combatant not found");
    const mine =
      c.kind === "pc"
        ? ownerOf(env, c.entityId) === env.actor.playerId
        : c.ownerPlayerId !== null && c.ownerPlayerId === env.actor.playerId;
    if (opts.own && !mine) throw forbidden("Not your character");
  }
  if (c.removed && !opts.allowRemoved) throw notFound("Combatant not found");
  return { c, enc };
}

function ownerOf(env: Pick<CommandEnv, "tx">, entityId: string): string | null {
  return (
    env.tx.select({ owner: entity.ownerPlayerId }).from(entity).where(eq(entity.id, entityId)).get()
      ?.owner ?? null
  );
}

/**
 * The combatant's effective stat block (ADR-0009, FR-ENT-13). Sprint 6 (FR-CBT-117): a
 * companion's id-less attack rows carry its card's stable ids.
 */
export function statsOf(env: Pick<CommandEnv, "tx">, c: CombatantRecord): StatBlock {
  const row = env.tx
    .select({ statBlock: entity.statBlock })
    .from(entity)
    .where(eq(entity.id, c.entityId))
    .get();
  if (!row) throw new Error(`Combatant ${c.id}: entity ${c.entityId} missing`);
  return withCardIds(effectiveStats({ statBlock: row.statBlock as StatBlock }), c.card);
}

export const ATTACK_NOT_FOUND = "Attack not found";

/**
 * FR-CBT-114 (review 13): a player attacking as a companion rolls a **card** row: `attackId` must
 * be one of the card's row ids (absent = the first), a spell → `not_found`. The DM may name any
 * stat-block row (or none = the first). Others unchanged.
 */
export function attackRefFor(
  env: Pick<CommandEnv, "actor">,
  c: CombatantRecord,
  ref: { attackId?: string; spellId?: string },
): { attackId?: string; spellId?: string } {
  if (env.actor.role !== "player" || c.kind === "pc" || c.ownerPlayerId === null) return ref;
  const rows = c.card?.attacks ?? [];
  if (ref.spellId !== undefined) throw notFound(ATTACK_NOT_FOUND);
  const attackId = ref.attackId ?? rows[0]?.id;
  if (attackId === undefined || !rows.some((r) => r.id === attackId)) {
    throw notFound(ATTACK_NOT_FOUND);
  }
  return { attackId };
}

/**
 * `characters.sheetAttack` for a combatant: a companion resolves on its stat block with the
 * card's ids (FR-CBT-117), so an imported definition's id-less row is rolled by its card id.
 */
export function combatantAttack(
  env: Pick<CommandEnv, "tx">,
  c: CombatantRecord,
  ref: { attackId?: string; spellId?: string },
): SheetAttack {
  if (c.card === null) return sheetAttack(env, c.entityId, ref);
  const res = resolveSheetAttack(statsOf(env, c), null, ref);
  if (!res.ok) throw res.code === "not_found" ? notFound(res.message) : conflict(res.message);
  return res.attack;
}
