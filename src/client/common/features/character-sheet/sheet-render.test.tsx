// Sheet rendering (CHARX §13 unit, sprint 2): the attack buttons per row and spell form
// (FR-CHARX-41; sprint 15 two buttons, FR-CHARX-126), routing per button (FR-CHARX-43), Main
// without attacks (FR-CHARX-44), pinned header (FR-CHARX-48); sprint 15: a click stages the
// Dice tray, Alt+click rolls (FR-CHARX-127), staging offline (FR-CHARX-132). Static server render over a fake sync store (no encounter, so combat's
// route never claims).
import { afterEach, describe, expect, test } from "bun:test";
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
import { diceExtras, type TrayRequest } from "../dice-extras/store";
import { TrayWindow } from "../dice-extras/TrayWindow";
import {
  ROLL_NOW_HINT,
  type RollControl,
  rollButtonTip,
  STAGE_HINT,
} from "../dice-roll-log/roll-control";
import { createWindowRegistry } from "../play-shell/registry";
import { ShellProvider } from "../play-shell/ShellContext";
import { ActionsTab } from "./ActionsTab";
import { MainTab } from "./MainTab";
import { PublicRolls, PublicRollsMenu } from "./PublicMenu";
import { rollRoutes } from "./roll-routes";
import { useSheetRollControl } from "./rolls";
import type { RollRoute, SheetRollRef } from "./routing";
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
  /** Intents the sheet sends (name, payload). */
  sent?: [string, unknown][];
  /** Sync state; default live. */
  state?: "live" | "reconnecting";
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
        state: o.state ?? "live",
        store: { ...emptyStore(), you },
        notLiveSince: null,
        everLive: true,
        connection: {
          sendIntent: (name: string, payload: unknown) => {
            o.sent?.push([name, payload]);
            return Promise.resolve({});
          },
        },
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
];

