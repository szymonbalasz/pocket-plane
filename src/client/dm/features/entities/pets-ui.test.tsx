// Sprint 6 CP1 (ENT §13): the Creatures "Pet of Mira" badge and Make pet… action (FR-ENT-39,
// FR-ENT-32 UI), the pet dialog's rules (owner choices, free-name prefill, inline "Name taken",
// the `POST /api/pets` body, "owl" → Owlbear through the shared matcher) and the creature form's
// whole `PUT` keeping a pet a pet (FR-ENT-33). The dialog's clicks: e2e/cp-pets.e2e.ts.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
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
import { CreaturesList, NAME_MIN } from "./creatures-window";
import { creatureRows } from "./list";
import { petActionLabel, petCreatureAction } from "./pet-action";
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

  test("FR-ENT-39 names readable at the default width: a least-width name line, the badge on the second line, actions last (layout: e2e/cp-pets.e2e.ts)", () => {
    const html = render(records);
    const rows = html.split('data-testid="ent-list-row"').slice(1);
    expect(rows).toHaveLength(records.length);
    for (const r of rows) {
      // Name line with the least width (the cell can't collapse below it) and the full name.
      expect(r).toMatch(
        new RegExp(`class="[^"]*${NAME_MIN}[^"]*" data-testid="ent-list-row-main"`),
      );
      expect(r).toContain('data-testid="ent-list-row-name"');
      // Three cells: portrait, name (+ badge line), actions; no badge column any more.
      expect(r.match(/<td/g)).toHaveLength(3);
      // The badge sits in the name cell (before the actions cell, the third).
      const actionsAt = r.indexOf("<td", r.indexOf("<td", r.indexOf("<td") + 1) + 1);
      const badgeAt = Math.max(r.indexOf("ent-list-row-badge"), r.indexOf("ent-list-row-pet"));
      expect(badgeAt).toBeGreaterThan(r.indexOf("ent-list-row-name"));
      expect(badgeAt).toBeLessThan(actionsAt);
    }
  });

  test("FR-ENT-42 creature names whole: the name wraps onto two lines (no single-line ellipsis), its Tooltip keeps the whole name (layout at 300 / 340 wide: e2e/small-copy-s7.e2e.ts)", () => {
    const html = render(records);
    const names = [...html.matchAll(/<span class="([^"]*)" data-testid="ent-list-row-name"/g)];
    expect(names).toHaveLength(records.length);
    for (const [, cls] of names) {
      expect((cls ?? "").split(" ")).toEqual(
        expect.arrayContaining(["line-clamp-2", "break-words"]),
      );
      expect(cls).not.toContain("truncate");
    }
  });

  test("FR-ENT-43 no Make pet on a pet: a pet row reads Copy as a new pet…; a monster row Make pet…", () => {
    const html = render(records);
    expect(html).toMatch(
      /data-testid="ent-pet-make" data-record-id="owl" aria-label="Copy Owlbear as a new pet"/,
    );
    expect(html).toMatch(
      /data-testid="ent-pet-make" data-record-id="brute" aria-label="Make pet from Goblin Brute"/,
    );
    expect(
      petActionLabel({
        name: "Drake Companion",
        pet: { characterId: "b", characterName: "Brakka", playerName: "Player 1" },
      }),
    ).toEqual({
      label: "Copy as a new pet…",
      aria: "Copy Drake Companion as a new pet",
    });
    expect(petActionLabel({ name: "Owlbear", pet: null }).label).toBe("Make pet…");
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
    // No owner picked yet: the plain name, never "Owlbear ()".
    expect(suggestedPetName("Owlbear", null, taken)).toBe("Owlbear");
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

// ---------- kit parity K4 (§6.9) ----------

describe("FR-KIT-84 creature medallion", () => {
  /** The opening tag of a row's medallion. */
  const medallion = (html: string, id: string) => {
    const row = html.slice(html.indexOf(`data-testid="ent-list-row" data-record-id="${id}"`));
    const at = row.indexOf('data-testid="ent-list-row-medallion"');
    return row.slice(row.lastIndexOf("<", at), row.indexOf("</span>", at) + 7);
  };

  test("FR-KIT-84 creature medallion: lg; characters on the owner's colour, typed monsters on their creature-type colour, untyped neutral; the initial without a portrait", () => {
    const typed = { ...monster("gob", "Goblin"), statBlock: { ...block(7), type: "humanoid" } };
    const html = render([...records, typed]);
    const mira = medallion(html, "mira");
    expect(mira).toContain('data-slot="kit-medallion" data-size="lg"');
    expect(mira).toMatch(/background-color:#19b98a[^>]*>M</);
    expect(medallion(html, "thorn")).toContain("background-color:#56b4e9");
    expect(medallion(html, "gob")).toMatch(
      /background-color:var\(--creature-humanoid, #[0-9a-f]{6}\);color:var\(--creature-glyph, #fff\)[^>]*>G</,
    );
    const brute = medallion(html, "brute");
    expect(brute).not.toContain("background-color");
    expect(brute).toContain("bg-muted");
    // The old icon tile is gone; badges and actions keep their place.
    expect(html).not.toContain("lucide-paw-print");
    expect(html).toMatch(/data-testid="ent-list-row-pet" data-record-id="owl"[^>]*>Pet of Mira</);
  });

  test("FR-KIT-84 a portrait wins: the medallion shows the image asset", () => {
    // `AssetImg` makes an `Image` while rendering; the server render has none.
    const g = globalThis as { Image?: unknown };
    const had = "Image" in g;
    if (!had) g.Image = class {};
    let html: string;
    try {
      html = render([{ ...pc("mira", "Mira", "p1"), portraitAssetId: "a-mira" }]);
    } finally {
      if (!had) delete g.Image;
    }
    const mira = medallion(html, "mira");
    expect(mira).toContain("data-image");
    expect(mira).not.toContain("background-color");
  });

  test("FR-KIT-01 same DOM per theme: the Creatures rows read no theme", () => {
    expect(readFileSync(join(import.meta.dir, "creatures-window.tsx"), "utf8")).not.toMatch(
      /data-theme|useTheme/,
    );
  });
});
