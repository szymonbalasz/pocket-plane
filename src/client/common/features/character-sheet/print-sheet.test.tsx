// Printed sheet layout (CHARX §6.2, §13 "Printed sheet"): boxes, stat row, HP control, vitals box,
// ability blocks, passives, wide-layout classes, breakdown text, action boxes, tab strip, edit
// and NPC sheets, test IDs, theme slots. Static server render over a fake sync store, as
// `sheet-render.test.tsx`: a closed Tooltip renders nothing, so breakdowns are read from
// `breakdownText` / `rollHint` (what the Tooltips get); the live switch at 560 px, the 280 px fit
// and the tab arrows are the e2e's (`charx-print-sheet.e2e.ts`).
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  type CreatureSheetRecord,
  defaultSheetData,
  FeatureRow,
  SpellRow,
} from "@shared/character-sheet/sheet";
import {
  CharacterStatBlock,
  type DefinitionRecord,
  MonsterStatBlock,
} from "@shared/entities/schemas";
import { emptyStore } from "@shared/protocol/store";
import { renderToStaticMarkup } from "react-dom/server";
import { createStore } from "zustand";
import { TooltipProvider } from "../../components/ui/overlays";
import { SyncContext, type SyncState } from "../../sync/store";
import { rollButtonTip, STAGE_HINT } from "../dice-roll-log/roll-control";
import { NO_PREVIEW } from "../effect-modifiers/roll-preview";
import { createWindowRegistry } from "../play-shell/registry";
import { ShellProvider } from "../play-shell/ShellContext";
import { ActionsTab } from "./ActionsTab";
import { ABILITY_GRID, COLUMNS, MainTab, STAT_GRID } from "./MainTab";
import { FeaturesTab } from "./MoreTabs";
import { rollRoutes } from "./roll-routes";
import { ROLL_HINT, rollHint } from "./rolls";
import type { RollRoute } from "./routing";
import { SheetView } from "./SheetView";
import { SheetContext, type SheetCtx } from "./sheet-context";
import {
  breakdownText,
  compactFullPx,
  type PinnedPart,
  pinnedPart,
  type SeenFull,
  skillRows,
  TAB_ARROW_STEP_PX,
  tabArrows,
  wheelScroll,
} from "./view-model";

const testRoutes = rollRoutes as RollRoute[];

/** Mira (CHARX §13): level 5 (PB +3), DEX 18, Stealth expertise, Perception proficient. */
const mira = CharacterStatBlock.parse({
  size: "medium",
  ac: 16,
  hpMax: 44,
  initBonus: 4,
  speed: 35,
  attacks: [{ id: "lb", name: "Longbow", toHit: 7, damage: "1d8+4", damageType: "piercing" }],
  abilities: { str: 10, dex: 18, con: 14, int: 12, wis: 14, cha: 8 },
  saveProficiencies: ["str", "dex"],
  skills: { stealth: "expertise", perception: "proficient" },
  spellcasting: { ability: "wis", slots: { "1": 4, "2": 2 } },
  classes: [{ name: "Ranger", level: 5, hitDie: "d10" }],
  level: 5,
  className: "Ranger",
});
const goblin = MonsterStatBlock.parse({
  size: "small",
  ac: 15,
  hpMax: 21,
  initBonus: 2,
  speed: 30,
  cr: "1",
  attacks: [{ id: "sc", name: "Scimitar", toHit: 4, damage: "1d6+2", damageType: "slashing" }],
  abilities: { str: 8, dex: 14, con: 10, int: 10, wis: 8, cha: 8 },
  skills: { stealth: "proficient" },
});
const spells = [{ id: "hm", name: "Hunter's Mark", level: 1, damage: "1d6" }].map((s) =>
  SpellRow.parse(s),
);
const features = [{ id: "fe", name: "Favored Enemy", usesMax: 3, used: 1 }].map((f) =>
  FeatureRow.parse(f),
);

