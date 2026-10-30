// FR-CMP-28 Add to sheet (client): who the picker lists (DM every campaign character, player
// own), the Toast copy, the button on spell / item / feature views only; FR-CMP-29 "Preset:
// ‹name›" on views whose entry resolves a trigger preset.
import { describe, expect, test } from "bun:test";
import type { EntryResponse } from "@shared/compendium/rest";
import { ENTITY_TYPE } from "@shared/entities/schemas";
import { emptyStore } from "@shared/protocol/store";
import { renderToStaticMarkup } from "react-dom/server";
import { createStore } from "zustand";
import { TooltipProvider } from "../../components/ui/overlays";
import { SyncContext, type SyncState } from "../../sync/store";
import { addedMessage, characterOptions } from "./add-to-sheet";
import type { Role } from "./logic";
import { EntryView } from "./views";

const MIRA = { id: "c-mira", kind: "character", name: "Mira", ownerPlayerId: "p1" };
const THORN = { id: "c-thorn", kind: "character", name: "Thorn", ownerPlayerId: "p2" };
const NPC = { id: "m-1", kind: "monster", name: "Elite Goblin Warrior", ownerPlayerId: null };

const ROW = {
  campaignId: null,
  derivedFromId: null,
  imageAssetIds: [],
  createdAt: "t",
  updatedAt: "t",
  definitionId: null,
  shared: false,
  importedAt: "t",
};
const entry = (e: Partial<EntryResponse["entry"]>): EntryResponse => ({
  entry: {
    ...ROW,
    id: "e1",
    kind: "condition",
    source: "srd-5.1",
    sourceKey: "condition/poisoned",
    name: "Poisoned",
    line: "Condition",
    facets: {},
    body: { text: "t" },
    ...e,
  },
  source: null,
});
const SNEAK = entry({
  id: "e-sneak",
  kind: "feature",
  sourceKey: "feature/rogue/sneak-attack",
  name: "Sneak Attack",
  line: "Rogue · 1st level",
  facets: { className: "Rogue", level: 1 },
});
const RAGE = entry({
  id: "e-rage",
  kind: "feature",
  sourceKey: "feature/barbarian/rage",
  name: "Rage",
  facets: { className: "Barbarian", level: 1 },
});
const POTION = entry({
  id: "e-potion",
  kind: "item",
  sourceKey: "item/potion-of-healing",
  name: "Potion of Healing",
  facets: { category: "magic", rarity: "common", attunement: false },
  body: { typeLine: "Potion", text: "t" },
});

function render(role: Role, data: EntryResponse, entities = [MIRA, THORN, NPC]) {
  const you = { campaignId: "c1", role, playerId: role === "dm" ? null : "p1" };
  const s = createStore<SyncState>()(
    () =>
      ({
        state: "live",
        store: {
          ...emptyStore(),
          you,
          records: { [ENTITY_TYPE]: Object.fromEntries(entities.map((e) => [e.id, e])) },
        },
        lazy: {},
        connection: { load: () => null, retryLoad: () => null },
      }) as unknown as SyncState,
  );
  return renderToStaticMarkup(
    <SyncContext.Provider value={s}>
      <TooltipProvider delayDuration={0} skipDelayDuration={0}>
        <EntryView data={data} viewer={role} />
      </TooltipProvider>
    </SyncContext.Provider>,
  ).replaceAll("<!-- -->", "");
}

describe("FR-CMP-28 Add to sheet (client)", () => {
  test("FR-CMP-28 picker: DM every campaign character (no NPCs); a player only their own", () => {
    const all = [THORN, NPC, MIRA];
    expect(characterOptions(all, { role: "dm", playerId: null })).toEqual([
      { id: "c-mira", name: "Mira" },
      { id: "c-thorn", name: "Thorn" },
    ]);
    expect(characterOptions(all, { role: "player", playerId: "p2" })).toEqual([
      { id: "c-thorn", name: "Thorn" },
    ]);
    expect(characterOptions(all, null)).toEqual([]);
  });

  test("FR-CMP-28 Toast: 'Added to Mira's Features' (+ ' and Triggers' with a preset)", () => {
    expect(addedMessage("Mira", { list: "features" })).toBe("Added to Mira's Features");
    expect(addedMessage("Thorn", { list: "features", triggerId: "t1" })).toBe(
      "Added to Thorn's Features and Triggers",
    );
    expect(addedMessage("Mira", { list: "spells" })).toBe("Added to Mira's Spells");
  });

  test("FR-CMP-28 Toast when the trigger was skipped as a duplicate (#241)", () => {
    expect(addedMessage("Thorn", { list: "features", triggerSkipped: true })).toBe(
      "Added to Thorn's Features. Trigger already on the sheet — delete it first to use the compendium's.",
    );
  });

  test("FR-CMP-28 the button on spell / item / feature views (both roles); none on conditions, nor for a player without a character", () => {
    expect(render("player", SNEAK)).toContain('data-testid="cmp-add-to-sheet"');
    expect(render("dm", POTION)).toContain('data-testid="cmp-add-to-sheet"');
    expect(render("dm", entry({}))).not.toContain("cmp-add-to-sheet");
    expect(render("player", POTION, [THORN])).not.toContain("cmp-add-to-sheet");
  });

  test("FR-CMP-29 'Preset: Sneak Attack' on the Sneak Attack view; none on Rage (an effect preset)", () => {
    const html = render("player", SNEAK);
    expect(html).toContain('data-testid="cmp-preset"');
    expect(html.replace(/<[^>]+>/g, "")).toContain("Preset: Sneak Attack");
    expect(render("player", RAGE)).not.toContain("cmp-preset");
  });

  test("FR-CMPX-15 the Preset line shows the server's inherited name; an own preset wins", () => {
    const text = (data: EntryResponse) => render("player", data).replace(/<[^>]+>/g, "");
    const book = entry({
      id: "e-book",
      kind: "spell",
      source: "5et-tb1",
      sourceKey: "spell/hunters-mark",
      name: "Hunter's Mark",
      line: "Level 1 divination",
      facets: { level: 1, school: "divination", classes: [], concentration: true, ritual: false },
      body: { castingTime: "a", range: "b", components: "V", duration: "c", text: "t" },
    });
    expect(render("player", book)).not.toContain("cmp-preset");
    expect(text({ ...book, inheritedPreset: "Marked" })).toContain("Preset: Marked");
    expect(text({ ...SNEAK, inheritedPreset: "Other" })).toContain("Preset: Sneak Attack");
  });
});
