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
import { PublicRolls, PublicRollsMenu } from "./PublicMenu";
import { rollRoutes } from "./roll-routes";
import { ROLL_HINT, rollHint } from "./rolls";
import type { RollRoute } from "./routing";
import { DERIVE_HINT, fadeOf, SheetView } from "./SheetView";
import { SheetContext, type SheetCtx, SheetWide } from "./sheet-context";
import {
  breakdownText,
  compactFullPx,
  isWideSheet,
  levelOrdinal,
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
  wide?: boolean;
  features?: FeatureRow[];
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
  const sheet = { ...defaultSheetData(), spells, features: o.features ?? features };
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
              initialWide={o.wide}
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
    expect(speed).toContain("text-xs font-medium uppercase tracking-wide");
    // K11: the kit's 26-px value (34 px wide), the unit small beside it.
    expect(speed).toContain("text-[26px] font-bold");
    expect(speed).toContain("@min-[560px]/sheet:text-[34px]");
    expect(speed).toMatch(/35<span class="[^"]*text-\[0\.55em\][^"]*"> ft<\/span>/);
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
    // K11: "AC" narrow, "Armor Class" once wide (both in the markup).
    expect(text(ac)).toBe("ACArmor Class16");
    // HP: current / max (max as the small unit), the bar, the Temp column; across the top when
    // narrow.
    const hp = box(html, "hp");
    expect(hp).toContain('data-testid="char-sheet-hp" data-state="full"');
    expect(text(hp)).toBe("Hit Points38 / 44Temp0");
    expect(hp).toContain('class="block h-full bg-hp-full" style="width:86.36363636363636%"');
    expect(hp).toContain("col-span-3");
    // The Initiative box is the Initiative button; the value sits on it.
    const init = box(html, "init");
    expect(init).toMatch(/<button[^>]*data-testid="char-sheet-roll-init"/);
    expect(init).toContain('data-testid="char-sheet-init"');
    expect(text(init)).toBe("InitInitiative+4");
    // "Prof +N" in its own box, not above the abilities.
    expect(text(box(html, "prof"))).toBe("Prof +3");
    expect(at(html, 'data-testid="char-sheet-prof"')).toBeLessThan(
      at(html, 'data-testid="char-sheet-ability"'),
    );
    expect(box(html, "prof")).toContain('data-testid="char-sheet-prof"');
  });

  test("FR-CHARX-106 stat row: the Temp column in the Hit Points box (K11: always, kit); Down at 0", () => {
    expect(render(<MainTab />)).toContain('data-testid="charx-hp-temp" data-value="0"');
    const temp = box(render(<MainTab />, { temp: 5 }), "hp");
    expect(temp).toContain('data-testid="charx-hp-temp" data-value="5"');
    expect(text(temp)).toEndWith("Temp5");
    // The control is combat-extras' `hp` section (laid over the column), no field in the box.
    expect(temp).not.toMatch(/<input/);
    expect(temp).toContain('data-testid="charx-section" data-record-id="cbtx.temp-hp"');
    // NPC sheets: no Temp column.
    expect(render(<MainTab />, { client: "dm", npc: true })).not.toContain("charx-hp-temp");
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
      // K11 walkthrough: screen-reader text, no caption (the value's Tooltip says it).
      expect(init).toContain('data-testid="char-sheet-init-locked" class="sr-only"');
      expect(text(init)).toBe("InitInitiative+4Initiative set");
      expect(render(<PublicRolls />, { client: "dm" })).not.toContain("char-sheet-public-init");
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
      // K11: compact, a small field and the kit's small buttons; nothing else on the row.
      const row2 = elementAt(html, 'data-testid="charx-hp-control"');
      expect(row2).toContain("h-7 w-16");
      expect(row2.match(/<button/g)).toHaveLength(2);
    }
    // The DM's Initiative public switch is in the header's Public rolls menu (K11), not here.
    expect(render(<MainTab />, { client: "dm" })).not.toContain("char-sheet-public-init");
    expect(render(<PublicRolls />, { client: "dm" })).toContain(
      'data-testid="char-sheet-public-init"',
    );
  });
});