type Opts = {
  client?: "dm" | "player";
  npc?: boolean;
  editing?: boolean;
  hp?: number;
  temp?: number;
  stats?: unknown;
};

function creatureOf(o: Opts): DefinitionRecord {
  return {
    id: "mira",
    kind: o.npc ? "monster" : "character",
    name: o.npc ? "Elite Goblin" : "Mira",
    campaignId: "c1",
    ownerPlayerId: o.npc ? null : "p1",
    portraitAssetId: null,
    statBlock: o.stats ?? (o.npc ? goblin : mira),
    ...(o.npc ? {} : { hpCurrent: o.hp ?? 38, tempHp: o.temp ?? 0 }),
  } as unknown as DefinitionRecord;
}

function syncOf(client: "dm" | "player") {
  const you = { campaignId: "c1", role: client, playerId: client === "dm" ? null : "p1" };
  return createStore<SyncState>()(
    () =>
      ({
        state: "live",
        store: { ...emptyStore(), you },
        notLiveSince: null,
        everLive: true,
        connection: { sendIntent: () => Promise.resolve({}) },
      }) as unknown as SyncState,
  );
}

function render(node: React.ReactNode, o: Opts = {}) {
  const client = o.client ?? "player";
  const creature = creatureOf(o);
  const sheet = { ...defaultSheetData(), spells, features };
  const ctx = {
    creature,
    stats: creature.statBlock,
    sheet,
    row: o.npc ? undefined : { id: "mira", entityId: "mira", campaignId: "c1", ...sheet },
    client,
    npc: o.npc ?? false,
    readOnly: false,
    canEdit: o.editing ?? false,
    editing: o.editing ?? false,
    canCount: !o.npc,
    ownerName: "Player 1",
  } as unknown as SheetCtx;
  return renderToStaticMarkup(
    <SyncContext.Provider value={syncOf(client)}>
      <TooltipProvider delayDuration={0} skipDelayDuration={0}>
        <SheetContext.Provider value={ctx}>{node}</SheetContext.Provider>
      </TooltipProvider>
    </SyncContext.Provider>,
  );
}

function sheetHtml(o: Opts = {}) {
  const g = globalThis as { document?: unknown };
  g.document = { title: "", hidden: false };
  const row = {
    id: "mira",
    entityId: "mira",
    campaignId: "c1",
    ownerPlayerId: "p1",
    ...defaultSheetData(),
  } as unknown as CreatureSheetRecord;
  try {
    return renderToStaticMarkup(
      <SyncContext.Provider value={syncOf("player")}>
        <TooltipProvider delayDuration={0} skipDelayDuration={0}>
          <ShellProvider registry={createWindowRegistry("player", [])}>
            <SheetView
              creature={creatureOf(o)}
              row={row}
              client="player"
              playerId="p1"
              ownerName="Player 1"
              picker={null}
              startEditing={false}
            />
          </ShellProvider>
        </TooltipProvider>
      </SyncContext.Provider>,
    );
  } finally {
    delete g.document;
  }
}

const boxes = (html: string) =>
  [...html.matchAll(/data-testid="charx-box" data-value="([a-z]+)"/g)].map((m) => m[1]);
const text = (html: string) => html.replace(/<[^>]+>/g, "");
/** The markup of the element opening at `marker` (balanced on `<div` / `</div>`). */
function elementAt(html: string, marker: string): string {
  const at = html.indexOf(marker);
  expect(at).toBeGreaterThan(-1);
  const start = html.lastIndexOf("<", at);
  let depth = 0;
  const re = /<(\/?)div\b[^>]*>/g;
  re.lastIndex = start;
  for (let m = re.exec(html); m; m = re.exec(html)) {
    depth += m[1] ? -1 : 1;
    if (depth === 0) return html.slice(start, m.index + m[0].length);
  }
  throw new Error(`unbalanced at ${marker}`);
}
const box = (html: string, key: string) =>
  elementAt(html, `data-testid="charx-box" data-value="${key}"`);
