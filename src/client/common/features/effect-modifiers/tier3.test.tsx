// MOD tier 3 client (FR-MOD-12, -26): the Toggles block shows uses left "2 / 3" after the name,
// "Uses link broken" for a deleted row or cleared uses, and the DM's "Force on" at 0 uses (static
// render over a fake store); `presetUses` is the shared derivation both sides read.
import { describe, expect, test } from "bun:test";
import { CREATURE_SHEET_TYPE, defaultSheetData } from "@shared/character-sheet/sheet";
import { builtinPreset } from "@shared/effect-modifiers/presets";
import { presetUses } from "@shared/effect-modifiers/rules";
import { EFFECT_PRESET_TYPE } from "@shared/effect-modifiers/schemas";
import { ENTITY_TYPE } from "@shared/entities/schemas";
import { emptyStore } from "@shared/protocol/store";
import { renderToStaticMarkup } from "react-dom/server";
import { createStore } from "zustand";
import { TooltipProvider } from "../../components/ui/overlays";
import { SyncContext, type SyncState } from "../../sync/store";
import { ActiveEffectsSection } from "./section";

const rage = builtinPreset("rage")?.modifiers;
const RAGE_ROW = { id: "f-rage", name: "Rage", source: "", text: "", usesMax: 3, reset: "long" };

function render(o: { role: "dm" | "player"; used?: number; link?: string; noUses?: boolean }) {
  const row = { ...RAGE_ROW, used: o.used ?? 0, ...(o.noUses ? { usesMax: undefined } : {}) };
  const records = {
    [ENTITY_TYPE]: {
      brakka: { id: "brakka", kind: "character", name: "Brakka", ownerPlayerId: "p1" },
    },
    [EFFECT_PRESET_TYPE]: {
      rage: {
        id: "rage",
        seq: 1,
        characterId: "brakka",
        ownerPlayerId: "p1",
        name: "Rage",
        modifiers: rage,
        activeEffectId: null,
        usesFeatureId: o.link ?? "f-rage",
        originKey: "rage",
      },
    },
    [CREATURE_SHEET_TYPE]: {
      s1: { id: "s1", entityId: "brakka", ...defaultSheetData(), features: [row] },
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
        <ActiveEffectsSection creatureId="brakka" client={o.role} />
      </TooltipProvider>
    </SyncContext.Provider>,
  );
}

describe("FR-MOD-12 uses left", () => {
  test("FR-MOD-12 presetUses: no link → null; ok → left of max; deleted row / no usesMax → broken", () => {
    const f = [{ ...RAGE_ROW, used: 1 }];
    expect(presetUses({ usesFeatureId: null }, f)).toBeNull();
    expect(presetUses({ usesFeatureId: "f-rage" }, f)).toEqual({
      state: "ok",
      featureId: "f-rage",
      name: "Rage",
      left: 2,
      max: 3,
    });
    expect(presetUses({ usesFeatureId: "gone" }, f)).toEqual({ state: "broken" });
    expect(
      presetUses({ usesFeatureId: "f-rage" }, [{ ...RAGE_ROW, usesMax: undefined, used: 0 }]),
    ).toEqual({ state: "broken" });
    expect(presetUses({ usesFeatureId: "f-rage" }, undefined)).toEqual({ state: "broken" });
  });

  test("FR-MOD-26 Toggles: 'Rage 3 / 3' → '2 / 3' after a spend; no Force for the owner", () => {
    expect(render({ role: "player" })).toContain(
      'data-testid="mod-toggle-uses" data-record-id="rage" data-state="ok" data-value="3/3"',
    );
    const html = render({ role: "player", used: 1 });
    expect(html).toContain('data-value="2/3"');
    expect(html).toContain("2 / 3");
    expect(render({ role: "player", used: 3 })).not.toContain('data-testid="mod-toggle-force"');
  });

  test("FR-MOD-12 DM at 0 uses: 'Force on'; not while uses are left", () => {
    expect(render({ role: "dm", used: 3 })).toContain(
      'data-testid="mod-toggle-force" data-record-id="rage"',
    );
    expect(render({ role: "dm", used: 2 })).not.toContain('data-testid="mod-toggle-force"');
  });

  test("FR-MOD-12 'Uses link broken': row deleted or usesMax cleared; no count, no Force", () => {
    for (const html of [
      render({ role: "dm", link: "gone" }),
      render({ role: "player", noUses: true }),
    ]) {
      expect(html).toContain(
        'data-testid="mod-toggle-uses" data-record-id="rage" data-state="broken"',
      );
      expect(html).toContain("Uses link broken");
      expect(html).not.toContain('data-testid="mod-toggle-force"');
    }
  });
});
