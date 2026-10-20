// `cbtx.addCombatants` (FR-CBTX-26/27, #172; sprint 2 FR-CBTX-44): tokens from the map, characters
// or monsters (× quantity, HP mode) from the Add dialog join the started encounter at any round.
// Per monster instance, FR-CBT-64's order: a free placed token → bound; else `createTokens` → a
// created token (`hidden`) around `at`; else token-less, visible (FR-CBT-08). Characters never get
// a created token. Monsters roll initiative on the way in (DM-only, FR-CBT-69); PCs join without.
// Ranks + player turn rewritten; `added` hook (FR-CBTX-13). All or nothing. Encounter entries
// stay the plan (OQ-CBTX-17). Sprint 6 (OQ-CBT-84 a, FR-CBT-109's rules): a pet (its token or the
// pet itself, one each) joins as itself: owner copies, its mode, its kept HP, `card`, side ally;
// its owner PC must be in the fight.
import {
  AddCombatantsInput,
  CBTX_INTENTS,
  COMBATANTS_MAX,
  type CombatantIdsResult,
} from "@shared/combat-extras/intents";
import type { CombatantKind, HpMode } from "@shared/combat-tracker/schemas";
import { companionCard, type DefinitionRecord, type MonsterRecord } from "@shared/entities/schemas";
import { CombatantsAdded } from "@shared/events/combat-extras";
import { numberedName } from "@shared/scenes-map/geometry";
import type { TokenRecord } from "@shared/scenes-map/schemas";
import { defineCommand } from "../../commands/commands";
import { conflict, invalid, notFound } from "../../commands/errors";
import { combatant, combatantSeqNext } from "../../db/schema";
import type { RecordChange } from "../../events/types";
import { getCharacter } from "../character-sheet/hp";
import { assertCompanionCap, ownerOfCompanion } from "../combat-tracker/companions";
import { rollInitiativeFor } from "../combat-tracker/initiative";
import { monsterHp, TokenPlacer } from "../combat-tracker/join";
import { combatantDiff, encounterDiff, rerank, syncPlayerTurn } from "../combat-tracker/ranks";
import {
  campaignOf,
  combatantChange,
  combatantsOf,
  getEncounter,
  readCombatant,
} from "../combat-tracker/rows";
import type { CombatRuleHooks } from "../combat-tracker/rule-hooks";
import { resolveDefinition } from "../entities/commands";
import { syncPetPresence } from "../entities/pet-presence";
import { getRow, toEntityRecord } from "../entities/rows";
import { getScene, sceneTokens } from "../scenes-map/rows";
import { tokenHiddenForPlayers } from "../scenes-map/visibility-hooks";

interface Slot {
  kind: CombatantKind;
  def: DefinitionRecord;
  hpMode: HpMode;
  tokenId: string | null;
  name: string;
  imageAssetId: string | null;
  hidden: boolean;
  /** Sprint 6 (OQ-CBT-84 a): the pet joining as itself. */
  pet?: MonsterRecord;
}

const instances = (i: AddCombatantsInput["items"][number]) =>
  "definitionId" in i ? (i.quantity ?? 1) : 1;

