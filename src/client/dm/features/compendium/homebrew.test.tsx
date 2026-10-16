// FR-CMP-24 / -25 / -27 DM client: the homebrew form model (New / Clone / Edit; fields the form
// doesn't show kept), the Derive… model (definition fields kept, Copy text on), and the entry
// actions per entry (Derive… on monsters; Clone on others; Edit / Delete on homebrew only).
import { describe, expect, test } from "bun:test";
import type { EntryResponse } from "@shared/compendium/rest";
import type { CompendiumEntry } from "@shared/compendium/schemas";
import { emptyStore } from "@shared/protocol/store";
import type { Api } from "@ui/api";
import { TooltipProvider } from "@ui/components/ui/overlays";
import { SyncContext, type SyncState } from "@ui/sync/store";
import { renderToStaticMarkup } from "react-dom/server";
import { createStore } from "zustand";
import { deriveStatBlock, initialDerive } from "./derive-form";
import { EntryActions } from "./EntryActions";
import { draftError, draftOf, initialFields } from "./homebrew-form";

const ROW = {
  derivedFromId: null,
  createdAt: "t",
  updatedAt: "t",
  definitionId: null,
  importedAt: null,
};
const FIREBALL: CompendiumEntry = {
  ...ROW,
  id: "e-fire",
  campaignId: null,
  kind: "spell",
  source: "srd-5.1",
  sourceKey: "spell/fireball",
  name: "Fireball",
  line: "Level 3 evocation",
  facets: {
    level: 3,
    school: "evocation",
    classes: ["Wizard"],
    concentration: false,
    ritual: false,
  },
  body: {
    castingTime: "1 action",
    range: "150 feet",
    components: "V, S, M",
    material: "A tiny ball of bat guano and sulfur.",
    duration: "Instantaneous",
    text: "A bright streak flashes.",
    higherLevel: "+1d6 per slot level above 3rd.",
  },
  shared: false,
  importedAt: "t",
};
const SHARD: CompendiumEntry = {
  ...ROW,
  id: "e-shard",
  campaignId: "c1",
  kind: "item",
  source: null,
  sourceKey: null,
  name: "Moonblade Shard",
  line: "Rare wondrous item",
  facets: { category: "magic", rarity: "rare", attunement: true },
  body: { typeLine: "Wondrous item", weight: "1 lb.", text: "Glows." },
  shared: true,
};
const FURY_RULE = {
  on: "hit",
  when: [{ if: "ownTurn" }],
  every: "turn",
  // biome-ignore lint/suspicious/noThenProperty: `then` is the rule's effect field (MOD §8.4)
  then: { do: "damage", formula: "1d6", type: "radiant" },
};
const FURY: CompendiumEntry = {
  ...SHARD,
  id: "e-fury",
  kind: "feature",
  name: "Divine Fury",
  line: "Barbarian · 3rd level",
  facets: { className: "Barbarian", level: 3 },
  body: { text: "Radiant.", preset: FURY_RULE },
};
const STAT_BLOCK = {
  size: "small" as const,
  ac: 15,
  hpMax: 7,
  hpFormula: "2d6",
  initBonus: 2,
  speed: 30,
  cr: "1/4",
  abilities: { str: 8, dex: 14, con: 10, int: 10, wis: 8, cha: 8 },
  attacks: [
    { name: "Scimitar", toHit: 4, damage: "1d6+2", damageType: "slashing" as const },
    { name: "Shortbow", toHit: 4, damage: "1d6+2", damageType: "piercing" as const },
  ],
  senses: { visionFt: 0, darkvisionFt: 60, seesMagicalDarkness: false },
};