describe("FR-CHARX-108 vitals box", () => {
  test("FR-CHARX-108 vitals box: hit dice + vitals sections on one quiet line; Senses under it, centred", () => {
    const html = render(<MainTab />);
    const vitals = box(html, "vitals");
    expect(vitals).toContain('data-testid="charx-hitdie" data-value="d10"');
    // K11 (kit `.vitals`): one wrapping row, "Hit Dice 5 / 5 d10"; temp HP moved to the HP box.
    expect(vitals).toContain("flex-row flex-wrap");
    expect(text(vitals)).toBe("Hit Dice5 / 5d10");
    expect(vitals).not.toContain("cbtx.temp-hp");
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
    // K11: the kit's 24-px modifier (34 px wide), the save in a ruled column once wide.
    expect(dex).toMatch(
      /<button [^>]*class="[^"]*text-2xl[^"]*"[^>]*data-testid="char-sheet-roll-check"[^>]*>.*\+4/,
    );
    expect(dex).toContain("@min-[560px]/sheet:grid-cols-[minmax(0,1fr)_70px]");
    expect(dex).toContain("@min-[560px]/sheet:border-l");
    expect(text(dex)).toBe("DEXDexterity+418Save+7");
    expect(text(ability(html, "cha"))).toBe("CHACharisma−18Save−1");
    expect(ability(html, "cha")).toContain('data-proficient="false"');
    // Narrow 3 × 2 (2 columns below 268 px), wide one column.
    expect(html).toContain(`class="${ABILITY_GRID}"`);
    expect(ABILITY_GRID).toBe(
      "grid grid-cols-2 gap-1.5 @min-[268px]/sheet:grid-cols-3 @min-[560px]/sheet:grid-cols-1 @min-[560px]/sheet:gap-2",
    );
  });

  test("FR-CHARX-109 ability block: the DM's public switches are in the header's Public rolls menu (K11), no row above the blocks; players none", () => {
    const dm = render(<MainTab />, { client: "dm" });
    expect(dm).not.toContain("char-sheet-public-check");
    const menu = render(<PublicRolls />, { client: "dm" });
    expect(
      [...menu.matchAll(/data-testid="(char-sheet-public-[a-z]+|charx-public-skill)"/g)].map(
        (m) => m[1],
      ),
    ).toEqual([
      "char-sheet-public-init",
      "char-sheet-public-check",
      "char-sheet-public-save",
      "charx-public-skill",
    ]);
    expect(render(<PublicRollsMenu />, { client: "dm" })).toContain(
      'data-testid="charx-public-menu"',
    );
    for (const o of [{ client: "player" as const }, { client: "dm" as const, npc: true }]) {
      expect(render(<PublicRollsMenu />, o)).toBe("");
      expect(render(<PublicRolls />, o)).not.toContain("char-sheet-public-check");
    }
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
    // K11: kit rows in 15-px body type, the dot ringed for expertise, the bonus a boxed button.
    expect(skills).toMatch(
      /data-value="arcana" data-proficiency="none" data-slot="sheet-skill-row" class="[^"]*min-h-7 [^"]*text-\[15px\]"/,
    );
    expect(skills).toMatch(/data-value="stealth"[^>]*>.*?data-on="true" data-double="true"/);
    expect(skills).toMatch(/data-value="arcana"[^>]*>.*?data-on="false"/);
    expect(skills).not.toContain("charx-public-skill");
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
    // Rows and buttons unchanged (FR-CHARX-126: Attack, Damage).
    expect(box(actions, "attacks")).toContain(
      'data-testid="charx-roll-damage" data-record-id="lb"',
    );
  });
});