const ability = (html: string, a: string) =>
  elementAt(html, `data-testid="char-sheet-ability" data-value="${a}"`);
const at = (html: string, marker: string) => html.indexOf(marker);

describe("FR-CHARX-105 boxes", () => {
  test("FR-CHARX-105 boxes: Main is labelled boxes with charx-box keys, each data-slot sheet-box", () => {
    const html = render(<MainTab />);
    expect(boxes(html)).toEqual([
      "ac",
      "hp",
      "speed",
      "init",
      "prof",
      "vitals",
      "skills",
      "passives",
    ]);
    for (const k of ["hp", "speed", "init", "prof", "vitals", "skills"]) {
      expect(box(html, k)).toMatch(
        /^<div data-testid="charx-box" data-value="[a-z]+" data-slot="sheet-box"/,
      );
    }
    // Small-caps label on the top edge, the value large inside.
    const speed = box(html, "speed");
    expect(text(speed)).toBe("Speed35 ft");
    expect(speed).toContain("uppercase tracking-wide");
    expect(speed).toContain("text-lg font-semibold");
    expect(text(box(html, "hp"))).toStartWith("Hit Points");
  });
});

describe("FR-CHARX-106 stat row", () => {
  test("FR-CHARX-106 stat row: shield AC, Hit Points, Speed, Initiative button box, Proficiency", () => {
    const html = render(<MainTab />);
    const grid = elementAt(html, `class="${STAT_GRID}"`);
    expect(boxes(grid)).toEqual(["ac", "hp", "speed", "init", "prof"]);
    // AC: inline SVG in currentColor, tall on the left when narrow.
    const ac = box(html, "ac");
    expect(ac).toContain('data-slot="sheet-shield"');
    expect(ac).toMatch(
      /<svg viewBox="0 0 100 112" aria-hidden="true"[^>]*>.*stroke="currentColor"/,
    );
    expect(ac).toContain("row-span-2");
    expect(text(ac)).toBe("AC16");
    // HP: current / max, the bar; across the top when narrow.
    const hp = box(html, "hp");
    expect(hp).toContain('data-testid="char-sheet-hp" data-state="full"');
    expect(text(hp)).toBe("Hit Points38 / 44");
    expect(hp).toContain('class="block h-full bg-hp-full" style="width:86.36363636363636%"');
    expect(hp).toContain("col-span-3");
    // The Initiative box is the Initiative button; the value sits on it.
    const init = box(html, "init");
    expect(init).toMatch(/<button[^>]*data-testid="char-sheet-roll-init"/);
    expect(init).toContain('data-testid="char-sheet-init"');
    expect(text(init)).toBe("Init+4");
    // "Prof +N" in its own box, not above the abilities.
    expect(text(box(html, "prof"))).toBe("Prof +3");
    expect(at(html, 'data-testid="char-sheet-prof"')).toBeLessThan(
      at(html, 'data-testid="char-sheet-ability"'),
    );
    expect(box(html, "prof")).toContain('data-testid="char-sheet-prof"');
  });

  test("FR-CHARX-106 stat row: read-only Temp N when temp HP > 0; Down at 0", () => {
    expect(render(<MainTab />)).not.toContain("charx-hp-temp");
    const temp = box(render(<MainTab />, { temp: 5 }), "hp");
    expect(temp).toContain('data-testid="charx-hp-temp" data-value="5"');
    expect(text(temp)).toContain("Temp 5");
    expect(temp).not.toMatch(/<input|<button/);
    const down = box(render(<MainTab />, { hp: 0 }), "hp");
    expect(down).toContain('data-testid="char-sheet-down"');
    expect(down).toContain('data-state="down"');
  });

  test("FR-CHARX-106 stat row: a hidden Initiative (FR-CHAR-24) → a plain box with Initiative set", () => {
    testRoutes.unshift({
      name: "test",
      claim: (_s, _id, kind) =>
        kind === "initiative"
          ? { badge: "Test", hidden: true, send: () => Promise.resolve() }
          : null,
    });
    try {
      const html = render(<MainTab />, { client: "dm" });
      const init = box(html, "init");
      expect(init).not.toContain("char-sheet-roll-init");
      expect(init).toContain('data-testid="char-sheet-init-locked"');
      expect(text(init)).toBe("Init+4Initiative set");
      expect(html).not.toContain("char-sheet-public-init");
    } finally {
      testRoutes.shift();
    }
  });
});

