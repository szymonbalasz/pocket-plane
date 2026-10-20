// Start / End (FR-CBT-07, FR-CBT-08, FR-CBT-10; End dismisses pending cards, FR-CBT-59/61;
// sprint 2: Start options, created tokens, HP modes, monster initiative, FR-CBT-64–66).
// `started` / `ended` rule hooks run after the event (FR-CBTX-01, ADR-0035).
import { type BindSlot, planBindings } from "@shared/combat-tracker/rules";
import {
  CBT_INTENTS,
  EndInput,
  type HpMode,
  type Side,
  StartInput,
} from "@shared/combat-tracker/schemas";
import {
  companionCard,
  type DefinitionRecord,
  entityNameKey,
  type MonsterRecord,
} from "@shared/entities/schemas";
import { EncounterEnded, EncounterStarted } from "@shared/events/combat-tracker";
import { and, eq } from "drizzle-orm";
import { type CommandEnv, defineCommand } from "../../commands/commands";
import { conflict, invalid } from "../../commands/errors";
import { combatant, combatantSeqNext, creatureSheet, encounter, entity } from "../../db/schema";
import type { RecordChange } from "../../events/types";
import { resolveDefinition } from "../entities/commands";
import { syncPetPresence } from "../entities/pet-presence";
import { getRow, toEntityRecord } from "../entities/rows";
import { dismissForEncounter } from "../notifications";
import { getScene, sceneTokens } from "../scenes-map/rows";
import { clearTrails } from "../scenes-map/trail";
import { tokenHiddenForPlayers } from "../scenes-map/visibility-hooks";
import { companionsAtEnd } from "./companions";
import { rollInitiativeFor } from "./initiative";
import { monsterHp, TokenPlacer } from "./join";
import { rerank } from "./ranks";
import {
  campaignOf,
  combatantChange,
  combatantsOf,
  encounterChange,
  entriesOf,
  getEncounter,
  readEncounter,
  startedEncounter,
} from "./rows";
import { CombatRuleHooks } from "./rule-hooks";

/**
 * FR-CBT-02: `null` = every character of the campaign now, drafts left out (FR-CHARX-11,
 * OQ-CBT-46); an explicit list may hold drafts. By name (case-insensitive), id.
 */
export function partyOf(env: Pick<CommandEnv, "tx">, cid: string, ids: string[] | null) {
  const all = env.tx
    .select({
      id: entity.id,
      name: entity.name,
      portraitAssetId: entity.portraitAssetId,
      statBlock: entity.statBlock,
      status: creatureSheet.status,
    })
    .from(entity)
    .leftJoin(creatureSheet, eq(creatureSheet.entityId, entity.id))
    .where(and(eq(entity.campaignId, cid), eq(entity.kind, "character")))
    .all();
  const wanted = ids === null ? null : new Set(ids);
  return all
    .filter((c) => (wanted === null ? c.status !== "draft" : wanted.has(c.id)))
    .sort((a, b) => {
      const ka = entityNameKey(a.name);
      const kb = entityNameKey(b.name);
      if (ka !== kb) return ka < kb ? -1 : 1;
      return a.id < b.id ? -1 : 1;
    });
}

/**
 * `side`: the entry's (FR-CBT-98); null = the kind's default (PCs). `pet` (sprint 6, FR-CBT-109):
 * the pet joining with its owner (kept HP, owner copies, mode, card).
 */
type StartSlot = BindSlot & {
  def: DefinitionRecord | null;
  hpMode: HpMode;
  side: Side | null;
  pet?: MonsterRecord;
};

/**
 * FR-CBT-109: `petIds` must be pets (campaign monsters with `companionOf`) of joining PCs, else
 * `invalid`; returned in the given order.
 */
function startPets(
  env: Pick<CommandEnv, "tx">,
  cid: string,
  petIds: readonly string[],
  joining: ReadonlySet<string>,
): MonsterRecord[] {
  return petIds.map((id, i) => {
    const row = getRow(env.tx, id);
    const pet = row && row.campaignId === cid ? toEntityRecord(row) : null;
    if (
      pet?.kind !== "monster" ||
      pet.companionOf === null ||
      !joining.has(pet.companionOf) ||
      petIds.indexOf(id) !== i
    ) {
      throw invalid("Only pets of joining characters can join", [
        { path: ["petIds", i], message: "Not a pet of a joining character" },
      ]);
    }
    return pet;
  });
}

