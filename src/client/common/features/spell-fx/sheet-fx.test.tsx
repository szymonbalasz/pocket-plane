// spell-fx on the sheet and effect menus (VFX §13 Unit / client): the Map effect picker and its
// pre-pick (FR-VFX-04, -05), Cast / End through the spell-row actions registry (FR-VFX-06), the
// Map effect… permission (FR-VFX-09, -10), the Preferences section (FR-VFX-25, -27). Static
// server renders over a fake sync store.
import { describe, expect, test } from "bun:test";
import {
  type CreatureSheetRecord,
  defaultSheetData,
  SpellRow,
} from "@shared/character-sheet/sheet";
import { EFFECT_TYPE, type EffectView } from "@shared/combat-extras/schemas";
import { COMBATANT_TYPE } from "@shared/combat-tracker/schemas";
import { CharacterStatBlock, type DefinitionRecord, ENTITY_TYPE } from "@shared/entities/schemas";
import { applySnapshot, type RecordStore } from "@shared/protocol/store";
import { renderToStaticMarkup } from "react-dom/server";
import { createStore } from "zustand";
import { TooltipProvider } from "../../components/ui/overlays";
import { SyncContext, type SyncState } from "../../sync/store";
import { ActionsTab } from "../character-sheet/ActionsTab";
import type { SheetCtx } from "../character-sheet/sheet-context";
import { SheetContext } from "../character-sheet/sheet-context";
import { spellRowActions } from "../character-sheet/spell-row-actions";
import { PreferencesWindow } from "../play-shell/PreferencesWindow";
import { castEffectOf, vfxCastAction } from "./CastAction";
import { mayEditFx } from "./EffectFx";
import { FxFields, suggestedFx } from "./FxPicker";
import { vfxPrefSection } from "./PrefsSection";

const stats = CharacterStatBlock.parse({
  size: "medium",
  ac: 14,
  hpMax: 20,
  initBonus: 1,
  attacks: [],
  abilities: { str: 10, dex: 12, con: 12, int: 10, wis: 16, cha: 10 },
  spellcasting: { ability: "wis", slots: { "3": 2 } },
  level: 5,
  className: "Cleric",
});
const spells = [
  {
    id: "sg",
    name: "Spirit Guardians",
    level: 3,
    concentration: true,
    fx: { preset: "spirit-guardians", params: { variant: "radiant", radiusFt: 15 } },
  },
  { id: "gb", name: "Guiding Bolt", level: 1, roll: "attack", damage: "4d6" },
].map((s) => SpellRow.parse(s));

const MIRA = {
  id: "mira",
  kind: "character",
  name: "Mira",
  campaignId: "c1",
  ownerPlayerId: "p1",
  portraitAssetId: null,
  statBlock: stats,
} as unknown as DefinitionRecord;

const concentration = (over: Partial<EffectView> = {}) =>
  ({
    id: "eff-sg",
    campaignId: "c1",
    seq: 1,
    kind: "concentration",
    label: "Spirit Guardians",
    condition: null,
    level: null,
    targetCombatantId: null,
    targetCharacterId: "mira",
    durationRounds: null,
    endsRound: null,
    endedAt: null,
    fx: { preset: "spirit-guardians", params: { variant: "radiant", radiusFt: 15 }, spellId: "sg" },
    ...over,
  }) as unknown as EffectView;

function storeOf(role: "dm" | "player", effects: unknown[] = [], extra = {}): RecordStore {
  return applySnapshot({
    type: "snapshot",
    seq: 0,
    you: { campaignId: "c1", role, playerId: role === "dm" ? null : "p1" },
    records: { [EFFECT_TYPE]: effects, [ENTITY_TYPE]: [MIRA], ...extra },
  } as never);
}

function render(
  node: React.ReactNode,
  o: { store?: RecordStore; editing?: boolean; canCount?: boolean; live?: boolean } = {},
) {
  const store = o.store ?? storeOf("player");
  const client = store.you?.role === "dm" ? "dm" : "player";
  const sheet = { ...defaultSheetData(), spells };
  const ctx = {
    creature: MIRA,
    stats,
    sheet,
    row: {
      id: "mira",
      entityId: "mira",
      campaignId: "c1",
      ownerPlayerId: "p1",
      ...sheet,
    } as unknown as CreatureSheetRecord,
    client,
    npc: false,
    readOnly: false,
    canEdit: o.editing ?? false,
    editing: o.editing ?? false,
    canCount: o.canCount ?? true,
    ownerName: "Player 1",
  } as unknown as SheetCtx;
  const sync = createStore<SyncState>()(
    () =>
      ({
        state: o.live === false ? "reconnecting" : "live",
        store,
        notLiveSince: null,
        everLive: true,
        connection: { sendIntent: () => Promise.resolve({}) },
      }) as unknown as SyncState,
  );
  return renderToStaticMarkup(
    <SyncContext.Provider value={sync}>
      <TooltipProvider delayDuration={0} skipDelayDuration={0}>
        <SheetContext.Provider value={ctx}>{node}</SheetContext.Provider>
      </TooltipProvider>
    </SyncContext.Provider>,
  );
}

const tags = (html: string, testId: string) =>
  [...html.matchAll(new RegExp(`<[a-z]+[^>]*data-testid="${testId}"[^>]*>`, "g"))].map((m) => m[0]);
const attr = (tag: string | undefined, name: string) =>
  tag ? new RegExp(`${name}="([^"]*)"`).exec(tag)?.[1] : undefined;

