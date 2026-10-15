// MOD client units (MOD §13 unit): modifiers in words, editor drafts, the `mod.effects` section
// registration, its test IDs and owner / DM / locked states (static render over a fake store).
import { describe, expect, test } from "bun:test";
import { CREATURE_SHEET_TYPE, defaultSheetData } from "@shared/character-sheet/sheet";
import { EFFECT_TYPE } from "@shared/combat-extras/schemas";
import { builtinPreset } from "@shared/effect-modifiers/presets";
import { EFFECT_PRESET_TYPE, type Modifier } from "@shared/effect-modifiers/schemas";
import { ENTITY_TYPE } from "@shared/entities/schemas";
import { emptyStore } from "@shared/protocol/store";
import { renderToStaticMarkup } from "react-dom/server";
import { createStore } from "zustand";
import { TooltipProvider } from "../../components/ui/overlays";
import { SyncContext, type SyncState } from "../../sync/store";
import { sectionsFor } from "../character-sheet/sections";
import { sheetSections } from "../character-sheet/sheet-sections";
import { modifiersText, modifierText } from "./describe";
import { draftOf, modifierOf, modifiersOf, newDraft } from "./editor-model";
import { ActiveEffectsSection } from "./section";

const bless = builtinPreset("bless")?.modifiers as Modifier[];
const rage = builtinPreset("rage")?.modifiers as Modifier[];

describe("FR-MOD-26 modifiers in words", () => {
  test("FR-MOD-26 Bless, Bane, Rage, abilities, initiative", () => {
    expect(modifiersText(bless)).toBe("+1d4 attack rolls, saving throws");
    expect(modifiersText(builtinPreset("bane")?.modifiers)).toBe(
      "−1d4 attack rolls, saving throws",
    );
    expect(modifiersText(rage)).toBe("+2 weapon damage");
    expect(
      modifierText({
        kind: "dice",
        on: { roll: "save", abilities: ["wis", "cha"] },
        dice: "2d6",
        sign: -1,
      }),
    ).toBe("−2d6 WIS, CHA saving throws");
    expect(modifierText({ kind: "flat", on: { roll: "initiative" }, value: 5 })).toBe(
      "+5 initiative",
    );
    expect(modifiersText([])).toBe("");
  });
});

describe("MOD §7 editor drafts", () => {
  test("FR-MOD-01 drafts round-trip; bad dice / 0 / out-of-range → invalid; minus subtracts", () => {
    for (const m of [...bless, ...rage]) expect(modifierOf(draftOf(m))).toEqual(m);
    const d = newDraft();
    expect(modifierOf({ ...d, dice: "−1d4" })).toEqual({
      kind: "dice",
      on: { roll: "attack" },
      dice: "1d4",
      sign: -1,
    });
    expect(modifierOf({ ...d, dice: "5d4" })).toBeNull();
    expect(modifierOf({ ...d, kind: "flat", value: "0" })).toBeNull();
    expect(modifierOf({ ...d, kind: "flat", value: "11" })).toBeNull();
    // Abilities only on saves / checks, via only on attacks / damage: dropped elsewhere.
    expect(modifierOf({ ...d, roll: "initiative", abilities: ["str"], via: "weapon" })).toEqual({
      kind: "dice",
      on: { roll: "initiative" },
      dice: "1d4",
      sign: 1,
    });
    expect(modifiersOf([], 1)).toBeNull();
    expect(modifiersOf([], 0)).toEqual([]);
    expect(modifiersOf(Array(7).fill(d), 0)).toBeNull();
  });
});

