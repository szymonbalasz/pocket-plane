// Sprint 6 CP1 (ENT §13): the Creatures "Pet of Mira" badge and Make pet… action (FR-ENT-39,
// FR-ENT-32 UI), the pet dialog's rules (owner choices, free-name prefill, inline "Name taken",
// the `POST /api/pets` body, "owl" → Owlbear through the shared matcher) and the creature form's
// whole `PUT` keeping a pet a pet (FR-ENT-33). The dialog's clicks: e2e/cp-pets.e2e.ts.
import { describe, expect, test } from "bun:test";
import type { PlayerRecord } from "@shared/campaign-management/schemas";
import { EntityRecord } from "@shared/entities/schemas";
import { lazyAfterSnapshot } from "@shared/protocol/lazy";
import { emptyStore } from "@shared/protocol/store";
import { TooltipProvider } from "@ui/components/ui/overlays";
import { lookupMatches } from "@ui/features/combat-tracker/lookup";
import { SyncContext, type SyncState } from "@ui/sync/store";
import { renderToStaticMarkup } from "react-dom/server";
import { createStore } from "zustand";
import { keptPetFields } from "../combat-tracker/creature-form";
import { actionsOf, creatureActions } from "./creature-actions";
import { CreaturesList } from "./creatures-window";
import { creatureRows } from "./list";
import { petCreatureAction } from "./pet-action";
import {
  monsterNameKeys,
  NAME_TAKEN,
  ownerOptions,
  parsedEntities,
  petBody,
  petNameError,
  suggestedPetName,
} from "./pet-logic";
import { petPutBody } from "./pet-rest";

const at = { createdAt: "t", updatedAt: "t", portraitAssetId: null, tokenShape: null };
const block = (hpMax: number) => ({
  size: "large",
  ac: 13,
  hpMax,
  initBonus: 1,
  attacks: [{ id: "a1", name: "Claws", toHit: 7, damage: "2d8+5", damageType: "slashing" }],
  cr: "3",
});
const pc = (id: string, name: string, owner: string) => ({
  ...at,
  id,
  kind: "character",
  campaignId: "c",
  name,
  statBlock: {
    size: "medium",
    ac: 16,
    hpMax: 12,
    initBonus: 2,
    attacks: [],
    level: 1,
    className: "",
  },
  ownerPlayerId: owner,
  hpCurrent: 12,
  derivedFromId: null,
});
const monster = (id: string, name: string, pet: { of: string; owner: string } | null = null) => ({
  ...at,
  id,
  kind: "monster",
  campaignId: "c",
  name,
  statBlock: block(59),
  ownerPlayerId: pet?.owner ?? null,
  hpCurrent: pet ? 45 : null,
  derivedFromId: pet ? "srd-owlbear" : null,
  companionOf: pet?.of ?? null,
  turnMode: pet ? "after-owner" : null,
  petPresent: false,
});

const players: PlayerRecord[] = [
  { id: "p1", campaignId: "c", name: "Player 1", color: "#19b98a" },
  { id: "p2", campaignId: "c", name: "Player 2", color: "#56b4e9" },
] as PlayerRecord[];
const records = [
  pc("mira", "Mira", "p1"),
  pc("thorn", "Thorn", "p2"),
  monster("owl", "Owlbear", { of: "mira", owner: "p1" }),
  monster("brute", "Goblin Brute"),
];

function render(entities: unknown[]) {
  const store = createStore<SyncState>()(
    () =>
      ({
        state: "live",
        everLive: true,
        store: {
          ...emptyStore(),
          you: { campaignId: "c", role: "dm", playerId: null },
          records: {
            entity: Object.fromEntries(entities.map((e) => [(e as { id: string }).id, e])),
            player: Object.fromEntries(players.map((p) => [p.id, p])),
          },
        },
        lazy: lazyAfterSnapshot(1),
        connection: { load: () => null, retryLoad: () => null },
      }) as unknown as SyncState,
  );
  return renderToStaticMarkup(
    <SyncContext.Provider value={store}>
      <TooltipProvider delayDuration={0} skipDelayDuration={0}>
        {/* Only this slice's action: the others need the play-shell. */}
        <CreaturesList actions={[petCreatureAction]} />
      </TooltipProvider>
    </SyncContext.Provider>,
  );
}

describe("FR-ENT-39 Creatures window", () => {
  test("FR-ENT-39 pet badge: 'Pet of Mira' on the pet row (lookups too), none on other customs", () => {
    const rows = creatureRows(records, [], players, "monster");
    expect(rows.map((r) => [r.name, r.badge, r.pet?.playerName ?? null])).toEqual([
      ["Goblin Brute", "Custom", null],
      ["Owlbear", "Pet of Mira", "Player 1"],
    ]);
    const html = render(records);
    expect(html).toMatch(/data-testid="ent-list-row-pet" data-record-id="owl"[^>]*>Pet of Mira</);
    expect(html.match(/data-testid="ent-list-row-pet"/g)).toHaveLength(1);
    expect(html).toMatch(/data-testid="ent-list-row-badge"[^>]*>Custom</);
  });

  test("FR-ENT-32 Make pet… on every monster row, never on characters", () => {
    expect(actionsOf(creatureActions).row.map((a) => a.id)).toContain("ent.make-pet");
    const html = render(records);
    const made = [...html.matchAll(/data-testid="ent-pet-make" data-record-id="(\w+)"/g)];
    expect(made.map((m) => m[1]).sort()).toEqual(["brute", "owl"]);
  });
});