export function addCombatantsCommand(hooks: CombatRuleHooks) {
  return defineCommand({
    name: CBTX_INTENTS.addCombatants,
    input: AddCombatantsInput,
    execute({ encounterId, items, createTokens, hidden, at }, env): CombatantIdsResult {
      const { tx, ctx } = env;
      const cid = campaignOf(env.actor);
      const before = getEncounter(tx, cid, encounterId);
      if (before.status !== "started") throw conflict("Encounter is not running");
      const rows = combatantsOf(tx, encounterId);
      const total = items.reduce((n, i) => n + instances(i), 0);
      if (rows.length + total > COMBATANTS_MAX) {
        throw conflict(`At most ${COMBATANTS_MAX} combatants`);
      }
      // FR-CBT-65: no scene (deleted since Start) → no tokens, creatures join token-less.
      const scene = before.sceneId ? getScene(tx, cid, before.sceneId) : null;
      const tokens = scene ? sceneTokens(tx, scene.id) : [];
      const placer = scene && createTokens ? new TokenPlacer(env, scene, at) : null;
      const taken = new Set(rows.filter((r) => r.active && r.tokenId).map((r) => r.tokenId));
      const inCombat = new Set(
        rows.filter((r) => r.active && r.kind === "pc").map((r) => r.entityId),
      );
      // Tokens named by an item are claimed first, so a picker item never takes them.
      for (const it of items) if ("tokenId" in it) taken.add(it.tokenId);
      const names = rows.map((r) => r.name);
      const slots: Slot[] = [];
      const joinPc = (id: string, name: string) => {
        if (inCombat.has(id)) throw conflict(`${name} is already in combat`);
        inCombat.add(id);
      };
      const nextFreeToken = (definitionId: string) => {
        const t = tokens.find((x) => !taken.has(x.id) && x.definitionId === definitionId);
        if (t) taken.add(t.id);
        return t ?? null;
      };
      // FR-CBT-08: a token's name, image and hidden flag (hidden or fog-hidden, FR-FOG-14);
      // token-less → numbered, visible.
      const petOf = (id: string): MonsterRecord | null => {
        const row = getRow(tx, id);
        const e = row && row.campaignId === cid ? toEntityRecord(row) : null;
        return e?.kind === "monster" && e.companionOf !== null ? e : null;
      };
      const push = (
        kind: CombatantKind,
        def: DefinitionRecord,
        hpMode: HpMode,
        tok: TokenRecord | null,
        pet?: MonsterRecord,
      ) => {
        const slot: Slot = tok
          ? {
              kind,
              def,
              hpMode,
              tokenId: tok.id,
              name: tok.name,
              imageAssetId: tok.imageAssetId,
              hidden: tokenHiddenForPlayers(tok),
            }
          : {
              kind,
              def,
              hpMode,
              tokenId: null,
              name: numberedName(def.name.slice(0, 40), names),
              imageAssetId: def.portraitAssetId,
              hidden: false,
            };
        names.push(slot.name);
        slots.push(pet ? { ...slot, pet } : slot);
      };
      items.forEach((it, i) => {
        let tok: TokenRecord | null = null;
        let entityId: string;
        if ("tokenId" in it) {
          tok = tokens.find((x) => x.id === it.tokenId) ?? null;
          if (!tok) throw notFound("Token not found on the encounter's scene");
          if (rows.some((r) => r.active && r.tokenId === it.tokenId)) {
            throw conflict(`${tok.name} is already in combat`);
          }
          entityId = tok.definitionId;
        } else if ("characterId" in it) {
          entityId = getCharacter(env, it.characterId).id;
        } else {
          entityId = it.definitionId;
        }
        const def = resolveDefinition(env, entityId);
        if (def.kind === "character") {
          joinPc(def.id, def.name);
          push("pc", def, "average", tok ?? ("tokenId" in it ? null : nextFreeToken(def.id)));
          return;
        }
        if (def.kind !== "monster") throw invalid("Only monsters and characters can join combat");
        if ("characterId" in it) throw notFound("Character not found");
        const pet = petOf(def.id);
        if (pet) {
          if (instances(it) > 1) {
            const message = `${pet.name} is one creature`;
            throw invalid(message, [{ path: ["items", i, "quantity"], message }]);
          }
          if (rows.some((r) => r.active && r.entityId === pet.id)) {
            throw conflict(`${pet.name} is already in combat`);
          }
          push("monster", def, "average", tok ?? nextFreeToken(def.id), pet);
          return;
        }
        if (tok) {
          push("monster", def, "average", tok);
          return;
        }
        const hpMode = ("definitionId" in it && it.hpMode) || "average";
        if (hpMode === "rolled" && !def.statBlock.hpFormula) {
          const message = `${def.name} has no HP formula`;
          throw invalid(message, [{ path: ["items", i, "hpMode"], message }]);
        }
        for (let n = 0; n < instances(it); n++) {
          const free = nextFreeToken(def.id);
          // FR-CBTX-44: a created token takes `hidden`; a bound existing token keeps its own.
          const made = free ?? placer?.place(def, hidden ?? false) ?? null;
          push("monster", def, hpMode, made);
        }
      });

      // FR-CBT-105 / -121: a pet's owner PC is in this fight with a player; ≤ 8 companions each.
      const petsPer = new Map<string, number>();
      for (const s of slots) {
        if (!s.pet?.companionOf) continue;
        const o = ownerOfCompanion(tx, before, s.pet.companionOf);
        const n = (petsPer.get(o.row.entityId) ?? 0) + 1;
        petsPer.set(o.row.entityId, n);
        assertCompanionCap(rows, { name: o.name, characterId: o.row.entityId }, n);
      }
      const ids: string[] = [];
      const hpEntries: RecordChange[] = [];
      for (const s of slots) {
        const id = ctx.ids.next();
        ids.push(id);
        let hp: number | null = null;
        let hpMax: number | null = null;
        const pet = s.pet;
        if (pet) {
          // FR-CBT-109: the pet's kept HP; its stat block's max.
          hpMax = pet.statBlock.hpMax;
          hp = Math.min(pet.hpCurrent ?? hpMax, hpMax);
        } else if (s.kind === "monster") {
          const r = monsterHp(env, s.def, s.hpMode, s.name, encounterId);
          hp = r.hp;
          hpMax = r.hp;
          if (r.entry) hpEntries.push(r.entry);
        }
        tx.insert(combatant)
          .values({
            id,
            campaignId: cid,
            encounterId,
            seq: combatantSeqNext,
            kind: s.kind,
            entityId: s.def.id,
            tokenId: s.tokenId,
            name: s.name,
            imageAssetId: s.imageAssetId,
            hidden: s.hidden,
            active: true,
            removed: false,
            initiative: null,
            initRollId: null,
            position: rows.length + ids.length,
            playerPosition: null,
            hpCurrent: hp,
            hpMax,
            tempHp: 0,
            movedFt: 0,
            ...(pet
              ? {
                  side: "ally" as const,
                  publicSide: "ally" as const,
                  ownerCharacterId: pet.companionOf,
                  ownerPlayerId: pet.ownerPlayerId,
                  turnMode: pet.turnMode ?? "after-owner",
                  pet: true,
                  card: companionCard(pet.statBlock, () => ctx.ids.next()),
                }
              : {}),
          })
          .run();
      }
      // FR-CBTX-44: initiative before adding: every added monster, token items included.
      // FR-CBT-108: a pet acting with its owner uses the owner's number (no roll).
      const monsters = ids
        .map((id) => readCombatant(tx, id))
        .filter((c) => c.kind === "monster" && (c.turnMode === null || c.turnMode === "own"));
      const init = rollInitiativeFor(env, monsters, encounterId, { mode: "normal" });
      rerank(tx, encounterId);
      const after = syncPlayerTurn(env, encounterId);
      const changes: RecordChange[] = [
        ...(placer?.changes ?? []),
        ...ids.map((id) => combatantChange(null, readCombatant(tx, id))),
        ...hpEntries,
        ...init.entries,
        ...combatantDiff(tx, rows),
        ...encounterDiff(before, after),
        // FR-ENT-37: a joining pet is present now (other players get its redacted row).
        ...syncPetPresence(env, cid, {
          petIds: slots.flatMap((s) => (s.pet ? [s.pet.id] : [])),
        }),
      ];
      env.emit({
        type: CombatantsAdded.type,
        campaignId: cid,
        payload: { encounterId, combatantIds: ids },
        changes,
      });
      // FR-CBTX-27: `added` hooks after the owner event; their rows join its changes.
      changes.push(...hooks.run("added", env, after, { combatantIds: ids }));
      return { combatantIds: ids };
    },
  });
}