describe("FR-MOD-26 sheet section", () => {
  const base = { store: emptyStore(), creatureId: "mira", slot: "tab" as const };
  test("FR-MOD-26 mod.effects: tab 'Active effects', order 10, both clients, characters only", () => {
    for (const client of ["dm", "player"] as const) {
      const tabs = sectionsFor(sheetSections, { ...base, client, kind: "character" });
      expect(tabs.map((s) => [s.id, s.title, s.order])).toContainEqual([
        "mod.effects",
        "Active effects",
        10,
      ]);
    }
    const npc = sectionsFor(sheetSections, { ...base, client: "dm", kind: "monster" });
    expect(npc.map((s) => s.id)).not.toContain("mod.effects");
  });

  const fx = (id: string, o: object) => ({
    id,
    kind: "custom",
    condition: null,
    level: null,
    label: null,
    targetCombatantId: null,
    targetCharacterId: "mira",
    encounterId: null,
    endsRound: null,
    seq: 1,
    ...o,
  });
  function render(o: { role: "dm" | "player"; locked?: boolean; ragedOn?: boolean }) {
    const records = {
      [ENTITY_TYPE]: { mira: { id: "mira", kind: "character", name: "Mira", ownerPlayerId: "p1" } },
      [EFFECT_TYPE]: {
        c1: fx("c1", { kind: "concentration", label: "Bless", seq: 1 }),
        b1: fx("b1", { label: "Bless", modifiers: bless, presetKey: "bless", seq: 2 }),
        p1: fx("p1", { kind: "condition", condition: "prone", seq: 3 }),
        r1: fx("r1", { label: "Rage", modifiers: rage, seq: 4 }),
      },
      [EFFECT_PRESET_TYPE]: {
        rage: {
          id: "rage",
          seq: 1,
          characterId: "mira",
          ownerPlayerId: "p1",
          name: "Rage",
          modifiers: rage,
          activeEffectId: o.ragedOn ? "r1" : "gone",
        },
      },
      [CREATURE_SHEET_TYPE]: {
        s1: { id: "s1", entityId: "mira", ...defaultSheetData(), locked: o.locked ?? false },
      },
    };
    const you = { campaignId: "c1", role: o.role, playerId: o.role === "dm" ? null : "p1" };
    const sync = createStore<SyncState>()(
      () =>
        ({
          state: "live",
          store: { ...emptyStore(), you, records },
          notLiveSince: null,
          everLive: true,
          connection: { sendIntent: () => Promise.resolve({}) },
        }) as unknown as SyncState,
    );
    return renderToStaticMarkup(
      <SyncContext.Provider value={sync}>
        <TooltipProvider delayDuration={0} skipDelayDuration={0}>
          <ActiveEffectsSection creatureId="mira" client={o.role} />
        </TooltipProvider>
      </SyncContext.Provider>,
    );
  }
  const ids = (html: string, testId: string) =>
    [
      ...html.matchAll(new RegExp(`data-testid="${testId}"[^>]*?data-record-id="([^"]+)"`, "g")),
    ].map((m) => m[1]);

  test("FR-MOD-26 owner: every effect (concentration, condition, custom) with parts; toggle state; presets editable; End own concentration only", () => {
    const html = render({ role: "player", ragedOn: true });
    expect(html).toContain('data-testid="mod-section"');
    expect(ids(html, "mod-active")).toEqual(["c1", "p1", "b1", "r1"]);
    expect(html).toContain('data-value="concentration"');
    expect(html).toContain('data-value="prone"');
    expect(html).toContain("+1d4 attack rolls, saving throws");
    expect(html).toContain('data-testid="mod-toggle" data-record-id="rage" data-state="on"');
    expect(html).toContain('data-testid="mod-preset-new"');
    expect(html).toContain('data-testid="mod-preset-edit"');
    expect(html.match(/data-testid="mod-active-end"/g)).toHaveLength(1);
    expect(html).not.toContain('data-testid="mod-active-edit"');
  });

  test("FR-MOD-11/26 an ended toggle effect reads off; locked: presets read-only, toggles work", () => {
    const html = render({ role: "player", locked: true });
    expect(html).toContain('data-testid="mod-toggle" data-record-id="rage" data-state="off"');
    expect(html).not.toContain('data-testid="mod-preset-new"');
    expect(html).not.toContain('data-testid="mod-preset-edit"');
    expect(html).toContain("Locked by the DM");
  });

  test("FR-MOD-26 DM: Modifiers… on custom effects, End on every effect, presets on a locked sheet", () => {
    const html = render({ role: "dm", locked: true });
    expect(html.match(/data-testid="mod-active-edit"/g)).toHaveLength(2);
    expect(html.match(/data-testid="mod-active-end"/g)).toHaveLength(4);
    expect(html).toContain('data-testid="mod-preset-new"');
  });
});
