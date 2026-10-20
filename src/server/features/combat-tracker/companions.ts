// Companions (sprint 6, #252, FR-CBT-105–113, -116, -117): `cbt.setCompanion` (make an active
// monster combatant a companion, change its owner or mode, release it, turn it hostile), the
// owner lookup every companion command shares, and the End write-back (pets' HP back to their
// entity, summons' tokens deleted). Not undoable (set it back).
import { companionText, LOG_KIND_COMPANION } from "@shared/combat-tracker/companion-kind";
import {
  CBT_INTENTS,
  COMPANIONS_PER_OWNER_MAX,
  type CombatantRecord,
  type EncounterRecord,
  SetCompanionInput,
} from "@shared/combat-tracker/schemas";
import { companionCard, type StatBlock, type TurnMode } from "@shared/entities/schemas";
import { CompanionChanged } from "@shared/events/combat-tracker";
import { and, eq } from "drizzle-orm";
import { type CommandEnv, defineCommand } from "../../commands/commands";
import { conflict, invalid, notFound } from "../../commands/errors";
import type { Tx } from "../../db/client";
import { combatant, entity } from "../../db/schema";
import type { RecordChange } from "../../events/types";
import { gameLog } from "../dice-roll-log";
import { syncPetPresence } from "../entities/pet-presence";
import { getRow } from "../entities/rows";
import { setTokenOwnerIn } from "../scenes-map/token-owner";
import { resolveSummonCards } from "./concentration-card";
import { companionLeaves, petWriteBack } from "./dismiss";
import { statsOf } from "./guards";
import { combatantDiff, encounterDiff, rerank, syncPlayerTurn } from "./ranks";
import { combatantVisibility } from "./records";
import { campaignOf, combatantsOf, getCombatant, readCombatant, readEncounter } from "./rows";

type Read = Pick<Tx, "select">;

/** FR-CBT-111 / FR-PARTY-43: a pet's owner lives on the pet. */
export const PET_OWNER_HERE = "Change a pet's owner in the Party window";
/** FR-CBT-111: a mode change that would take the turn combatant's row away. */
export const AFTER_ITS_TURN = "Change it after its turn";

/**
 * FR-CBT-105: the owner PC of a companion command: a PC combatant of the encounter (active, not
 * removed: else `conflict` "Mira isn't in this fight") whose character has a player (else
 * `invalid` "Mira has no player").
 */
export function ownerOfCompanion(
  tx: Read,
  enc: EncounterRecord,
  characterId: string,
): { row: CombatantRecord; name: string; playerId: string } {
  const pc = tx
    .select()
    .from(combatant)
    .where(
      and(
        eq(combatant.encounterId, enc.id),
        eq(combatant.entityId, characterId),
        eq(combatant.kind, "pc"),
      ),
    )
    .all()
    .map((r) => readCombatant(tx, r.id))
    .find((r) => r.active && !r.removed);
  const ch = tx
    .select({ name: entity.name, kind: entity.kind, owner: entity.ownerPlayerId })
    .from(entity)
    .where(and(eq(entity.id, characterId), eq(entity.campaignId, enc.campaignId)))
    .get();
  if (ch?.kind !== "character") throw notFound("Character not found");
  if (!pc) throw conflict(`${ch.name} isn't in this fight`);
  if (ch.owner === null) throw invalid(`${ch.name} has no player`);
  return { row: pc, name: ch.name, playerId: ch.owner };
}

/** FR-CBT-121: ≤ 8 active companions per owner PC per encounter (pets included). */
export function assertCompanionCap(
  rows: readonly CombatantRecord[],
  owner: { name: string; characterId: string },
  adding: number,
  exceptId?: string,
): void {
  const have = rows.filter(
    (r) => r.active && r.ownerCharacterId === owner.characterId && r.id !== exceptId,
  ).length;
  if (have + adding > COMPANIONS_PER_OWNER_MAX) {
    throw conflict(`${owner.name} already has ${COMPANIONS_PER_OWNER_MAX} companions`);
  }
}

/** The display name of a combatant's owner PC (its combatant's, else the character's). */
function ownerName(tx: Read, rows: readonly CombatantRecord[], c: CombatantRecord): string {
  const pc = rows.find((r) => r.kind === "pc" && r.entityId === c.ownerCharacterId);
  if (pc) return pc.name;
  const row = c.ownerCharacterId ? getRow(tx as Tx, c.ownerCharacterId) : undefined;
  return row?.name ?? "";
}

/**
 * `cbt.setCompanion` (FR-CBT-111; §9 table for the errors). One transaction: the combatant (owner
 * copies, mode, `card`, side), the reranked rows, the bound token's owner (FR-MAP-74), one
 * `cbt.companion` line; `CompanionChanged`. Same values → ack, no event.
 */