describe("FR-ENT-32 pet dialog rules", () => {
  const entities = parsedEntities(records);
  const taken = monsterNameKeys(entities);

  test("FR-ENT-32 make pet dialog: owners with players, a PC at 3 pets disabled", () => {
    expect(ownerOptions(entities, players)).toEqual([
      { id: "mira", name: "Mira", playerName: "Player 1", pets: 1, full: false },
      { id: "thorn", name: "Thorn", playerName: "Player 2", pets: 0, full: false },
    ]);
    const full = parsedEntities([
      ...records,
      monster("o2", "Owl 2", { of: "mira", owner: "p1" }),
      monster("o3", "Owl 3", { of: "mira", owner: "p1" }),
    ]);
    expect(ownerOptions(full, players)[0]).toMatchObject({ name: "Mira", pets: 3, full: true });
    // A PC whose player is gone can't own (FR-CBT-105: "Mira has no player").
    expect(ownerOptions(parsedEntities([pc("x", "Xan", "gone")]), players)).toEqual([]);
  });

  test("FR-ENT-32 make pet dialog: the prefilled name is the server's free name; 'Name taken' inline", () => {
    expect(suggestedPetName("Wolf", "Mira", taken)).toBe("Wolf");
    // "Owlbear" is Mira's pet already → "Owlbear (Thorn)", then " 2".
    expect(suggestedPetName("Owlbear", "Thorn", taken)).toBe("Owlbear (Thorn)");
    const more = new Set([...taken, "owlbear (thorn)"]);
    expect(suggestedPetName("Owlbear", "Thorn", more)).toBe("Owlbear (Thorn) 2");
    expect(petNameError("owlbear ", taken)).toBe(NAME_TAKEN);
    expect(petNameError("  ", taken)).toBe("Name is required");
    expect(petNameError("Hoot", taken)).toBeNull();
  });

  test("FR-ENT-32 make pet dialog: body only when creature, owner and a free name are set", () => {
    const d = { baseId: "srd-owlbear", ownerId: "thorn", name: " Hoot ", mode: "own" as const };
    expect(petBody(d, taken)).toEqual({
      baseDefinitionId: "srd-owlbear",
      companionOf: "thorn",
      name: "Hoot",
      turnMode: "own",
    });
    expect(petBody({ ...d, baseId: null }, taken)).toBeNull();
    expect(petBody({ ...d, ownerId: null }, taken)).toBeNull();
    expect(petBody({ ...d, name: "Owlbear" }, taken)).toBeNull();
  });

  test("FR-ENT-32 make pet dialog: 'owl' finds the Owlbear first (shared matcher, FR-CBT-63)", () => {
    const rows = [
      { id: "b", name: "Bowl Golem", cr: "1", xp: 200, badge: "Custom" },
      { id: "srd-owlbear", name: "Owlbear", cr: "3", xp: 700, badge: "SRD" },
      { id: "c", name: "Owl", cr: "0", xp: 10, badge: "SRD" },
    ];
    expect(lookupMatches(rows, "owl").map((r) => r.name)).toEqual(["Owl", "Owlbear", "Bowl Golem"]);
    expect(lookupMatches(rows, "owlb").map((r) => r.name)).toEqual(["Owlbear"]);
  });
});

describe("FR-ENT-33 the whole PUT keeps a pet a pet", () => {
  const pet = EntityRecord.parse(monster("owl", "Owlbear", { of: "mira", owner: "p1" }));
  if (pet.kind !== "monster") throw new Error("monster");

  test("FR-ENT-33 creature form edit sends the loaded companionOf / turnMode; nothing for other creatures", () => {
    expect(keptPetFields(pet)).toEqual({ companionOf: "mira", turnMode: "after-owner" });
    expect(keptPetFields(EntityRecord.parse(monster("brute", "Goblin Brute")))).toEqual({});
    expect(keptPetFields(EntityRecord.parse(pc("mira", "Mira", "p1")))).toEqual({});
  });

  test("FR-ENT-33 Party menu PUT bodies: rename / mode / owner keep the rest; release nulls both", () => {
    const base = { portraitAssetId: null, tokenShape: null, statBlock: pet.statBlock };
    expect(petPutBody(pet, { name: "Hoot" })).toEqual({
      name: "Hoot",
      ...base,
      companionOf: "mira",
      turnMode: "after-owner",
    });
    expect(petPutBody(pet, { turnMode: "own" })).toMatchObject({
      name: "Owlbear",
      companionOf: "mira",
      turnMode: "own",
    });
    expect(petPutBody(pet, { companionOf: "thorn" })).toMatchObject({
      companionOf: "thorn",
      turnMode: "after-owner",
    });
    expect(petPutBody(pet, { companionOf: null })).toMatchObject({
      companionOf: null,
      turnMode: null,
    });
  });
});
