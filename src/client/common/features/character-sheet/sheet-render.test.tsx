// Sheet rendering (CHARX §13 unit, sprint 2): the three attack buttons per row and spell form
// (FR-CHARX-41), routing per button (FR-CHARX-43), Main without attacks (FR-CHARX-44), pinned
// header (FR-CHARX-48). Static server render over a fake sync store (no encounter, so combat's
// route never claims).
import { describe, expect, test } from "bun:test";
import {
  type CreatureSheetRecord,
  defaultSheetData,
  SpellRow,
} from "@shared/character-sheet/sheet";
import { CharacterStatBlock, type DefinitionRecord } from "@shared/entities/schemas";
import { emptyStore } from "@shared/protocol/store";
import { renderToStaticMarkup } from "react-dom/server";
import { createStore } from "zustand";
import { TooltipProvider } from "../../components/ui/overlays";
import { SyncContext, type SyncState } from "../../sync/store";
import { createWindowRegistry } from "../play-shell/registry";
import { ShellProvider } from "../play-shell/ShellContext";
import { ActionsTab } from "./ActionsTab";
import { MainTab } from "./MainTab";
import { rollRoutes } from "./roll-routes";
import type { RollRoute } from "./routing";
import { SheetView } from "./SheetView";
import type { SheetCtx } from "./sheet-context";
import { SheetContext } from "./sheet-context";
import { PIN_HYSTERESIS_PX, pinnedPart } from "./view-model";

/** The registry, writable for a test route placed first (first claim wins). */
const testRoutes = rollRoutes as RollRoute[];

const stats = CharacterStatBlock.parse({
  size: "medium",
  ac: 16,
  hpMax: 12,
  initBonus: 2,
  attacks: [
    { id: "a1", name: "Shortsword", toHit: 4, damage: "1d6+2", damageType: "piercing" },
    { id: "a2", name: "Light crossbow", toHit: 4, damage: "1d8+2", damageType: "piercing" },
  ],
  abilities: { str: 14, dex: 14, con: 12, int: 10, wis: 16, cha: 10 },
  spellcasting: { ability: "wis", slots: { "1": 2 } },
  level: 1,
  className: "Fighter",
});
const spells = [
  { id: "gb", name: "Guiding Bolt", level: 1, roll: "attack", damage: "4d6" },
  { id: "ray", name: "Ray", level: 1, roll: "attack" },
  { id: "sf", name: "Sacred Flame", level: 0, roll: "save", saveAbility: "dex", damage: "1d8" },
  { id: "cw", name: "Cure Wounds", level: 1, damage: "1d8+3", effect: "healing" },
  { id: "sh", name: "Shield", level: 1 },
].map((s) => SpellRow.parse(s));

type RenderOpts = {
  client?: "dm" | "player";
  npc?: boolean;
  legacy?: boolean;
  /** Replaces the attack rows (FR-CHARX-56). */
  attacks?: unknown[];
  editing?: boolean;
};

function ctxCreature(o: RenderOpts = {}): DefinitionRecord {
  const base = o.attacks ? CharacterStatBlock.parse({ ...stats, attacks: o.attacks }) : stats;
  const s = o.legacy ? { ...base, attacks: base.attacks.map(({ id: _, ...a }) => a) } : base;
  return {
    id: "mira",
    kind: o.npc ? "monster" : "character",
    name: "Mira",
    campaignId: "c1",
    ownerPlayerId: o.npc ? null : "p1",
    portraitAssetId: null,
    statBlock: s,
  } as unknown as DefinitionRecord;
}