export const setCompanionCommand = defineCommand({
  name: CBT_INTENTS.setCompanion,
  input: SetCompanionInput,
  roles: ["dm"],
  execute({ combatantId, owner, side }, env): void {
    const { tx } = env;
    const cid = campaignOf(env.actor);
    const before = getCombatant(tx, cid, combatantId);
    const enc = readEncounter(tx, before.encounterId);
    if (enc.status !== "started" || !before.active) throw notFound("Combatant not found");
    if (before.kind === "pc") throw invalid("A character can't be a companion");
    const rows = combatantsOf(tx, enc.id);
    const encBefore = enc;
    const set: Partial<typeof combatant.$inferInsert> = {};
    let action: "follows" | "release" | "hostile";
    let lineOwner: string;
    let mode: TurnMode | null = null;
    if (owner === null) {
      if (before.pet) throw conflict(PET_OWNER_HERE);
      // Not a companion: nothing to release (a side alone is `cbt.setSide`'s).
      if (before.ownerCharacterId === null) {
        if (side === undefined) return;
        throw invalid("Not a companion: set its side instead");
      }
      lineOwner = ownerName(tx, rows, before);
      // Release: mode `own`, keeping the owner's current number as its own (FR-CBT-111).
      const ownerRow = rows.find((r) => r.kind === "pc" && r.entityId === before.ownerCharacterId);
      Object.assign(set, {
        ownerCharacterId: null,
        ownerPlayerId: null,
        turnMode: null,
        card: null,
        ownerHidden: false,
        concentrationEffectId: null,
        ...(before.turnMode !== "own" && ownerRow ? { initiative: ownerRow.initiative } : {}),
      });
      action = side === "enemy" ? "hostile" : "release";
    } else {
      const o = ownerOfCompanion(tx, enc, owner.characterId);
      if (before.pet && o.row.entityId !== before.ownerCharacterId) {
        throw conflict(PET_OWNER_HERE);
      }
      mode = owner.turnMode ?? before.turnMode ?? "after-owner";
      const same =
        before.ownerCharacterId === o.row.entityId &&
        before.ownerPlayerId === o.playerId &&
        before.turnMode === mode &&
        (side === undefined || side === before.side);
      if (same) return;
      if (
        mode === "in-owner-turn" &&
        before.turnMode !== mode &&
        enc.turnCombatantId === before.id
      ) {
        throw conflict(AFTER_ITS_TURN);
      }
      if (before.ownerCharacterId !== o.row.entityId) {
        assertCompanionCap(rows, { name: o.name, characterId: o.row.entityId }, 1, before.id);
      }
      Object.assign(set, {
        ownerCharacterId: o.row.entityId,
        ownerPlayerId: o.playerId,
        turnMode: mode,
        card:
          before.card ?? companionCard(statsOf(env, before) as StatBlock, () => env.ctx.ids.next()),
      });
      // FR-CBT-106 / -108: a companion acting with its owner that switches to `own` keeps its
      // current effective number (its owner's), so it ranks there instead of dropping to the
      // end without one; switching back ranks it by the owner again.
      const boundBefore = before.turnMode === "after-owner" || before.turnMode === "in-owner-turn";
      if (mode === "own" && boundBefore) {
        const ownerRow = rows.find(
          (r) => r.kind === "pc" && r.entityId === before.ownerCharacterId,
        );
        if (ownerRow?.initiative != null) Object.assign(set, { initiative: ownerRow.initiative });
      }
      // FR-CBT-105: companions are on the party's side, shown openly.
      if (before.ownerCharacterId === null)
        Object.assign(set, { side: "ally", publicSide: "ally" });
      action = "follows";
      lineOwner = o.name;
    }
    // FR-CBT-99 / -111: an explicit side is an open change (turn hostile: `enemy`).
    if (side !== undefined) Object.assign(set, { side, publicSide: side });
    tx.update(combatant).set(set).where(eq(combatant.id, before.id)).run();
    rerank(tx, enc.id);
    const encAfter = syncPlayerTurn(env, enc.id);
    const after = readCombatant(tx, before.id);
    const tokenChanges = after.tokenId
      ? setTokenOwnerIn(env, after.tokenId, after.ownerPlayerId)
      : [];
    const entry = gameLog.append(env, {
      kind: LOG_KIND_COMPANION,
      category: "other",
      actorName: "DM",
      payload: { action, name: after.name, ...(lineOwner ? { ownerName: lineOwner } : {}) },
      dmPayload: mode ? { turnMode: mode } : {},
      rollIds: [],
      encounterId: enc.id,
      // FR-CBT-122: public iff players see the combatant.
      public: combatantVisibility(after) !== "hidden",
    });
    env.emit({
      type: CompanionChanged.type,
      campaignId: cid,
      payload: {
        encounterId: enc.id,
        combatantId: before.id,
        ownerCharacterId: after.ownerCharacterId,
        turnMode: after.turnMode,
        ...(side !== undefined ? { side } : {}),
      },
      changes: [
        ...combatantDiff(tx, rows),
        ...encounterDiff(encBefore, encAfter),
        ...tokenChanges,
        entry,
      ],
    });
    // FR-CBT-120: a release or turn hostile may leave a concentration card without summons.
    if (owner === null) resolveSummonCards(env, enc.id, action === "hostile" ? "hostile" : "gone");
  },
});

/** The `cbt.companion` text (fixtures, tests): what players read. */
export { companionText };

/**
 * FR-CBT-113 (End, inside `EncounterEnded`'s transaction, after its rows): each active pet
 * combatant's `hpCurrent` goes back to its pet (temp HP dropped); each summon's bound token is
 * deleted (FR-MAP-79, OQ-CBT-83b; only tokens `cbt.summon` made, #295); any other companion's
 * token loses its owner (`companionLeaves`); the pets' presence follows. Call with the rows
 * **before** End set them inactive; the combatants must already be inactive (the token hook then
 * allows the delete). Returns the rows for `EncounterEnded`'s changes.
 */
export function companionsAtEnd(env: CommandEnv, rows: readonly CombatantRecord[]): RecordChange[] {
  const out: RecordChange[] = [];
  const pets: string[] = [];
  for (const c of rows) {
    if (!c.active || c.ownerCharacterId === null) continue;
    if (c.pet) {
      pets.push(c.entityId);
      out.push(...petWriteBack(env, c));
    } else {
      out.push(...companionLeaves(env, c));
    }
  }
  out.push(...syncPetPresence(env, campaignOf(env.actor), { petIds: pets }));
  return out;
}