describe("FR-CMP-24 FR-CMP-25 homebrew form model", () => {
  test("FR-CMP-25 clone: prefilled from the entry, not shared, hidden fields kept (material, higher levels); an imported name is kept", () => {
    const f = initialFields({ kind: "clone", base: FIREBALL });
    expect(f).toMatchObject({ kind: "spell", name: "Fireball", level: "3", shared: false });
    const d = draftOf({ ...f, name: "Fireball (house)" }) as { body: Record<string, unknown> };
    expect(d.body.material).toBe("A tiny ball of bat guano and sulfur.");
    expect(d.body.higherLevel).toBe("+1d6 per slot level above 3rd.");
    expect(draftError({ ...f, name: "Fireball (house)" })).toBeNull();
    // A homebrew base: "(copy)" so the clone doesn't clash with its base's name.
    expect(initialFields({ kind: "clone", base: SHARD }).name).not.toBe("Moonblade Shard");
  });

  test("FR-CMP-24 edit keeps shared and the feature's inline preset; New starts blank; client mirror refuses a long text or an empty name", () => {
    const f = initialFields({ kind: "edit", entry: FURY });
    expect(f).toMatchObject({ kind: "feature", shared: true, className: "Barbarian" });
    expect((draftOf(f) as { body: { preset: unknown } }).body.preset).toEqual(FURY_RULE);
    expect(draftOf(f)).toMatchObject({ facets: { className: "Barbarian", level: 3 } });
    const blank = initialFields({ kind: "new" }, "item");
    expect(blank).toMatchObject({ kind: "item", name: "", shared: false });
    expect(draftError(blank)).not.toBeNull();
    expect(draftError({ ...blank, name: "Lucky Coin" })).toBeNull();
    expect(draftError({ ...blank, name: "Lucky Coin", text: "x".repeat(8_001) })).toContain("8000");
    const item = draftOf({ ...initialFields({ kind: "edit", entry: SHARD }), rarity: "Very Rare" });
    expect(item).toMatchObject({
      facets: { rarity: "very rare", attunement: true },
      body: { weight: "1 lb." },
    });
  });
});

describe("FR-CMP-27 Derive… model", () => {
  test("FR-CMP-27 prefilled from the definition; HP changed; attacks / scores / senses kept; copy text on", () => {
    const f = initialDerive("Goblin", { statBlock: STAT_BLOCK });
    expect(f).toMatchObject({ name: "Goblin", hpMax: "7", hpFormula: "2d6", copyText: true });
    const r = deriveStatBlock(
      { ...f, name: "Goblin Sneak", hpMax: "12" },
      { statBlock: STAT_BLOCK },
    );
    if (!r.ok) throw new Error(r.message);
    expect(r.value.hpMax).toBe(12);
    expect(r.value.attacks.map((a) => a.name)).toEqual(["Scimitar", "Shortbow"]);
    expect(r.value.senses?.darkvisionFt).toBe(60);
    expect(r.value.abilities?.dex).toBe(14);
    expect(deriveStatBlock({ ...f, ac: "99" }, { statBlock: STAT_BLOCK }).ok).toBe(false);
  });
});

function render(data: EntryResponse) {
  const s = createStore<SyncState>()(
    () =>
      ({
        state: "live",
        store: { ...emptyStore(), you: { campaignId: "c1", role: "dm", playerId: null } },
        lazy: {},
        connection: {},
      }) as unknown as SyncState,
  );
  return renderToStaticMarkup(
    <SyncContext.Provider value={s}>
      <TooltipProvider delayDuration={0} skipDelayDuration={0}>
        <EntryActions api={{} as Api} data={data} />
      </TooltipProvider>
    </SyncContext.Provider>,
  );
}

describe("CMP §7 DM entry actions", () => {
  test("FR-CMP-27 FR-CMP-25 Derive… on a monster with a definition; Clone on imported; Clone / Edit / Delete on homebrew", () => {
    const goblin: EntryResponse = {
      entry: {
        ...FIREBALL,
        id: "e-gob",
        kind: "monster",
        sourceKey: "monster/goblin",
        name: "Goblin",
        definitionId: "d-gob",
      },
      source: null,
      definition: { id: "d-gob", name: "Goblin", statBlock: STAT_BLOCK },
    };
    const gob = render(goblin);
    expect(gob).toContain('data-testid="cmp-derive"');
    expect(gob).not.toContain("cmp-clone");
    const fire = render({ entry: FIREBALL, source: null });
    expect(fire).toContain('data-testid="cmp-clone"');
    expect(fire).not.toContain("cmp-edit");
    expect(fire).not.toContain("cmp-delete");
    const shard = render({ entry: SHARD, source: null });
    for (const id of ["cmp-clone", "cmp-edit", "cmp-delete"]) {
      expect(shard).toContain(`data-testid="${id}"`);
    }
  });
});