describe("sheet (FR-VFX-04–06)", () => {
  test("FR-VFX-06 Cast after the roll buttons on a row with fx only; End while its effect is active", () => {
    expect(spellRowActions).toContain(vfxCastAction);
    const html = render(<ActionsTab />);
    const cast = tags(html, "vfx-cast");
    expect(cast).toHaveLength(1);
    expect(attr(cast[0], "data-record-id")).toBe("sg");
    expect(attr(cast[0], "data-state")).toBe("cast");
    expect(html).toMatch(/data-testid="vfx-cast"[^>]*>.*Cast<\/button>/);
    // In Spirit Guardians' row (3rd level, after Guiding Bolt's).
    expect(html.indexOf('data-testid="vfx-cast"')).toBeGreaterThan(
      html.indexOf('data-testid="charx-spell" data-record-id="sg"'),
    );
    const active = render(<ActionsTab />, { store: storeOf("player", [concentration()]) });
    const end = tags(active, "vfx-cast");
    expect(attr(end[0], "data-state")).toBe("end");
    expect(active).toMatch(/data-testid="vfx-cast"[^>]*>.*End<\/button>/);
    // CBTX's Concentrating chip beside it.
    expect(active).toContain("vfx-cast-chip");
  });

  test("FR-VFX-06 OQ-VFX-01 A: no Cast for a viewer who may not act on the sheet; disabled while not live", () => {
    expect(tags(render(<ActionsTab />, { canCount: false }), "vfx-cast")).toEqual([]);
    const off = tags(render(<ActionsTab />, { live: false }), "vfx-cast");
    expect(off[0]).toContain("disabled");
  });

  test("FR-VFX-06 the cast effect: the creature's active effect with fx.spellId = the row (character or monster combatant)", () => {
    expect(castEffectOf(storeOf("dm", [concentration()]), "mira", "sg")?.id).toBe("eff-sg");
    expect(
      castEffectOf(storeOf("dm", [concentration({ endedAt: "x" } as never)]), "mira", "sg"),
    ).toBeNull();
    expect(castEffectOf(storeOf("dm", [concentration()]), "mira", "gb")).toBeNull();
    const onMonster = concentration({ targetCharacterId: null, targetCombatantId: "cb1" } as never);
    const s = storeOf("dm", [onMonster], {
      [COMBATANT_TYPE]: [{ id: "cb1", entityId: "cultist", kind: "monster", tokenId: null }],
    });
    expect(castEffectOf(s, "cultist", "sg")?.id).toBe("eff-sg");
    expect(castEffectOf(s, "mira", "sg")).toBeNull();
  });

  test("FR-VFX-05 the row editor shows Map effect: None + every preset, then its params", () => {
    const html = render(<ActionsTab />, { editing: true });
    const picks = tags(html, "vfx-row-fx");
    expect(picks.map((t) => attr(t, "data-record-id"))).toEqual(["gb", "sg"]);
    expect(attr(picks[0], "data-value")).toBe("none");
    expect(attr(picks[1], "data-value")).toBe("spirit-guardians");
    expect(html).toContain(">Map effect: none</option>");
    expect(html).toContain(">Spirit Guardians</option>");
    expect(html).toContain(">Shadow of Moil</option>");
    expect(tags(html, "vfx-row-fx-variant")).toHaveLength(1);
    expect(tags(html, "vfx-row-fx-radius")).toHaveLength(1);
    // No Cast while editing.
    expect(tags(html, "vfx-cast")).toEqual([]);
    const moil = render(
      <FxFields
        recordId="x"
        value={{ preset: "shadow-of-moil", params: { radiusFt: 10 } }}
        onChange={() => {}}
      />,
    );
    expect(tags(moil, "vfx-row-fx-variant")).toEqual([]);
    expect(moil).toContain('<option value="30">30 ft</option>');
    expect(moil).not.toContain('<option value="35">');
  });

  test("FR-VFX-04 / -05 pre-pick on a name change: the suggested preset with its defaults, else none", () => {
    expect(suggestedFx("  Spirit Guardians ")).toEqual({
      preset: "spirit-guardians",
      params: { variant: "radiant", radiusFt: 15 },
    });
    expect(suggestedFx("Shadow of Moil")).toEqual({
      preset: "shadow-of-moil",
      params: { radiusFt: 10 },
    });
    expect(suggestedFx("New spell")).toBeNull();
  });
});

describe("effect menus (FR-VFX-09, -10)", () => {
  test("FR-VFX-10 Map effect… for the DM on any effect, the owner on their character's, nobody else", () => {
    const own = concentration();
    const thorns = concentration({ id: "e2", targetCharacterId: "thorn" } as never);
    const monster = concentration({
      id: "e3",
      targetCharacterId: null,
      targetCombatantId: "cb1",
    } as never);
    expect(mayEditFx(storeOf("dm"), monster)).toBe(true);
    expect(mayEditFx(storeOf("player"), own)).toBe(true);
    expect(mayEditFx(storeOf("player"), thorns)).toBe(false);
    expect(mayEditFx(storeOf("player"), monster)).toBe(false);
  });
});

describe("Preferences (FR-VFX-25, -27)", () => {
  test("FR-VFX-25 section vfx.level 'Map effects', order 35: Full · Reduced · Still · Off, the pick on", () => {
    expect(vfxPrefSection).toMatchObject({ id: "vfx.level", title: "Map effects", order: 35 });
    const html = render(<PreferencesWindow sections={[vfxPrefSection]} />);
    expect(html).toContain(">Map effects</h3>");
    const items = ["full", "reduced", "still", "off"].map(
      (l) => tags(html, `vfx-pref-level-${l}`)[0],
    );
    expect(items.every(Boolean)).toBe(true);
    expect(attr(items[0], "data-state")).toBe("on");
    expect(tags(html, "vfx-pref-lowered")).toEqual([]);
  });
});