describe("FR-CHARX-107 hp control", () => {
  test("FR-CHARX-107 hp control: the input + Damage / Heal row stays under the stat row", () => {
    for (const client of ["player", "dm"] as const) {
      const html = render(<MainTab />, { client });
      const grid = at(html, `class="${STAT_GRID}"`);
      const row = at(html, 'data-testid="char-sheet-hp-input"');
      expect(row).toBeGreaterThan(at(html, 'data-testid="charx-box" data-value="prof"'));
      expect(row).toBeLessThan(at(html, 'data-testid="charx-box" data-value="vitals"'));
      expect(grid).toBeLessThan(row);
      expect(box(html, "hp")).not.toContain("char-sheet-hp-input");
      for (const id of ["char-sheet-hp-damage", "char-sheet-hp-heal"]) {
        expect(html).toContain(`data-testid="${id}"`);
      }
    }
    // The DM's Initiative public switch at the end of that row.
    const dm = render(<MainTab />, { client: "dm" });
    expect(at(dm, 'data-testid="char-sheet-public-init"')).toBeGreaterThan(
      at(dm, 'data-testid="char-sheet-hp-heal"'),
    );
  });
});

describe("FR-CHARX-108 vitals box", () => {
  test("FR-CHARX-108 vitals box: hit dice + vitals sections in one box; Senses under it, centred", () => {
    const html = render(<MainTab />);
    const vitals = box(html, "vitals");
    expect(vitals).toContain('data-testid="charx-hitdie" data-value="d10"');
    expect(vitals).toContain('data-testid="charx-section" data-record-id="cbtx.temp-hp"');
    expect(at(html, 'data-testid="charx-senses"')).toBeGreaterThan(
      at(html, 'data-testid="charx-box" data-value="vitals"'),
    );
    expect(html).toContain('data-testid="charx-senses" class="text-center');
  });
});

describe("FR-CHARX-109 ability block", () => {
  test("FR-CHARX-109 ability block: name, modifier = Check button, score pill, Save line", () => {
    const html = render(<MainTab />);
    const dex = ability(html, "dex");
    expect(dex).toContain('data-slot="sheet-ability"');
    const order = [
      ">DEX<",
      'data-testid="char-sheet-roll-check" data-value="dex"',
      'data-testid="char-sheet-ability-score" data-value="dex"',
      'data-testid="char-sheet-save-prof" data-value="dex" data-proficient="true"',
      "Save",
      'data-testid="char-sheet-roll-save" data-value="dex"',
    ].map((m) => dex.indexOf(m));
    expect(order.every((i) => i > -1)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(dex).toMatch(
      /<button [^>]*class="[^"]*text-xl[^"]*"[^>]*data-testid="char-sheet-roll-check"[^>]*>.*\+4/,
    );
    expect(text(dex)).toBe("DEXDexterity+418Save+7");
    expect(text(ability(html, "cha"))).toBe("CHACharisma−18Save−1");
    expect(ability(html, "cha")).toContain('data-proficient="false"');
    // Narrow 3 × 2 (2 columns below 268 px), wide one column.
    expect(html).toContain(`class="${ABILITY_GRID}"`);
    expect(ABILITY_GRID).toBe(
      "grid grid-cols-2 gap-1.5 @min-[268px]/sheet:grid-cols-3 @min-[560px]/sheet:grid-cols-1",
    );
  });

  test("FR-CHARX-109 ability block: the DM's public switches stay above the blocks; players none", () => {
    const dm = render(<MainTab />, { client: "dm" });
    for (const id of ["char-sheet-public-check", "char-sheet-public-save"]) {
      expect(at(dm, `data-testid="${id}"`)).toBeGreaterThan(-1);
      expect(at(dm, `data-testid="${id}"`)).toBeLessThan(
        at(dm, 'data-testid="char-sheet-ability"'),
      );
    }
    expect(render(<MainTab />)).not.toContain("char-sheet-public-check");
  });
});

describe("FR-CHARX-110 skills box", () => {
  test("FR-CHARX-110 skills box: 18 rows alphabetical, dot / double dot, d20 glyph, tinted proficient rows", () => {
    const html = render(<MainTab />);
    const skills = box(html, "skills");
    const keys = [...skills.matchAll(/data-testid="charx-skill" data-value="([a-zA-Z]+)"/g)].map(
      (m) => m[1],
    );
    expect(keys).toHaveLength(18);
    const names = skillRows(mira)?.map((r) => r.name) ?? [];
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
    expect(skills).toMatch(
      /data-value="stealth" data-proficiency="expertise" data-slot="sheet-skill-row" class="[^"]*bg-muted\/60/,
    );
    expect(skills).toMatch(
      /data-value="arcana" data-proficiency="none" data-slot="sheet-skill-row" class="[^"]*px-0.5 text-xs"/,
    );
    expect(skills).toMatch(
      /data-testid="charx-roll-skill" data-value="stealth"[^>]*><svg viewBox="0 0 24 24"/,
    );
    expect(text(skills)).toContain("StealthDEX+10");
  });
});