describe("K13 wide Main (DM #363)", () => {
  const wideMain = (o: Opts = {}) =>
    render(
      <SheetWide.Provider value>
        <MainTab />
      </SheetWide.Provider>,
      o,
    );
  const scoped = (html: string, id: string) =>
    html.match(new RegExp(`data-testid="${id}"[^>]*data-scope="main"`, "g"))?.length ?? 0;

  test("FR-CHARX-114 K13 wide Main: Attacks, Spells (slot pips), Limited uses boxes under the passives; narrow unchanged", () => {
    for (const client of ["player", "dm"] as const) {
      const narrow = render(<MainTab />, { client });
      const wide = wideMain({ client });
      expect(boxes(wide)).toEqual([...boxes(narrow), "attacks", "spells", "uses"]);
      expect(at(wide, 'data-value="attacks"')).toBeGreaterThan(at(wide, 'data-value="passives"'));
      // The Actions / Features rows and buttons, each repeated test ID scoped to Main.
      expect(box(wide, "attacks")).toContain(
        'data-testid="charx-attack" data-record-id="lb" data-scope="main"',
      );
      expect(scoped(wide, "charx-roll-damage")).toBe(1);
      expect(scoped(wide, "charx-slot")).toBe(6); // 4 level-1 + 2 level-2 pips
      expect(box(wide, "spells")).toContain('data-testid="charx-spellcasting"');
      expect(box(wide, "spells")).toContain('data-testid="charx-spell" data-record-id="hm"');
      const uses = box(wide, "uses");
      expect(text(uses)).toStartWith("Limited usesFavored Enemy");
      expect(scoped(uses, "charx-feature-use")).toBe(3);
      expect(uses).toContain('data-testid="charx-feature-left" data-record-id="fe"');
      for (const key of ["attacks", "spells", "uses"]) {
        expect(box(wide, key)).toContain(`data-value="${key}" data-scope="main"`);
      }
      // Narrow: no action box, no scope (FR-CHARX-44 holds there).
      expect(narrow).not.toContain("data-scope");
      expect(narrow).not.toContain('data-testid="charx-attack"');
    }
  });

  test("FR-CHARX-114 Limited uses shows each feature's whole text: every line, wrapped, dice rollable, no truncation, no tooltip", () => {
    const name = "Curse of the Very Long and Winding Name That Will Not Fit";
    const body = [
      "Bonus action: curse one.",
      "Add 1d6 to damage against it.",
      "Ends on death.",
    ].join(String.fromCharCode(10));
    const rows = [FeatureRow.parse({ id: "hx", name, usesMax: 1, used: 0, text: body })];
    const row = elementAt(
      box(wideMain({ client: "player", features: rows }), "uses"),
      'data-testid="charx-feature" data-record-id="hx"',
    );
    // All three lines, wrapped, line breaks kept, the dice still a roll button.
    const para = /<p [^>]*>.*<\/p>/s.exec(row)?.[0] ?? "";
    expect(text(para)).toBe(body);
    expect(para).toContain("whitespace-pre-wrap");
    expect(para).toContain("break-words");
    expect(para).toContain('data-testid="dicex-notation" data-value="1d6"');
    // Nothing cuts it, name included, and no Tooltip trigger wraps the paragraph.
    expect(row).not.toContain("truncate");
    expect(row).not.toContain("line-clamp");
    expect(/<p [^>]*>/.exec(para)?.[0]).not.toContain("data-state");
    expect(row).toContain(`<span class="min-w-0 break-words text-sm font-medium">${name}</span>`);
    // Same rendering as the Features tab.
    expect(render(<FeaturesTab />, { client: "player", features: rows })).toContain(para);
  });

  test("FR-CHARX-114 K13 wide Main: the boxes span both columns, after the abilities + Skills grid (kit wide sheet)", () => {
    const wide = wideMain();
    const columns = elementAt(wide, `class="${COLUMNS}"`);
    expect(columns).toContain('data-value="passives"');
    expect(columns).not.toContain("charx-main-actions");
    expect(at(wide, 'data-testid="charx-main-actions"')).toBeGreaterThan(
      at(wide, `class="${COLUMNS}"`) + columns.length - 1,
    );
  });

  test("FR-CHARX-114 K13 wide Main kit rows: name bold with its chip right, numbers under it, small stone buttons left; slots as diamonds with 'used / max'", () => {
    const wide = wideMain({ client: "dm" });
    const row = elementAt(wide, 'data-testid="charx-attack" data-record-id="lb" data-scope="main"');
    expect(row).toContain("py-[7px] last:border-b-0");
    expect(row).toContain('<span class="min-w-0 truncate text-[15px] font-bold">Longbow</span>');
    expect(row).toContain('class="mt-[5px] flex flex-wrap gap-[5px]"');
    expect(row).not.toContain("justify-end");
    const btn = /<button[^>]*data-testid="charx-roll-attack"[^>]*>/.exec(row)?.[0] ?? "";
    expect(btn).toContain('data-variant="outline"');
    expect(btn).toContain("h-6 px-[9px] text-[13px]");
    expect(at(row, "charx-attack-numbers")).toBeLessThan(at(row, "charx-roll-attack"));
    const spells = box(wide, "spells");
    expect(text(spells)).toContain("1st0 / 4");
    expect(text(spells)).toContain("2nd0 / 2");
    const pip = /<button[^>]*data-testid="charx-slot"[^>]*>/.exec(spells)?.[0] ?? "";
    expect(pip).toContain("[transform:rotate(45deg)]");
    expect(pip).toContain('data-scope="main"');
    expect([1, 2, 3, 4, 9].map(levelOrdinal)).toEqual(["1st", "2nd", "3rd", "4th", "9th"]);
    // The Actions tab keeps its rows: buttons right, round pips, "Level 1".
    const actions = render(<ActionsTab />, { client: "dm" });
    expect(actions).toContain('class="flex justify-end gap-1.5"');
    expect(text(box(actions, "spells"))).toContain("Level 1");
  });

  test("FR-CHARX-114 BL-141 wide Main: list boxes' labels are the heading band; Spells: the pip row, then one muted ability · attack · DC line, no 'Spellcasting' label, no level heading for one level; the Actions tab unchanged", () => {
    const wide = wideMain({ client: "dm" });
    for (const key of ["attacks", "spells", "uses"]) {
      const b = box(wide, key);
      expect(b).toMatch(/data-slot="sheet-box-rule"[^>]*class="[^"]*justify-center[^"]*border-b/);
    }
    const spells = box(wide, "spells");
    expect(text(spells)).not.toContain("Spellcasting");
    expect(text(spells)).not.toContain("Level 1");
    expect(at(spells, 'data-testid="charx-slot"')).toBeLessThan(
      at(spells, 'data-testid="charx-spellcasting"'),
    );
    expect(spells).toMatch(
      /data-testid="charx-spellcasting" class="text-xs text-muted-foreground"/,
    );
    const actions = box(render(<ActionsTab />, { client: "dm" }), "spells");
    expect(text(actions)).toContain("Spellcasting");
    expect(text(actions)).toContain("Level 1");
    expect(at(actions, 'data-testid="charx-spellcasting"')).toBeLessThan(
      at(actions, 'data-testid="charx-slot"'),
    );
  });

  test("FR-CHARX-114 BL-139 wide Main: the DM's Attack / Damage switches in the header's Public rolls menu, after Skills; none in the Attacks box; players none", () => {
    expect(wideMain({ client: "dm" })).not.toContain("charx-public-attack");
    expect(wideMain({ client: "dm" })).not.toContain("charx-public-damage");
    const menu = render(<PublicRolls />, { client: "dm" });
    expect(
      [
        ...menu.matchAll(/data-testid="(char-sheet-public-[a-z]+|charx-public-(?!rolls)[a-z]+)"/g),
      ].map((m) => m[1]),
    ).toEqual([
      "char-sheet-public-init",
      "char-sheet-public-check",
      "char-sheet-public-save",
      "charx-public-skill",
      "charx-public-attack",
      "charx-public-damage",
    ]);
    expect(wideMain({ client: "player" })).not.toContain("charx-public-attack");
  });

  test("FR-CHARX-114 K13 wide Main: rows stay in view mode while editing (rows are edited on Actions / Features)", () => {
    const html = elementAt(wideMain({ editing: true }), 'data-testid="charx-main-actions"');
    for (const id of [
      "charx-row-add",
      "charx-row-delete",
      "charx-attack-extra-add",
      "charx-field",
    ]) {
      expect(html).not.toContain(`data-testid="${id}"`);
    }
    expect(html).toContain('data-testid="charx-roll-attack"');
  });

  test("FR-CHARX-114 K13 Actions and Features tabs unchanged: no scope", () => {
    expect(render(<ActionsTab />, { client: "dm" })).not.toContain("data-scope");
    expect(render(<FeaturesTab />)).not.toContain("data-scope");
  });

  test("FR-CHARX-112 K13 the sheet view mounts the wide boxes only when wide (container width less padding ≥ 560)", () => {
    expect(isWideSheet(568, 8)).toBe(true);
    expect(isWideSheet(567, 8)).toBe(false);
    expect(isWideSheet(0, 0)).toBe(false);
    expect(sheetHtml({ wide: true })).toContain('data-testid="charx-main-actions"');
    expect(sheetHtml()).not.toContain('data-testid="charx-main-actions"');
  });
});

describe("K13 narrow sheet (round-2 gap 9)", () => {
  test("FR-CHARX-115 K13 tab strip: an end with hidden tabs fades (a 28-px mask) instead of cutting a word; none without overflow", () => {
    expect(fadeOf({ prev: false, next: false })).toBeUndefined();
    expect(fadeOf({ prev: false, next: true })).toBe("end");
    expect(fadeOf({ prev: true, next: true })).toBe("both");
    expect(fadeOf({ prev: true, next: false })).toBe("start");
    const strip = elementAt(sheetHtml(), 'data-slot="sheet-tabs"');
    expect(strip).toContain(
      "data-[fade=end]:[mask-image:linear-gradient(to_right,#000_calc(100%-28px),transparent)]",
    );
    expect(strip).toContain("data-[fade=start]:[mask-image:");
    expect(strip).toContain("data-[fade=both]:[mask-image:");
    // Not measured in a static render: no fade yet.
    expect(strip).not.toContain("data-fade=");
  });

  test("FR-KIT-85 K13 level line: one unit beside the actions (floated top-right in the name column) when it fits there, else under them at full width", () => {
    const html = sheetHtml();
    const at2 = (id: string) => html.indexOf(`data-testid="${id}"`);
    expect(html).toMatch(/data-testid="charx-header-actions" class="float-right ml-3 shrink-0"/);
    expect(at2("charx-header-actions")).toBeLessThan(at2("char-sheet-name"));
    expect(html).toMatch(
      /data-testid="char-sheet-level" class="mt-1 inline-block max-w-full align-top text-sm/,
    );
    expect(text(elementAt(html, 'data-testid="charx-header-actions"'))).toBe("Edit");
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
      'class="min-w-0 flex-1 overflow-x-auto overflow-y-hidden pb-1 [scrollbar-width:thin] ',
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
      "charx-hp-temp",
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
    // K11: the DM's public switches render in the header's Public rolls menu.
    const both = html + render(<PublicRolls />, { client: "dm" });
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
      expect(both).toContain(`data-testid="${id}"`);
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

/** A whole sheet (header + Main) for one viewer state (K11). */
function stateHtml(o: {
  client: "dm" | "player";
  npc?: boolean;
  locked?: boolean;
  editing?: boolean;
  part?: PinnedPart;
  /** An imported definition (read-only NPC sheet, FR-CHARX-31). */
  imported?: boolean;
}) {
  const g = globalThis as { document?: unknown };
  g.document = { title: "", hidden: false };
  const row = {
    id: "mira",
    entityId: "mira",
    campaignId: "c1",
    ownerPlayerId: "p1",
    ...defaultSheetData(),
    locked: o.locked ?? false,
  } as unknown as CreatureSheetRecord;
  try {
    return renderToStaticMarkup(
      <SyncContext.Provider value={syncOf(o.client)}>
        <TooltipProvider delayDuration={0} skipDelayDuration={0}>
          <ShellProvider registry={createWindowRegistry(o.client, [])}>
            <SheetView
              creature={
                o.imported
                  ? ({
                      ...creatureOf({ npc: true }),
                      name: "Goblin",
                      campaignId: null,
                    } as unknown as DefinitionRecord)
                  : creatureOf({ npc: o.npc })
              }
              row={o.npc ? undefined : row}
              client={o.client}
              playerId={o.client === "dm" ? null : "p1"}
              ownerName="Player 1"
              picker={<button type="button" data-testid="char-sheet-picker" />}
              startEditing={o.editing ?? false}
              initialPinnedPart={o.part ?? "full"}
            />
          </ShellProvider>
        </TooltipProvider>
      </SyncContext.Provider>,
    );
  } finally {
    delete g.document;
  }
}

/** Main's blocks in order: the first `charx-box` keys and the HP control's place. */
function mainOrder(html: string) {
  const main = html.slice(html.indexOf('data-testid="charx-content"'));
  return {
    first: boxes(main).slice(0, 5),
    controlAfterStats:
      !main.includes("char-sheet-hp-input") ||
      (at(main, 'data-testid="char-sheet-hp-input"') > at(main, `class="${STAT_GRID}"`) &&
        at(main, 'data-testid="char-sheet-hp-input"') > at(main, 'data-value="prof"')),
    statGridFirst: at(main, `class="${STAT_GRID}"`),
  };
}

describe("FR-CHARX-106 stat row in every viewer state (K11)", () => {
  const STATS = ["ac", "hp", "speed", "init", "prof"];

  test("FR-CHARX-106 stat row first on Main for the owner, the DM, a locked sheet, edit mode and an NPC sheet; the HP control under it", () => {
    for (const o of [
      { client: "player" as const },
      { client: "dm" as const },
      { client: "player" as const, locked: true },
      { client: "dm" as const, locked: true },
      { client: "player" as const, editing: true },
      { client: "dm" as const, npc: true },
      { client: "dm" as const, part: "compact" as const },
    ]) {
      const html = stateHtml(o);
      const m = mainOrder(html);
      expect({ o, first: m.first }).toEqual({ o, first: STATS });
      expect({ o, control: m.controlAfterStats }).toEqual({ o, control: true });
    }
    // The owner and the DM both get the HP control (also locked, FR-CHARX-12); NPCs none.
    expect(stateHtml({ client: "player", locked: true })).toContain("char-sheet-hp-input");
    expect(stateHtml({ client: "dm" })).toContain("char-sheet-hp-input");
    expect(stateHtml({ client: "dm", npc: true })).not.toContain("char-sheet-hp-input");
  });

  test("FR-CHARX-106 stat row first in a started fight (In combat badge, Initiative set)", () => {
    testRoutes.unshift({
      name: "test",
      claim: (_s, _id, kind) =>
        kind === "initiative"
          ? { badge: "In combat", hidden: true, send: () => Promise.resolve() }
          : null,
    });
    try {
      for (const client of ["dm", "player"] as const) {
        const html = stateHtml({ client });
        expect(html).toContain('data-testid="char-sheet-combat"');
        expect(mainOrder(html).first).toEqual(STATS);
        expect(box(html, "init")).toContain('data-testid="char-sheet-init-locked"');
        // FR-CHAR-24: no Initiative switch in the DM's menu while the button is hidden.
        expect(html).not.toContain("char-sheet-public-init");
      }
    } finally {
      testRoutes.shift();
    }
  });

  test("FR-KIT-85 K11 header: Lock and Edit as small buttons top-right, the DM's Public rolls menu beside them; the locked chip for the player; no boxed picker", () => {
    const dm = stateHtml({ client: "dm", locked: true });
    const actions = elementAt(dm, 'data-testid="charx-header-actions"');
    for (const id of ["charx-lock-toggle", "charx-edit-toggle", "charx-public-menu"]) {
      expect(actions).toContain(`data-testid="${id}"`);
    }
    expect(actions).toContain("Unlock");
    const player = stateHtml({ client: "player", locked: true });
    expect(player).toContain('data-testid="charx-locked"');
    expect(player).not.toContain("charx-edit-toggle");
    expect(player).not.toContain("charx-public-menu");
    // The picker is always laid over the name (transparent), never a box of its own.
    for (const html of [dm, stateHtml({ client: "dm", part: "compact" })]) {
      const picker = html.indexOf('data-testid="char-sheet-picker"');
      expect(picker).toBeGreaterThan(html.indexOf('data-testid="charx-name-picker"'));
      expect(picker).toBeLessThan(html.indexOf('data-testid="charx-content"'));
    }
  });

  test("FR-CHARX-123 sheet Rest: a 24-px icon button beside the Public rolls menu on the DM's character sheets only", () => {
    const actions = elementAt(stateHtml({ client: "dm" }), 'data-testid="charx-header-actions"');
    const rest = actions.slice(
      actions.indexOf("<button", actions.indexOf('data-testid="charx-public-menu"') + 1),
    );
    expect(rest).toContain('data-testid="charx-rest"');
    expect(rest).toContain('aria-label="Rest"');
    expect(rest).toContain("w-6 px-0");
    expect(stateHtml({ client: "player" })).not.toContain("charx-rest");
    expect(stateHtml({ client: "dm", npc: true })).not.toContain("charx-rest");
    expect(stateHtml({ client: "dm", imported: true })).not.toContain("charx-rest");
  });

  test("FR-CHARX-108 K11 vitals: hit dice and the death saves on one line; temp HP and its hint sentence are gone from the vitals", () => {
    const html = render(<MainTab />, { hp: 0 });
    const vitals = box(html, "vitals");
    expect(text(vitals)).toStartWith("Hit Dice");
    expect(vitals).not.toContain("doesn't stack");
    expect(html).not.toContain("doesn't stack");
  });

  test("FR-CHARX-110 K11 body type: no shrunken 10 / 12-px text on Main's rows (skills 15 px, values 26 px, labels 12 px)", () => {
    const html = render(<MainTab />);
    expect(html).not.toContain("text-[10px]");
    expect(elementAt(html, 'data-testid="charx-skill" data-value="stealth"')).toContain(
      "text-[15px]",
    );
  });
});

describe("K11 walkthrough fixes", () => {
  test("FR-KIT-85 imported NPC header: Derive to customise is a 24-px icon button (label in aria-label + Tooltip), so the name keeps its column; names never break mid-word", () => {
    const html = stateHtml({ client: "dm", imported: true });
    const derive = elementAt(html, 'data-testid="charx-header-actions"');
    const tag = derive.slice(
      derive.indexOf("<button"),
      derive.indexOf(">", derive.indexOf("<button")) + 1,
    );
    expect(tag).toContain('data-testid="charx-derive"');
    expect(tag).toContain("h-6 text-[13px] w-6 px-0");
    expect(tag).toContain(`aria-label="${DERIVE_HINT}"`);
    expect(text(derive)).toBe("");
    expect(html).toContain('data-testid="charx-readonly"');
    expect(html).toContain("line-clamp-2 min-w-0 break-normal text-balance");
    expect(html).not.toContain("break-words");
  });

  test("FR-KIT-85 level line wraps between parts, never right after a '·' (each later part keeps its '·')", () => {
    const html = stateHtml({ client: "dm", npc: true });
    const from = html.indexOf('data-testid="char-sheet-level"');
    // The level line closes the name column (K13: the actions float before the name).
    const line = `<span ${html.slice(from, html.indexOf("</span></div>", from))}`;
    expect(text(line)).toBe("CR 1 · 200 XP");
    expect(line).toContain('<span class="whitespace-nowrap">· 200 XP</span>');
    // Every "·" opens an unbreakable part.
    expect(line.match(/·/g)?.length).toBe(line.match(/whitespace-nowrap">·/g)?.length);
  });

  test("FR-CHARX-106 custom NPC boxes: HP max is a plain box (value under its label, as Speed); the Initiative button's label and value start at the top as Speed / Prof", () => {
    const html = render(<MainTab />, { client: "dm", npc: true });
    const hp = box(html, "hp");
    expect(hp).toMatch(
      /^<div data-testid="charx-box" data-value="hp" data-slot="sheet-box" class="[^"]*items-center[^"]*text-center/,
    );
    expect(hp).not.toContain("charx-hp-temp");
    expect(text(hp)).toBe("HP max21");
    expect(box(render(<MainTab />), "init")).toContain("flex-col justify-start");
  });

  test("FR-CHARX-107 a disabled Damage reads quiet (outline), the destructive look only while it can be pressed", () => {
    const html = render(<MainTab />);
    const damage = html.slice(
      html.lastIndexOf("<button", html.indexOf('data-testid="char-sheet-hp-damage"')),
    );
    expect(damage.slice(0, damage.indexOf(">"))).toContain('data-variant="outline"');
    expect(damage.slice(0, damage.indexOf(">"))).toContain('disabled=""');
  });

  test("FR-KIT-85 chips line: the header sections and their chip rows flatten into one wrapping line (the effects menu never alone on a row)", () => {
    const html = stateHtml({ client: "player" });
    const chips = html.slice(html.indexOf('data-testid="charx-header-chips"'));
    const cls = chips.slice(
      chips.indexOf('class="'),
      chips.indexOf('"', chips.indexOf('class="') + 7),
    );
    for (const c of [
      "flex-wrap",
      "[&amp;_[data-testid=charx-section]]:contents",
      "[&amp;_[data-testid=cbtx-sheet-effects]]:contents",
      "[&amp;_[data-chip-row]]:contents",
    ])
      expect(cls).toContain(c);
  });

  test("FR-KIT-85 K13 chips line: the effects menu last, beside the last chip; it takes no room of its own (never alone on a row), the line keeps 26 px for it", () => {
    const html = stateHtml({ client: "player" });
    const chips = html.slice(html.indexOf('data-testid="charx-header-chips"'));
    const cls = chips.slice(
      chips.indexOf('class="'),
      chips.indexOf('"', chips.indexOf('class="') + 7),
    );
    const menu = "[&amp;_[data-testid=cbtx-sheet-effects-menu]]";
    // 24-px button − 4 (drawn in) − 26 (cancelled) + the 6-px gap = 0 px on the line.
    for (const c of [`${menu}:order-last`, `${menu}:-ml-1`, `${menu}:-mr-[26px]`, `${menu}:size-6`])
      expect(cls).toContain(c);
    expect(cls).toContain("has-[[data-testid=cbtx-sheet-effects-menu]]:pr-[26px]");
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