function render(node: React.ReactNode, o: RenderOpts = {}) {
  const client = o.client ?? "player";
  const creature = ctxCreature(o);
  const sheet = { ...defaultSheetData(), spells };
  const ctx = {
    creature,
    stats: creature.statBlock,
    sheet,
    row: { id: "mira", entityId: "mira", campaignId: "c1", ownerPlayerId: "p1", ...sheet },
    client,
    npc: o.npc ?? false,
    readOnly: false,
    canEdit: o.editing ?? false,
    editing: o.editing ?? false,
    canCount: true,
    ownerName: "Player 1",
  } as unknown as SheetCtx;
  const you = { campaignId: "c1", role: client, playerId: client === "dm" ? null : "p1" };
  const sync = createStore<SyncState>()(
    () =>
      ({
        state: "live",
        store: { ...emptyStore(), you },
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

/** Buttons of one row, in DOM order: [test ID, label]. */
function buttonsOf(html: string, rowTestId: string, rowId: string): [string, string][] {
  const start = html.indexOf(`data-testid="${rowTestId}" data-record-id="${rowId}"`);
  expect(start).toBeGreaterThan(-1);
  const rest = html.slice(start + 1);
  const next = rest.search(/data-testid="charx-(attack|spell)"/);
  const row = html.slice(start, next === -1 ? undefined : start + 1 + next);
  return [
    ...row.matchAll(/<button[^>]*data-testid="(charx-roll-[a-z-]+)"[^>]*>(.*?)<\/button>/g),
  ].map((m): [string, string] => [m[1] as string, (m[2] as string).replace(/<[^>]+>/g, "").trim()]);
}

const ATTACK_ROW: [string, string][] = [
  ["charx-roll-attack", "Attack"],
  ["charx-roll-damage", "Damage"],
  ["charx-roll-attack-damage", "Attack + damage"],
];

describe("FR-CHARX-41 three attack buttons", () => {
  test("FR-CHARX-41 every attack row: Attack · Damage · Attack + damage, in order, with the row id", () => {
    for (const client of ["player", "dm"] as const) {
      const html = render(<ActionsTab />, { client });
      expect(buttonsOf(html, "charx-attack", "a1")).toEqual(ATTACK_ROW);
      expect(buttonsOf(html, "charx-attack", "a2")).toEqual(ATTACK_ROW);
      expect(html).toContain('data-testid="charx-roll-attack-damage" data-record-id="a2"');
    }
  });

  test("FR-CHARX-41 spell forms: attack + damage all three; attack only Attack; save / healing Damage / Healing only", () => {
    const html = render(<ActionsTab />);
    expect(buttonsOf(html, "charx-spell", "gb")).toEqual([
      ["charx-roll-spell-attack", "Attack"],
      ["charx-roll-spell-damage", "Damage"],
      ["charx-roll-spell-attack-damage", "Attack + damage"],
    ]);
    expect(buttonsOf(html, "charx-spell", "ray")).toEqual([["charx-roll-spell-attack", "Attack"]]);
    expect(buttonsOf(html, "charx-spell", "sf")).toEqual([["charx-roll-spell-damage", "Damage"]]);
    expect(buttonsOf(html, "charx-spell", "cw")).toEqual([["charx-roll-spell-damage", "Healing"]]);
    expect(buttonsOf(html, "charx-spell", "sh")).toEqual([]);
  });

  test("FR-CHARX-41 NPC sheet: the same buttons, no public switch; DM PC sheet has the switches", () => {
    const npc = render(<ActionsTab />, { client: "dm", npc: true });
    expect(buttonsOf(npc, "charx-attack", "a2")).toEqual(ATTACK_ROW);
    expect(npc).not.toContain("charx-public-attack");
    expect(npc).not.toContain("charx-public-damage");
    const dm = render(<ActionsTab />, { client: "dm" });
    expect(dm).toContain('data-testid="charx-public-attack"');
    expect(dm).toContain('data-testid="charx-public-damage"');
    expect(render(<ActionsTab />)).not.toContain("charx-public-attack");
  });
});

describe("FR-CHARX-43 routing per button", () => {
  test("FR-CHARX-43 each button asks the routes with its own kind + ref; hidden drops that button only", () => {
    const asked: [string, unknown][] = [];
    testRoutes.unshift({
      name: "test",
      claim(_store, _id, kind, ref) {
        asked.push([kind, ref]);
        return kind === "toHit" && ref?.attackId === "a2"
          ? { badge: "Test", hidden: true, send: () => Promise.resolve() }
          : null;
      },
    });
    try {
      const html = render(<ActionsTab />);
      expect(buttonsOf(html, "charx-attack", "a2")).toEqual(ATTACK_ROW.slice(1));
      expect(buttonsOf(html, "charx-attack", "a1")).toEqual(ATTACK_ROW);
      for (const kind of ["toHit", "damage", "attack"]) {
        expect(asked).toContainEqual([kind, { attackId: "a2" }]);
      }
      for (const kind of ["spellToHit", "spellDamage", "spellAttack"]) {
        expect(asked).toContainEqual([kind, { spellId: "gb" }]);
      }
    } finally {
      testRoutes.shift();
    }
  });
});

describe("FR-CHARX-44 attacks on the Actions tab only", () => {
  test("FR-CHARX-44 Main has no attack row (retired IDs gone); Initiative stays", () => {
    for (const client of ["player", "dm"] as const) {
      const html = render(<MainTab />, { client });
      for (const id of [
        "char-sheet-attack",
        "char-sheet-roll-attack",
        "char-sheet-public-attack",
      ]) {
        expect(html).not.toContain(`data-testid="${id}"`);
      }
      expect(html).not.toContain("Shortsword");
      expect(html).toContain('data-testid="char-sheet-roll-init"');
    }
  });

  test("FR-CHARX-44 Actions lists every attack, legacy rows (no id) included", () => {
    const html = render(<ActionsTab />, { legacy: true });
    expect(html.match(/data-testid="charx-attack"/g)).toHaveLength(2);
    expect(html.match(/data-testid="charx-roll-attack-damage"/g)).toHaveLength(2);
    expect(html).toContain("Light crossbow");
  });
});

describe("FR-CHARX-48 pinned header", () => {
  test("FR-CHARX-48 full header while it takes at most half the body; else compact; hysteresis back", () => {
    expect(pinnedPart(120, 400, "full")).toBe("full");
    expect(pinnedPart(200, 400, "full")).toBe("full");
    expect(pinnedPart(201, 400, "full")).toBe("compact");
    // Back to full only once it fits with PIN_HYSTERESIS_PX to spare (no scrollbar flip-flop).
    expect(pinnedPart(200, 400, "compact")).toBe("compact");
    expect(pinnedPart(192, 400, "compact")).toBe("full");
    expect(pinnedPart(180, 0, "compact")).toBe("compact"); // not measured yet
    expect(PIN_HYSTERESIS_PX).toBe(16);
  });

  function sheetHtml(part: "full" | "compact") {
    // The shell's title marker takes `document` at render; a stub is enough for a static render.
    const g = globalThis as { document?: unknown };
    g.document = { title: "", hidden: false };
    const row = {
      id: "mira",
      entityId: "mira",
      campaignId: "c1",
      ownerPlayerId: "p1",
      ...defaultSheetData(),
      status: "draft",
    } as unknown as CreatureSheetRecord;
    try {
      return render(
        <ShellProvider registry={createWindowRegistry("player", [])}>
          <SheetView
            creature={ctxCreature()}
            row={row}
            client="player"
            playerId="p1"
            ownerName="Player 1"
            picker={<select data-testid="char-sheet-picker" />}
            startEditing={false}
            initialPinnedPart={part}
          />
        </ShellProvider>,
      );
    } finally {
      delete g.document;
    }
  }
  /** Where each test ID sits: in the pinned part, or in the scrolling content. */
  function placeOf(html: string, ids: string[]) {
    const header = html.indexOf('data-testid="charx-header"');
    const content = html.indexOf('data-testid="charx-content"');
    expect(header).toBeGreaterThan(-1);
    expect(content).toBeGreaterThan(header);
    return ids.map((id) => {
      const at = html.indexOf(`data-testid="${id}"`);
      expect(at).toBeGreaterThan(header);
      return at < content ? "pinned" : "scrolls";
    });
  }
  const IDS = [
    "char-sheet-name",
    "charx-tab",
    "charx-draft",
    "charx-edit-toggle",
    "char-sheet-picker",
    "char-sheet-roll-init",
  ];

  test("FR-CHARX-48 full: name row, badges, buttons, picker and tab strip pinned; tab content scrolls", () => {
    const html = sheetHtml("full");
    expect(html).toContain('data-testid="charx-header" data-pinned="true" data-pinned-part="full"');
    expect(html).not.toContain('data-testid="charx-header-rest"');
    expect(placeOf(html, IDS)).toEqual([
      "pinned",
      "pinned",
      "pinned",
      "pinned",
      "pinned",
      "scrolls",
    ]);
  });

  test("FR-CHARX-48 compact fallback: only name row + tab strip pinned; badges, buttons, picker scroll", () => {
    const html = sheetHtml("compact");
    expect(html).toContain(
      'data-testid="charx-header" data-pinned="true" data-pinned-part="compact"',
    );
    expect(placeOf(html, IDS)).toEqual([
      "pinned",
      "pinned",
      "scrolls",
      "scrolls",
      "scrolls",
      "scrolls",
    ]);
    // The header rest comes first in the content, before the tab content.
    expect(html.indexOf('data-testid="charx-header-rest"')).toBeLessThan(
      html.indexOf('data-testid="char-sheet-roll-init"'),
    );
    expect(html.match(/data-testid="char-sheet-picker"/g)).toHaveLength(1);
  });
});

describe("FR-CHARX-56 weapon row UI", () => {
  const flame = {
    id: "ft",
    name: "Flame Tongue greatsword",
    toHit: 7,
    damage: "2d6+4",
    damageType: "slashing",
    bonus: 1,
    extraDamage: [{ damage: "2d6", type: "fire" }],
  };
  const two = {
    id: "two",
    name: "Frost Brand",
    toHit: 5,
    damage: "1d8+3",
    extraDamage: [
      { damage: "1d6", type: "cold" },
      { damage: "1d4", type: "necrotic" },
    ],
  };
  const plain = { id: "a1", name: "Shortsword", toHit: 4, damage: "1d6+2", damageType: "piercing" };
  const text = (html: string) => html.replace(/<[^>]+>/g, "");
  const addButton = (row: string) =>
    row.match(/<button[^>]*data-testid="charx-attack-extra-add"[^>]*>/)?.[0] ?? "missing";
  const rowHtml = (html: string, id: string) => {
    const start = html.indexOf(`data-testid="charx-attack" data-record-id="${id}"`);
    expect(start).toBeGreaterThan(-1);
    const next = html.indexOf('data-testid="charx-attack" ', start + 1);
    return html.slice(start, next === -1 ? undefined : next);
  };

  test('FR-CHARX-56 weapon row UI: view "+8 · 2d6+5 slashing + 2d6 fire" with a "+1" Badge; plain rows unchanged', () => {
    for (const o of [{ client: "player" as const }, { client: "dm" as const, npc: true }]) {
      const html = render(<ActionsTab />, { ...o, attacks: [plain, flame] });
      const row = rowHtml(html, "ft");
      expect(row).toContain('data-testid="charx-attack-bonus" data-value="1"');
      expect(text(row)).toContain("Flame Tongue greatsword +1+8 · 2d6+5 slashing + 2d6 fire");
      // The second line wraps between parts only.
      expect(row.match(/class="whitespace-nowrap"/g)).toHaveLength(2);
      expect(buttonsOf(html, "charx-attack", "ft")).toEqual(ATTACK_ROW);
      const sword = rowHtml(html, "a1");
      expect(sword).not.toContain("charx-attack-bonus");
      expect(text(sword)).toContain("Shortsword +4 · 1d6+2 piercing");
    }
  });

  test("FR-CHARX-56 weapon row UI: edit Magic Select, extra part rows, Add damage type disabled at two", () => {
    for (const npc of [false, true]) {
      const html = render(<ActionsTab />, {
        client: "dm",
        npc,
        editing: true,
        attacks: [flame, two, plain],
      });
      const ft = rowHtml(html, "ft");
      expect(ft).toMatch(/<select data-testid="charx-attack-bonus" data-value="1"/);
      expect(ft).toContain("Magic +3");
      expect(ft.match(/data-testid="charx-attack-extra" data-value="\d"/g)).toEqual([
        'data-testid="charx-attack-extra" data-value="0"',
      ]);
      expect(ft).toContain('data-value="attacks.ft.extraDamage.0.damage"');
      expect(ft).toMatch(/data-testid="charx-attack-extra-type" data-value="0"/);
      expect(ft).toContain('data-testid="charx-attack-extra-delete" data-value="0"');
      expect(addButton(ft)).not.toContain('disabled=""');
      const full = rowHtml(html, "two");
      expect(full.match(/data-testid="charx-attack-extra" /g)).toHaveLength(2);
      expect(full).toMatch(/data-testid="charx-attack-bonus" data-value="0"/);
      expect(addButton(full)).toContain('disabled=""');
      expect(rowHtml(html, "a1")).not.toContain('data-testid="charx-attack-extra" ');
    }
  });
});