describe("FR-CHARX-111 passives", () => {
  test("FR-CHARX-111 passives: three boxes under Skills, short labels narrow, full names wide", () => {
    const html = render(<MainTab />);
    const p = box(html, "passives");
    expect(at(html, 'data-value="passives"')).toBeGreaterThan(at(html, 'data-value="skills"'));
    expect(p.match(/data-slot="sheet-box"/g)).toHaveLength(3);
    expect(
      [...p.matchAll(/data-testid="charx-passive" data-value="([a-z]+)"/g)].map((m) => m[1]),
    ).toEqual(["perception", "investigation", "insight"]);
    expect(text(p)).toBe(
      "Perc.Passive Perception15Invest.Passive Investigation11InsightPassive Insight12",
    );
  });
});

describe("FR-CHARX-112 wide at 560", () => {
  test("FR-CHARX-112 wide at 560: container query on the sheet body; abilities 200 px left, Skills right", () => {
    expect(COLUMNS).toContain("@min-[560px]/sheet:grid-cols-[200px_minmax(0,1fr)]");
    expect(STAT_GRID).toContain(
      "@min-[560px]/sheet:grid-cols-[96px_minmax(0,1.8fr)_repeat(3,minmax(0,1fr))]",
    );
    const main = render(<MainTab />);
    const cols = elementAt(main, `class="${COLUMNS}"`);
    expect(at(cols, 'data-testid="char-sheet-ability"')).toBeLessThan(
      at(cols, 'data-value="skills"'),
    );
    expect(sheetHtml()).toMatch(
      /<div [^>]*class="[^"]*@container\/sheet [^"]*" data-testid="char-sheet"/,
    );
  });
});

