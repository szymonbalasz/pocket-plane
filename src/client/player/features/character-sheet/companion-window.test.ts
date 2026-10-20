// Player `charx.companion` def (FR-CHARX-59, FR-SHELL-61 (5), OQ-CHARX-33): geometry, launcher
// "Companions", available iff the player owns a pet or an active companion combatant.
import { expect, test } from "bun:test";
import { COMBATANT_TYPE, ENCOUNTER_TYPE } from "@shared/combat-tracker/schemas";
import { ENTITY_TYPE } from "@shared/entities/schemas";
import { emptyStore, type RecordStore } from "@shared/protocol/store";
import {
  createOwnershipHold,
  GONE_MS,
  goneOutcome,
} from "@ui/features/character-sheet/companion/picker";
import { playerCompanionWindow } from "./companion-window";

const mira = { id: "mira", kind: "character", name: "Mira", ownerPlayerId: "p1" };
const owlPet = {
  id: "owl",
  kind: "monster",
  name: "Owlbear",
  campaignId: "c1",
  ownerPlayerId: "p1",
  companionOf: "mira",
  turnMode: "after-owner",
  hpCurrent: 45,
  statBlock: { size: "large", ac: 13, hpMax: 59, initBonus: 1, attacks: [], cr: "3" },
};
/** Player-2's redacted view of the Owlbear (FR-ENT-37). */
const owlRedacted = {
  id: "owl",
  kind: "monster",
  name: "Owlbear",
  ownerPlayerId: "p1",
  companionOf: "mira",
  band: "healthy",
};
const summon = {
  id: "c-fe",
  encounterId: "e1",
  kind: "monster",
  name: "Fire Elemental",
  removed: false,
  ownerCharacterId: "mira",
  ownerPlayerId: "p1",
  turnMode: "after-owner",
  pet: false,
};
const enc = { id: "e1", status: "started", round: 1, playerTurnCombatantId: null };

function store(
  playerId: string,
  rows: { entities?: object[]; combatants?: object[] },
): RecordStore {
  const byId = (r: object[] = []) =>
    Object.fromEntries(r.map((x) => [(x as { id: string }).id, x]));
  return {
    ...emptyStore(),
    you: { campaignId: "c1", role: "player", playerId } as RecordStore["you"],
    records: {
      [ENTITY_TYPE]: byId(rows.entities),
      [COMBATANT_TYPE]: byId(rows.combatants),
      [ENCOUNTER_TYPE]: byId(rows.combatants ? [enc] : []),
    },
  };
}

test("FR-CHARX-59 window (player): charx.companion top-left dx 56, 320×360 min 280×240, closed by default; launcher Companions available iff the player owns a companion", () => {
  const def = playerCompanionWindow;
  expect(def).toMatchObject({
    kind: "charx.companion",
    title: "Companion",
    clients: ["player"],
    defaultSize: { w: 320, h: 360 },
    minSize: { w: 280, h: 240 },
    defaultPosition: { anchor: "top-left", dx: 56 },
    defaultOpen: false,
  });
  expect(def.launcher?.label).toBe("Companions");
  const available = def.available;
  if (!available) throw new Error("no available()");
  // (The page's hold keeps a just-lost companion's card for 3 s: check "none" first.)
  expect(available(store("p2", { entities: [mira, owlRedacted] }))).toBe(false);
  expect(
    available(store("p2", { entities: [mira], combatants: [{ ...summon, card: undefined }] })),
  ).toBe(false);
  expect(available(store("p1", { entities: [mira], combatants: [summon] }))).toBe(true); // a summon
  expect(available(store("p1", { entities: [mira, owlPet] }))).toBe(true); // a pet, no fight
});

test("FR-CHARX-68 last companion leaves (walkthrough 19): the window stays available for the 3 s message, then the card closes it", () => {
  let t = 0;
  const hold = createOwnershipHold(() => t);
  expect(hold(false)).toBe(false); // never owned one
  expect(hold(true)).toBe(true);
  t = 1000;
  expect(hold(false)).toBe(true); // just left: the card shows "No longer your companion"
  t = 1000 + GONE_MS - 1;
  expect(hold(false)).toBe(true);
  t = 1000 + GONE_MS;
  expect(hold(false)).toBe(false); // gone
  expect(hold(true)).toBe(true); // a new one
  // After the message the card closes itself when nothing is left (player); else moves on.
  expect(goneOutcome([], "player")).toBe("close");
  expect(goneOutcome([], "dm")).toBe("next");
  expect(goneOutcome([{ key: "owl" } as never], "player")).toBe("next");
});