describe("FR-CHARX-126 two attack buttons", () => {
  test("FR-CHARX-126 two attack buttons: every attack row Attack · Damage, in order, with the row id; no *-attack-damage ID", () => {
    for (const client of ["player", "dm"] as const) {
      const html = render(<ActionsTab />, { client });
      expect(buttonsOf(html, "charx-attack", "a1")).toEqual(ATTACK_ROW);
      expect(buttonsOf(html, "charx-attack", "a2")).toEqual(ATTACK_ROW);
      expect(html).toContain('data-testid="charx-roll-damage" data-record-id="a2"');
      expect(html).not.toContain("attack-damage");
      expect(html).not.toContain("Attack + damage");
    }
  });

  test("FR-CHARX-126 two attack buttons, spell forms: attack + damage Attack, Damage; attack only Attack; save / healing Damage / Healing only", () => {
    const html = render(<ActionsTab />);
    expect(buttonsOf(html, "charx-spell", "gb")).toEqual([
      ["charx-roll-spell-attack", "Attack"],
      ["charx-roll-spell-damage", "Damage"],
    ]);
    expect(buttonsOf(html, "charx-spell", "ray")).toEqual([["charx-roll-spell-attack", "Attack"]]);
    expect(buttonsOf(html, "charx-spell", "sf")).toEqual([["charx-roll-spell-damage", "Damage"]]);
    expect(buttonsOf(html, "charx-spell", "cw")).toEqual([["charx-roll-spell-damage", "Healing"]]);
    expect(buttonsOf(html, "charx-spell", "sh")).toEqual([]);
    expect(html).not.toContain("charx-roll-spell-attack-damage");
  });

  test("FR-CHARX-126 NPC sheet: the same two buttons, no public switch; DM PC sheet has the switches (BL-139: in the header's Public rolls menu)", () => {
    const npc = render(<ActionsTab />, { client: "dm", npc: true });
    expect(buttonsOf(npc, "charx-attack", "a2")).toEqual(ATTACK_ROW);
    expect(npc).not.toContain("charx-public-attack");
    expect(npc).not.toContain("charx-public-damage");
    expect(render(<PublicRollsMenu />, { client: "dm", npc: true })).toBe("");
    // BL-139: the tab's Attacks box has no switch; the menu has both.
    const dm = render(<ActionsTab />, { client: "dm" });
    expect(dm).not.toContain("charx-public-attack");
    const menu = render(<PublicRolls />, { client: "dm" });
    expect(menu).toContain('data-testid="charx-public-attack"');
    expect(menu).toContain('data-testid="charx-public-damage"');
    expect(render(<ActionsTab />)).not.toContain("charx-public-attack");
    expect(render(<PublicRollsMenu />)).toBe("");
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
      for (const kind of ["toHit", "damage"]) {
        expect(asked).toContainEqual([kind, { attackId: "a2" }]);
      }
      for (const kind of ["spellToHit", "spellDamage"]) {
        expect(asked).toContainEqual([kind, { spellId: "gb" }]);
      }
      // FR-CHARX-126: Attack + damage is never asked for.
      expect(asked.map(([k]) => k)).not.toContain("attack");
      expect(asked.map(([k]) => k)).not.toContain("spellAttack");
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
    expect(html.match(/data-testid="charx-roll-damage"/g)).toHaveLength(2);
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
            picker={<button type="button" data-testid="char-sheet-picker" />}
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

  test("FR-CHARX-48 compact fallback: only name row (K11: with the picker and the small buttons) + tab strip pinned; the badges scroll", () => {
    const html = sheetHtml("compact");
    expect(html).toContain(
      'data-testid="charx-header" data-pinned="true" data-pinned-part="compact"',
    );
    expect(placeOf(html, IDS)).toEqual([
      "pinned",
      "pinned",
      "scrolls",
      "pinned",
      "pinned",
      "scrolls",
    ]);
    // The header rest comes first in the content, before the tab content.
    expect(html.indexOf('data-testid="charx-header-rest"')).toBeLessThan(
      html.indexOf('data-testid="char-sheet-roll-init"'),
    );
    expect(html.match(/data-testid="char-sheet-picker"/g)).toHaveLength(1);
  });

  /** The opening tag of the first element with this test id. */
  const tagOf = (html: string, id: string) => {
    const at = html.indexOf(`data-testid="${id}"`);
    return html.slice(html.lastIndexOf("<", at), html.indexOf(">", at) + 1);
  };

  test("FR-KIT-85 sheet header: square framed portrait (initial; K11: the kit's 64 px, 84 px wide); the name is the picker (select over the name + chevron); level line; chips line; Edit top-right; no header-line row", () => {
    const html = sheetHtml("full");
    const portrait = tagOf(html, "char-sheet-portrait");
    expect(portrait).toContain('data-slot="sheet-portrait"');
    expect(portrait).toContain("size-16 @min-[560px]/sheet:size-[84px]");
    expect(portrait).toContain("rounded-md border");
    expect(portrait).not.toContain("rounded-full");
    expect(html).toMatch(/data-testid="char-sheet-portrait"[^>]*><div[^>]*>M<\/div>/);
    // The initial in name type size on the owner's colour (a theme deepens `--portrait`).
    const initial = html.slice(html.indexOf('data-slot="sheet-portrait-initial"'));
    expect(initial).toStartWith('data-slot="sheet-portrait-initial" data-colour="none"');
    expect(initial).toContain("text-[30px] @min-[560px]/sheet:text-[40px]");
    // The name is the picker: name, chevron, then the Select's trigger laid over them (transparent).
    const picker = html.slice(html.indexOf('data-testid="charx-name-picker"'));
    const order = ["char-sheet-name", "lucide-chevron-down", "char-sheet-picker"].map((x) =>
      picker.indexOf(x),
    );
    expect(order.every((i) => i > 0)).toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b));
    // BL-139: the shared Select's trigger (a button), no native select.
    expect(picker).toContain("[&amp;&gt;button]:opacity-0");
    expect(tagOf(html, "char-sheet-name")).toContain('data-slot="sheet-name"');
    // K11 walkthrough: whole words, balanced lines; the chevron follows the last word.
    expect(html).toMatch(
      /data-testid="char-sheet-name"[^>]*><span class="line-clamp-2 min-w-0 break-normal text-balance">Mira<svg[^>]*lucide-chevron-down/,
    );
    // K11: the kit's name type size (21 px, 32 px wide).
    expect(tagOf(html, "char-sheet-name")).toContain("text-[21px] font-bold");
    expect(tagOf(html, "char-sheet-name")).toContain("@min-[560px]/sheet:text-[32px]");
    // Level line, chips line (badges), Edit on the same top row; the old row is gone.
    const at = (id: string) => html.indexOf(`data-testid="${id}"`);
    expect(at("char-sheet-level")).toBeGreaterThan(at("char-sheet-name"));
    // K11: the actions top-right of the name column (K13: floated, so first in it), then the
    // chips line (under the row when narrow, under the name when wide); badges as kit chips.
    expect(at("charx-edit-toggle")).toBeLessThan(at("char-sheet-name"));
    expect(at("charx-header-chips")).toBeGreaterThan(at("char-sheet-level"));
    expect(at("charx-draft")).toBeGreaterThan(at("charx-header-chips"));
    expect(tagOf(html, "charx-draft")).toContain('data-slot="sheet-chip"');
    expect(tagOf(html, "charx-draft")).toContain("rounded-full px-2.5 py-0.5 text-[13px]");
    // The chips line's slot (K11 gates: the line is portalled into it in the browser, so a pinned
    // part switch never remounts the header sections).
    expect(tagOf(html, "charx-chips-slot")).toContain(
      "col-span-2 min-w-0 @min-[560px]/sheet:col-span-1 @min-[560px]/sheet:col-start-2",
    );
    expect(html).not.toContain("charx-header-line");
  });

  test("FR-KIT-85 small header buttons (K4 walkthrough): Edit / Lock / Approve / Derive are the kit's 24-px small buttons", () => {
    const html = sheetHtml("full");
    const edit = tagOf(html, "charx-edit-toggle");
    expect(edit).toContain('data-size="sm"');
    expect(edit).toContain("h-6 px-2 text-[13px]");
    expect(edit).not.toContain("h-8");
  });

  test("FR-KIT-85 name stays readable (K4 walkthrough: 'G..' at 320 px): it wraps to two lines before truncating, the full name in its Tooltip; the text column keeps 6rem and the actions wrap under the row when they don't fit", () => {
    const html = sheetHtml("full");
    // The Tooltip trigger is the picker wrapper (it carries the select); the name clamps at 2 lines.
    expect(tagOf(html, "charx-name-picker")).toContain("data-tip");
    expect(html).toMatch(/<span class="line-clamp-2 min-w-0 break-normal text-balance">Mira</);
    expect(html).not.toContain("break-words");
    // K11: portrait and name column in a grid; the actions (K13: floated top-right in the name
    // column) stack in a column when narrow (the name keeps its room), a row once wide.
    expect(html).toContain(
      'class="grid grid-cols-[auto_minmax(0,1fr)] items-start gap-x-3 gap-y-1.5"',
    );
    expect(tagOf(html, "charx-header-actions")).toContain("float-right ml-3 shrink-0");
    const actions = html.slice(html.indexOf('data-testid="charx-header-actions"'));
    expect(actions).toContain("flex flex-col items-end gap-1 @min-[560px]/sheet:flex-row");
  });

  test("FR-KIT-85 compact fallback (K11): the name stays the picker and the small buttons stay top-right; only the chips line moves into charx-header-rest (no boxed select)", () => {
    const html = sheetHtml("compact");
    const rest = html.slice(html.indexOf('data-testid="charx-header-rest"'));
    const pinned = html.slice(0, html.indexOf('data-testid="charx-content"'));
    expect(pinned).toContain('data-testid="charx-name-picker"');
    expect(pinned).toContain('data-testid="charx-edit-toggle"');
    expect(pinned).not.toContain("charx-header-chips");
    expect(rest).toContain('data-testid="charx-header-chips"');
    expect(rest).toContain('data-testid="charx-draft"');
    expect(rest).not.toContain("char-sheet-picker");
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

/** The shared roll control of one sheet roll, as `SheetRoll` builds it (no route claims). */
function sheetControl(
  kind: Parameters<typeof useSheetRollControl>[0]["kind"],
  rollRef: SheetRollRef,
  title: string,
  o: RenderOpts = {},
): RollControl {
  let control: RollControl | null = null;
  function Probe() {
    control = useSheetRollControl({ kind, rollRef, title, claim: null }).control;
    return null;
  }
  render(<Probe />, o);
  if (!control) throw new Error("no control");
  return control;
}

const staged = () => diceExtras.api.getState().request;
const controlOf = (r: TrayRequest | null) => {
  if (r?.kind !== "control") throw new Error("no staged control");
  return r;
};

describe("FR-CHARX-127 click stages, Alt rolls", () => {
  afterEach(() => diceExtras.clear());

  test("FR-CHARX-127 click stages, Alt rolls: click → a tray request (dice, purpose, types, label), no intent; Shift → advantage; Alt+click → one char.roll, no tray; the tray's Roll sends the staged parts", () => {
    const sent: [string, unknown][] = [];
    const attack = sheetControl("toHit", { attackId: "a2" }, "Light crossbow attack", { sent });
    attack.roll({});
    expect(sent).toEqual([]);
    const req = controlOf(staged());
    expect(req.mode).toBe("normal");
    expect(req.options).toMatchObject({
      expressions: ["1d20+4"],
      category: "attack",
      label: "Mira — Light crossbow attack",
      purpose: "attack",
    });
    attack.roll({ shiftKey: true });
    expect(controlOf(staged()).mode).toBe("advantage");
    diceExtras.clear();
    // Alt+click: the old one-click roll, nothing staged.
    attack.roll({ altKey: true });
    expect(staged()).toBeNull();
    expect(sent).toEqual([
      ["char.roll", { characterId: "mira", kind: "toHit", mode: "normal", attackId: "a2" }],
    ]);
    // Damage: the row's dice with its type; the tray's Roll hands back the edited parts.
    sent.length = 0;
    const damage = sheetControl("damage", { attackId: "a2" }, "Light crossbow damage", { sent });
    damage.roll({});
    const dmg = controlOf(staged());
    expect(dmg.options).toMatchObject({
      expressions: ["1d8+2"],
      purpose: "damage",
      partTypes: ["piercing"],
      label: "Mira — Light crossbow damage",
    });
    dmg.options.onRoll({ mode: "normal", parts: [{ expression: "1d8+1d6+2", type: "piercing" }] });
    expect(sent).toEqual([
      [
        "char.roll",
        {
          characterId: "mira",
          kind: "damage",
          mode: "normal",
          attackId: "a2",
          parts: [{ expression: "1d8+1d6+2", type: "piercing" }],
        },
      ],
    ]);
    // Spell rows: Attack and Damage / Healing stage too (Healing untyped).
    for (const [kind, spellId, purpose] of [
      ["spellToHit", "gb", "attack"],
      ["spellDamage", "gb", "damage"],
      ["spellDamage", "cw", "damage"],
    ] as const) {
      diceExtras.clear();
      sheetControl(kind, { spellId }, "x").roll({});
      expect(controlOf(staged()).options.purpose).toBe(purpose);
    }
    expect(controlOf(staged()).options.partTypes).toEqual([null]);
    // The buttons' hint: "Alt: roll now"; other sheet rolls keep click = roll, Alt = stage.
    const tip = renderToStaticMarkup(rollButtonTip(attack));
    expect(tip).toContain(ROLL_NOW_HINT);
    sent.length = 0;
    diceExtras.clear();
    const check = sheetControl("check", { ability: "dex" }, "Dexterity check", { sent });
    expect(check.options.purpose).toBeUndefined();
    expect(renderToStaticMarkup(rollButtonTip(check))).toContain(STAGE_HINT);
    check.roll({});
    expect(staged()).toBeNull();
    expect(sent.map(([n]) => n)).toEqual(["char.roll"]);
  });

  test("FR-CHARX-127 a row with extra parts stages one die group type per part (Flame Tongue: slashing, fire)", () => {
    const attacks = [
      {
        id: "ft",
        name: "Flame Tongue greatsword",
        toHit: 7,
        damage: "2d6+4",
        damageType: "slashing",
        bonus: 1,
        extraDamage: [{ damage: "2d6", type: "fire" }],
      },
    ];
    sheetControl("damage", { attackId: "ft" }, "Flame Tongue greatsword damage", {
      attacks,
    }).roll({});
    expect(controlOf(staged()).options).toMatchObject({
      expressions: ["2d6+5", "2d6"],
      partTypes: ["slashing", "fire"],
      purpose: "damage",
    });
    diceExtras.clear();
  });
});

describe("FR-CHARX-132 disconnect", () => {
  afterEach(() => diceExtras.clear());

  test("FR-CHARX-132 staged roll offline: not live → staging works, the tray's Roll is disabled, the request is kept; nothing sent", () => {
    const sent: [string, unknown][] = [];
    const o = { sent, state: "reconnecting" as const };
    sheetControl("damage", { attackId: "a2" }, "Light crossbow damage", o).roll({});
    const html = render(<TrayWindow />, o);
    expect(html).toMatch(/<button[^>]*data-testid="dicex-tray-roll"[^>]*disabled=""/);
    expect(controlOf(staged()).options.label).toBe("Mira — Light crossbow damage");
    expect(sent).toEqual([]);
  });
});