describe("FR-CHARX-113 breakdown text", () => {
  test("FR-CHARX-113 breakdown text: from the view model's terms (expertise, save without proficiency, overridden passive)", () => {
    expect(breakdownText(mira, "skill.stealth")).toBe("Stealth +10 · DEX +4 · expertise +6");
    expect(breakdownText(mira, "skill.perception")).toBe("Perception +5 · WIS +2 · proficiency +3");
    expect(breakdownText(mira, "skill.arcana")).toBe("Arcana +1 · INT +1");
    expect(breakdownText(mira, "save.con")).toBe("Constitution save +2 · CON +2");
    expect(breakdownText(mira, "save.dex")).toBe("Dexterity save +7 · DEX +4 · proficiency +3");
    expect(breakdownText(mira, "check.cha")).toBe("Charisma check −1 · CHA −1 · score 8");
    expect(breakdownText(mira, "passive.perception")).toBe(
      "Passive Perception 15 · 10 + Perception +5",
    );
    expect(breakdownText(mira, "proficiency")).toBe("Proficiency +3 · level 5");
    expect(breakdownText(goblin, "proficiency")).toBe("Proficiency +2 · CR 1");
    expect(breakdownText(mira, "ac")).toBe("Armor Class 16");
    expect(breakdownText(mira, "init")).toBe("Initiative +4");
    expect(breakdownText(mira, "spellAttack")).toBe("Spell attack +5 · proficiency +3 · WIS +2");
    // An override reads as today (FR-CHARX-06): "Derived … · Override: note".
    const over = CharacterStatBlock.parse({
      ...mira,
      overrides: { "passive.perception": { value: 17, note: "Observant" } },
    });
    expect(breakdownText(over, "passive.perception")).toBe(
      "Passive Perception 17 · Derived 15 · Override: Observant",
    );
    // Not on this sheet: null (no scores).
    const bare = CharacterStatBlock.parse({
      ...mira,
      abilities: undefined,
      saveProficiencies: undefined,
      skills: undefined,
      spellcasting: undefined,
    });
    expect(breakdownText(bare, "skill.stealth")).toBeNull();
  });

  test("FR-CHARX-113 breakdown text: the roll buttons' Tooltip leads with it (charx-breakdown); string hints unchanged", () => {
    const tip = (node: React.ReactNode) =>
      renderToStaticMarkup(rollButtonTip({ preview: { ...NO_PREVIEW, text: "" } }, node));
    const stage = `<span data-testid="dicex-stage-hint">${STAGE_HINT}</span>`;
    // A string hint renders exactly as before the node form existed.
    expect(tip("Shift: advantage")).toBe(`Shift: advantage · ${stage}`);
    expect(tip(undefined)).toBe(stage);
    expect(tip(rollHint(mira, undefined, undefined))).toBe(`${ROLL_HINT} · ${stage}`);
    expect(tip(rollHint(mira, "skill.stealth", undefined))).toBe(
      `<span data-testid="charx-breakdown" data-value="skill.stealth">Stealth +10 · DEX +4 · expertise +6</span> · ${ROLL_HINT} · ${stage}`,
    );
    // The parts the roll picks up still lead (FR-MOD-27).
    expect(
      renderToStaticMarkup(
        rollButtonTip(
          { preview: { ...NO_PREVIEW, text: "Bless +1d4" } },
          rollHint(mira, "save.dex", undefined),
        ),
      ),
    ).toStartWith('Bless +1d4 · <span data-testid="charx-breakdown" data-value="save.dex">');
  });
});

describe("FR-CHARX-114 action boxes", () => {
  test("FR-CHARX-114 action boxes: Attacks, Spells (header + slot pips inside), Features", () => {
    const actions = render(<ActionsTab />);
    expect(boxes(actions)).toEqual(["attacks", "spells"]);
    expect(box(actions, "attacks")).toContain('data-testid="charx-attack" data-record-id="lb"');
    const sp = box(actions, "spells");
    for (const id of ["charx-spellcasting", "charx-slot", 'charx-spell" data-record-id="hm']) {
      expect(sp).toContain(`data-testid="${id}"`);
    }
    expect(text(sp)).toStartWith("SpellsSpellcasting");
    const feats = render(<FeaturesTab />);
    expect(boxes(feats)).toEqual(["features"]);
    expect(box(feats, "features")).toContain('data-testid="charx-feature"');
    // Rows and buttons unchanged.
    expect(box(actions, "attacks")).toContain(
      'data-testid="charx-roll-attack-damage" data-record-id="lb"',
    );
  });
});