/**
 * FR-CBT-07 / -08, sprint 2 FR-CBT-64–66: party PCs (minus `excludeCharacterIds`) by name, then
 * entries in order × quantity. Per instance: the next unbound placed token → bound; else (monsters,
 * `createTokens`) a created token (`hidden` = `addHidden`) around `at`, bound; else token-less.
 * HP per entry `hpMode`; every monster rolls initiative before the event (DM-only, FR-CBT-69).
 */
export const startCommandWith = (hooks: CombatRuleHooks) =>
  defineCommand({
    name: CBT_INTENTS.start,
    input: StartInput,
    execute({ encounterId, sceneId, at, excludeCharacterIds, petIds }, env): void {
      const { tx, ctx } = env;
      const cid = campaignOf(env.actor);
      const before = getEncounter(tx, cid, encounterId);
      if (before.status !== "planned") throw conflict("Only a planned encounter can start");
      if (startedEncounter(tx, cid)) throw conflict("Another encounter is running");
      const scene = getScene(tx, cid, sceneId);

      const party = partyOf(env, cid, before.partyCharacterIds);
      const excluded = new Set(excludeCharacterIds ?? []);
      const members = new Set(party.map((c) => c.id));
      [...excluded].forEach((id, i) => {
        if (!members.has(id)) {
          throw invalid("Only party members can be left out", [
            { path: ["excludeCharacterIds", i], message: "Not a party member" },
          ]);
        }
      });
      const slots: StartSlot[] = [];
      for (const c of party) {
        if (excluded.has(c.id)) continue;
        slots.push({
          kind: "pc",
          entityId: c.id,
          name: c.name,
          portraitAssetId: c.portraitAssetId,
          def: null,
          hpMode: "average",
          side: null,
        });
      }
      const joining = new Set(slots.map((sl) => sl.entityId));
      const pets = startPets(env, cid, petIds ?? [], joining);
      for (const e of entriesOf(tx, before)) {
        const def = resolveDefinition(env, e.definitionId);
        for (let i = 0; i < e.quantity; i++) {
          slots.push({
            kind: "monster",
            entityId: def.id,
            name: def.name,
            portraitAssetId: def.portraitAssetId,
            def,
            hpMode: e.hpMode,
            // FR-CBT-98 (#252): a friendly entry's instances start as allies, shown to players.
            side: e.side === "ally" ? "ally" : null,
          });
        }
      }
      // FR-CBT-109 (sprint 6): pets after the entries; each binds its token or joins token-less.
      for (const pet of pets) {
        slots.push({
          kind: "monster",
          entityId: pet.id,
          name: pet.name,
          portraitAssetId: pet.portraitAssetId,
          def: null,
          hpMode: "average",
          side: "ally",
          pet,
        });
      }
      const placer = new TokenPlacer(env, scene, at);
      // FR-FOG-14: a combatant's hidden copy = the token's `hidden` or fog-hidden.
      const placed = sceneTokens(tx, scene.id).map((t) => ({
        ...t,
        hidden: tokenHiddenForPlayers(t),
      }));
      const bindings = planBindings(slots, placed).map((b, i) => {
        const def = slots[i]?.def;
        if (b.tokenId !== null || !def || !before.createTokens) return b;
        const t = placer.place(def, before.addHidden);
        return {
          ...b,
          tokenId: t.id,
          name: t.name,
          imageAssetId: t.imageAssetId,
          hidden: tokenHiddenForPlayers(t),
        };
      });
      const hpEntries: RecordChange[] = [];
      bindings.forEach((b, i) => {
        const slot = slots[i] as StartSlot;
        let hp: number | null = null;
        let hpMax: number | null = null;
        if (slot.def) {
          const r = monsterHp(env, slot.def, slot.hpMode, b.name, encounterId);
          hp = r.hp;
          hpMax = r.hp;
          if (r.entry) hpEntries.push(r.entry);
        }
        const pet = slot.pet;
        if (pet) {
          // FR-CBT-109: the pet's kept HP; its stat block's max.
          hpMax = pet.statBlock.hpMax;
          hp = Math.min(pet.hpCurrent ?? hpMax, hpMax);
        }
        tx.insert(combatant)
          .values({
            id: ctx.ids.next(),
            campaignId: cid,
            encounterId,
            seq: combatantSeqNext,
            kind: b.kind,
            entityId: b.entityId,
            tokenId: b.tokenId,
            name: b.name,
            imageAssetId: b.imageAssetId,
            hidden: b.hidden,
            active: true,
            removed: false,
            initiative: null,
            initRollId: null,
            position: i + 1,
            playerPosition: null,
            hpCurrent: hp,
            hpMax,
            side: slot.side,
            publicSide: slot.side,
            ...(pet
              ? {
                  ownerCharacterId: pet.companionOf,
                  ownerPlayerId: pet.ownerPlayerId,
                  turnMode: pet.turnMode ?? "after-owner",
                  pet: true,
                  card: companionCard(pet.statBlock, () => ctx.ids.next()),
                }
              : {}),
          })
          .run();
      });
      // FR-CBT-64: monsters roll initiative in Start's transaction, so Initiative opens ranked.
      // FR-CBT-108: companions acting with their owner use the owner's number (no roll).
      const monsters = combatantsOf(tx, encounterId).filter(
        (c) => c.kind === "monster" && (c.turnMode === null || c.turnMode === "own"),
      );
      const init = rollInitiativeFor(env, monsters, encounterId, { mode: "normal" });
      rerank(tx, encounterId);
      const now = ctx.clock.iso();
      tx.update(encounter)
        .set({
          status: "started",
          sceneId: scene.id,
          round: 0,
          turnCombatantId: null,
          playerTurnCombatantId: null,
          startedAt: now,
          updatedAt: now,
        })
        .where(eq(encounter.id, encounterId))
        .run();
      const after = readEncounter(tx, encounterId);
      const rows = combatantsOf(tx, encounterId);
      const combatantIds = rows.map((r) => r.id);
      const changes = [
        ...placer.changes,
        encounterChange(before, after),
        ...rows.map((r) => combatantChange(null, r)),
        ...hpEntries,
        ...init.entries,
        // FR-ENT-37: a joining pet is present now (other players get its redacted row).
        ...syncPetPresence(env, cid, { petIds: pets.map((p) => p.id) }),
      ];
      env.emit({
        type: EncounterStarted.type,
        campaignId: cid,
        payload: { encounterId, sceneId: scene.id, combatantIds },
        changes,
      });
      changes.push(...hooks.run("started", env, after, { combatantIds }));
    },
  });