describe("FR-CHARX-115 tab strip", () => {
  test("FR-CHARX-115 tab strip: arrows at an end with hidden tabs; the wheel scrolls sideways", () => {
    expect(tabArrows(0, 300, 300)).toEqual({ prev: false, next: false });
    expect(tabArrows(0, 500, 280)).toEqual({ prev: false, next: true });
    expect(tabArrows(100, 500, 280)).toEqual({ prev: true, next: true });
    expect(tabArrows(220, 500, 280)).toEqual({ prev: true, next: false });
    expect(tabArrows(219.5, 500, 280)).toEqual({ prev: true, next: false });
    expect(wheelScroll(0, 100, true)).toBe(100);
    expect(wheelScroll(0, -40, true)).toBe(-40);
    expect(wheelScroll(30, 10, true)).toBeNull(); // a sideways gesture already
    expect(wheelScroll(0, 100, false)).toBeNull(); // nothing to scroll
    expect(TAB_ARROW_STEP_PX).toBe(120);
  });

  test("FR-CHARX-115 tab strip: sideways only, thin scrollbar, pinned with the header (FR-CHARX-48)", () => {
    const html = sheetHtml();
    const strip = elementAt(html, 'data-slot="sheet-tabs"');
    expect(strip).toContain(
      'class="min-w-0 flex-1 overflow-x-auto overflow-y-hidden pb-1 [scrollbar-width:thin]"',
    );
    expect(strip).toContain('role="tablist"');
    // Not measured in a static render: no arrows yet.
    expect(strip).not.toContain("charx-tabs-");
    expect(at(html, 'data-slot="sheet-tabs"')).toBeLessThan(
      at(html, 'data-testid="charx-content"'),
    );
    expect(at(html, 'data-slot="sheet-tabs"')).toBeGreaterThan(
      at(html, 'data-testid="charx-header"'),
    );
  });
});

describe("FR-CHARX-48 pinned header settles (CS walkthrough F1)", () => {
  test("FR-CHARX-48 pinned header settles: a full header taller than the compact parts stays compact", () => {
    // F1, measured: the DM's locked PC in a fight, body 382 px: the full header 206 px (badges and
    // Unlock / Edit beside the name), the compact parts 166 px. Before: full → compact → full …
    const body = 382;
    const width = 286;
    const measured = (p: PinnedPart) => (p === "full" ? 206 : 166);
    let part: PinnedPart = "full";
    let seen: SeenFull | null = null;
    const parts: PinnedPart[] = [];
    for (let i = 0; i < 6; i++) {
      const px: number =
        part === "full" ? measured(part) : compactFullPx(measured(part), seen, width);
      if (part === "full") seen = { px, width };
      part = pinnedPart(px, body, part);
      parts.push(part);
    }
    expect(parts).toEqual(["compact", "compact", "compact", "compact", "compact", "compact"]);
    // The full height counts only at the width it was seen at; a taller window brings full back.
    expect(compactFullPx(166, { px: 206, width }, width)).toBe(206);
    expect(compactFullPx(166, { px: 206, width }, 400)).toBe(166);
    expect(compactFullPx(220, { px: 206, width }, width)).toBe(220);
    expect(pinnedPart(compactFullPx(166, { px: 206, width }, width), 440, "compact")).toBe("full");
  });
});

describe("FR-CHARX-116 edit and NPC", () => {
  test("FR-CHARX-116 edit and NPC: edit mode keeps the boxes with inputs in place", () => {
    const html = render(<MainTab />, { client: "dm", editing: true });
    expect(boxes(html)).toEqual([
      "ac",
      "hp",
      "speed",
      "init",
      "prof",
      "vitals",
      "skills",
      "passives",
    ]);
    for (const [k, path] of [
      ["ac", "ac"],
      ["hp", "hpMax"],
      ["speed", "speed"],
      ["init", "initBonus"],
    ]) {
      expect(box(html, k as string)).toContain(`data-testid="charx-field" data-value="${path}"`);
    }
    expect(box(html, "prof")).toContain('data-testid="charx-override" data-value="proficiency"');
    expect(ability(html, "dex")).toContain('data-value="abilities.dex"');
    expect(ability(html, "dex")).toContain('data-value="saveProficiencies.dex"');
  });

  test("FR-CHARX-116 edit and NPC: an NPC sheet has the same boxes; no hit dice, death saves or vitals box", () => {
    const html = render(<MainTab />, { client: "dm", npc: true });
    expect(boxes(html)).toEqual(["ac", "hp", "speed", "init", "prof", "skills", "passives"]);
    expect(text(box(html, "hp"))).toBe("HP max21");
    expect(text(box(html, "prof"))).toBe("Prof +2");
    for (const id of [
      "charx-hitdie",
      "charx-section",
      "char-sheet-hp-input",
      "char-sheet-public-check",
    ]) {
      expect(html).not.toContain(`data-testid="${id}"`);
    }
    expect(html.match(/data-testid="char-sheet-ability"/g)).toHaveLength(6);
  });
});

describe("FR-CHARX-117 ids kept", () => {
  test("FR-CHARX-117 ids kept: every existing Main ID still renders, with its record keys", () => {
    const html = render(<MainTab />, { client: "dm" });
    for (const id of [
      "char-sheet-ac",
      "char-sheet-hp",
      "char-sheet-speed",
      "char-sheet-init",
      "char-sheet-roll-init",
      "char-sheet-public-init",
      "char-sheet-prof",
      "charx-prof",
      "char-sheet-public-check",
      "char-sheet-public-save",
      "char-sheet-hp-input",
      "char-sheet-hp-damage",
      "char-sheet-hp-heal",
      "charx-hitdie",
      "charx-senses",
      "charx-public-skill",
    ]) {
      expect(html).toContain(`data-testid="${id}"`);
    }
    for (const id of [
      "char-sheet-ability",
      "char-sheet-ability-score",
      "char-sheet-ability-mod",
      "char-sheet-roll-check",
      "char-sheet-roll-save",
      "char-sheet-save-prof",
    ]) {
      expect(html.match(new RegExp(`data-testid="${id}" data-value="`, "g"))).toHaveLength(6);
    }
    for (const id of ["charx-skill", "charx-skill-bonus", "charx-roll-skill"]) {
      expect(html.match(new RegExp(`data-testid="${id}" data-value="`, "g"))).toHaveLength(18);
    }
    expect(html.match(/data-testid="charx-passive" data-value="/g)).toHaveLength(3);
    // "Prof +2" text of FR-CHAR-22's header element, now in its box (CHAR e2e unchanged).
    expect(text(elementAt(html, 'data-testid="charx-box" data-value="prof"'))).toBe("Prof +3");
  });
});

describe("FR-CHARX-119 slots present", () => {
  test("FR-CHARX-119 slots present: the sheet-* data-slot names on Main, Actions and the tab strip", () => {
    const html = render(<MainTab />) + render(<ActionsTab />) + sheetHtml();
    for (const slot of [
      "sheet-box",
      "sheet-shield",
      "sheet-ability",
      "sheet-skill-row",
      "sheet-roll",
      "sheet-pip",
      "sheet-tabs",
    ]) {
      expect(html).toContain(`data-slot="${slot}"`);
    }
    // Number roll buttons carry sheet-roll: 6 checks, 6 saves, 18 skills, Initiative.
    expect(render(<MainTab />).match(/data-slot="sheet-roll"/g)).toHaveLength(31);
  });

  test("FR-CHARX-119 slots present: no theme logic or theme classes in the sheet components (ADR-0069)", () => {
    const dir = import.meta.dir;
    const files = readdirSync(dir).filter((f) => f.endsWith(".tsx") && !f.includes(".test."));
    for (const f of files) {
      const src = readFileSync(join(dir, f), "utf8");
      expect({ f, theme: /data-theme|gilt|useTheme/i.test(src) }).toEqual({ f, theme: false });
    }
  });
});