export const endCommandWith = (hooks: CombatRuleHooks) =>
  defineCommand({
    name: CBT_INTENTS.end,
    input: EndInput,
    execute({ encounterId }, env): void {
      const { tx, ctx } = env;
      const cid = campaignOf(env.actor);
      const before = getEncounter(tx, cid, encounterId);
      if (before.status !== "started") throw conflict("Encounter is not running");
      const rows = combatantsOf(tx, encounterId);
      const now = ctx.clock.iso();
      tx.update(encounter)
        .set({ status: "ended", endedAt: now, updatedAt: now })
        .where(eq(encounter.id, encounterId))
        .run();
      tx.update(combatant)
        .set({ active: false })
        .where(eq(combatant.encounterId, encounterId))
        .run();
      const after = readEncounter(tx, encounterId);
      const changes = [
        encounterChange(before, after),
        ...rows.map((r) => combatantChange(r, { ...r, active: false })),
        // FR-CBT-97: End clears the trails.
        ...(before.sceneId ? clearTrails(env, before.sceneId) : []),
        // FR-CBT-113 (sprint 6): pets' HP written back, summons' tokens deleted (1b).
        ...companionsAtEnd(env, rows),
      ];
      env.emit({ type: EncounterEnded.type, campaignId: cid, payload: { encounterId }, changes });
      changes.push(...hooks.run("ended", env, after, { combatantIds: rows.map((r) => r.id) }));
      // FR-CBT-59 / FR-CBT-61: after `EncounterEnded`, one `NotificationDismissed` per pending card
      // of this encounter whose kind opts in (`damage-card`; its hit-ruling delete rides on it,
      // `onClose`); same transaction.
      dismissForEncounter(env, encounterId);
    },
  });

/** Name / type handles (fixture steps, tests); the server registers the hook-bound commands. */
export const startCommand = startCommandWith(new CombatRuleHooks([]));
export const endCommand = endCommandWith(new CombatRuleHooks([]));
