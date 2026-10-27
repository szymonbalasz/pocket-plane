// FR-CMP-19 entry views (static render over a fake store): the Goblin stat block (core from the
// definition + reference sections), spell, homebrew item, footer + About; FR-CMP-21 the DM's drag
// handle; FR-CMP-18 the window body's search, Filters and Tabs per role; FR-CMP-35 group rows.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { EntryResponse, EntrySummary } from "@shared/compendium/rest";
import { emptyStore } from "@shared/protocol/store";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createStore } from "zustand";
import type { Api } from "../../api";
import { TooltipProvider } from "../../components/ui/overlays";
import { SyncContext, type SyncState } from "../../sync/store";
import { CompendiumBody, GroupMembers, GroupRow, ResultRow, TableHead } from "./CompendiumWindow";
import type { Role } from "./logic";
import { resetCmpNav } from "./nav";
import { EntryView } from "./views";

const SRD = {
  key: "srd-5.1",
  name: "SRD 5.1",
  licence: "CC BY 4.0",
  attribution: "This work includes material taken from the System Reference Document 5.1.",
  url: "https://api.open5e.com/",
  version: "mini",
};
const ROW = {
  campaignId: null,
  derivedFromId: null,
  imageAssetIds: [],
  createdAt: "t",
  updatedAt: "t",
};

const GOBLIN: EntryResponse = {
  entry: {
    ...ROW,
    id: "e-gob",
    kind: "monster",
    source: "srd-5.1",
    sourceKey: "monster/goblin",
    name: "Goblin",
    line: "CR 1/4 · Small humanoid",
    facets: { cr: "1/4", type: "humanoid", size: "small" },
    body: {
      meta: {
        subtype: "goblinoid",
        alignment: "neutral evil",
        armorNote: "leather armor, shield",
        speedText: "30 ft.",
        skillsText: "Stealth +6",
        senses: "darkvision 60 ft., passive Perception 9",
        languages: "Common, Goblin",
      },
      traits: [
        {
          name: "Nimble Escape",
          text: "The goblin can take the Disengage or Hide action as a bonus action on each of its turns.",
        },
      ],
      actions: [
        {
          name: "Scimitar",
          text: "*Melee Weapon Attack:* +4 to hit, reach 5 ft., one target. *Hit:* 5 (1d6 + 2) slashing damage.",
        },
        {
          name: "Shortbow",
          text: "*Ranged Weapon Attack:* +4 to hit, range 80/320 ft., one target. *Hit:* 5 (1d6 + 2) piercing damage.",
        },
      ],
      bonusActions: [],
      reactions: [],
    },
    definitionId: "d-gob",
    shared: false,
    importedAt: "t",
  },
  source: SRD,
  definition: {
    id: "d-gob",
    name: "Goblin",
    statBlock: {
      size: "small",
      ac: 15,
      hpMax: 7,
      hpFormula: "2d6",
      initBonus: 2,
      attacks: [{ name: "Scimitar", toHit: 4, damage: "1d6+2", damageType: "slashing" }],
      speed: 30,
      abilities: { str: 8, dex: 14, con: 10, int: 10, wis: 8, cha: 8 },
      cr: "1/4",
      senses: { visionFt: 0, darkvisionFt: 60, seesMagicalDarkness: false },
    },
  },
};

const FIREBALL: EntryResponse = {
  entry: {
    ...ROW,
    id: "e-fire",
    kind: "spell",
    source: "srd-5.1",
    sourceKey: "spell/fireball",
    name: "Fireball",
    line: "Level 3 evocation",
    facets: {
      level: 3,
      school: "evocation",
      classes: ["Sorcerer", "Wizard"],
      concentration: false,
      ritual: false,
    },
    body: {
      castingTime: "1 action",
      range: "150 feet",
      components: "V, S, M",
      material: "A tiny ball of bat guano and sulfur.",
      duration: "Instantaneous",
      text: "Each creature in a 20-foot-radius sphere takes 8d6 fire damage on a failed save.",
      higherLevel: "The damage increases by 1d6 for each slot level above 3rd.",
    },
    definitionId: null,
    shared: false,
    importedAt: "t",
  },
  source: SRD,
};

const SHARD: EntryResponse = {
  entry: {
    ...ROW,
    campaignId: "c1",
    id: "e-shard",
    kind: "item",
    source: null,
    sourceKey: null,
    name: "Moonblade Shard",
    line: "Rare wondrous item",
    facets: { category: "magic", rarity: "rare", attunement: false },
    body: { typeLine: "Wondrous item", text: "Glows in **moonlight**." },
    definitionId: null,
    shared: true,
    importedAt: null,
  },
  source: null,
};

function store(role: Role) {
  const you = { campaignId: "c1", role, playerId: role === "dm" ? null : "p1" };
  return createStore<SyncState>()(
    () =>
      ({
        state: "live",
        store: { ...emptyStore(), you },
        lazy: {},
        connection: { load: () => null, retryLoad: () => null },
      }) as unknown as SyncState,
  );
}

const render = (role: Role, node: ReactNode) =>
  renderToStaticMarkup(
    <SyncContext.Provider value={store(role)}>
      <TooltipProvider delayDuration={0} skipDelayDuration={0}>
        {node}
      </TooltipProvider>
    </SyncContext.Provider>,
  ).replaceAll("<!-- -->", "");

const text = (html: string) => html.replace(/<[^>]+>/g, "");

describe("FR-CMP-19 entry views", () => {
  test("FR-CMP-19 monster stat block: header, AC 15, HP 7 (2d6), scores, darkvision 60 ft., Nimble Escape, Scimitar, Shortbow; footer + About", () => {
    const html = render("dm", <EntryView data={GOBLIN} viewer="dm" />);
    for (const id of ["header", "scores", "traits", "actions"]) {
      expect(html).toContain(`data-testid="cmp-statblock-${id}"`);
    }
    expect(html).not.toContain('data-testid="cmp-statblock-legendary"');
    expect(html).not.toContain('data-testid="cmp-statblock-reactions"');
    const t = text(html);
    expect(t).toContain("Small humanoid (goblinoid), neutral evil");
    expect(t).toContain("AC 15 (leather armor, shield)"); // FR-KIT-77 core row
    expect(t).toContain("HP 7 (2d6)");
    expect(t).toContain("DEX14+2");
    expect(t).toContain("Senses darkvision 60 ft., passive Perception 9");
    expect(t).toContain("Challenge 1/4 (50 XP)");
    expect(t).toContain("Nimble Escape.");
    expect(t).toContain("Scimitar.");
    expect(t).toContain("Shortbow.");
    expect(t).toContain("+4 to hit");
    expect(html.match(/data-testid="dicex-notation"/g)).toHaveLength(2);
    expect(html).toContain('data-testid="cmp-entry" data-record-id="e-gob" data-value="monster"');
    expect(html).toMatch(/data-testid="cmp-attribution">SRD 5\.1 · CC BY 4\.0</);
    expect(html).toContain('data-testid="cmp-about"');
  });

  test("FR-CMP-21 DM monster view has the drag handle ({definitionId}); a player view never does", () => {
    expect(render("dm", <EntryView data={GOBLIN} viewer="dm" />)).toContain(
      'data-testid="cmp-drag-handle" data-record-id="d-gob"',
    );
    expect(render("player", <EntryView data={FIREBALL} viewer="player" />)).not.toContain(
      "cmp-drag-handle",
    );
  });

  test("FR-CMP-19 spell view: line, casting facts, text, higher levels; dice clickable with the entry's name", () => {
    const html = render("player", <EntryView data={FIREBALL} viewer="player" />);
    const t = text(html);
    expect(t).toContain("Level 3 evocation");
    expect(t).toContain("Casting Time 1 action");
    expect(t).toContain("Components V, S, M (A tiny ball of bat guano and sulfur.)");
    expect(t).toContain("At Higher Levels.");
    expect(html).toContain('data-value="8d6"');
    expect(html).toMatch(/data-testid="cmp-attribution">SRD 5\.1 · CC BY 4\.0</);
  });

  test("FR-CMP-19 homebrew: 'Homebrew' for players; '+ Shared / DM only' for the DM; no About", () => {
    const player = render("player", <EntryView data={SHARD} viewer="player" />);
    expect(text(player)).toContain("Homebrew");
    expect(text(player)).not.toContain("Shared");
    expect(player).not.toContain("cmp-about");
    expect(text(render("dm", <EntryView data={SHARD} viewer="dm" />))).toContain(
      "Homebrew · Shared",
    );
    const hidden = { ...SHARD, entry: { ...SHARD.entry, shared: false } };
    expect(text(render("dm", <EntryView data={hidden} viewer="dm" />))).toContain(
      "Homebrew · DM only",
    );
    expect(player).toContain("<strong");
  });
});

describe("FR-CMP-18 window body", () => {
  const api = {} as Api;
  test("FR-CMP-18 search, Filters, Tabs: DM 6 with Monsters; player 5 without; loading skeleton before the first page", () => {
    resetCmpNav();
    const dm = render("dm", <CompendiumBody api={api} viewer="dm" top={<p>PANEL</p>} />);
    expect(dm).toContain('data-testid="cmp-window"');
    expect(dm).toContain('data-testid="cmp-search"');
    expect(dm).toContain('data-testid="cmp-filters"');
    expect(dm).toContain("PANEL");
    expect(dm.match(/data-testid="cmp-tab"/g)).toHaveLength(6);
    expect(dm).toContain('data-testid="cmp-tab" data-value="monster"');
    expect(dm).toContain('data-testid="cmp-loading"');
    const player = render("player", <CompendiumBody api={api} viewer="player" />);
    expect(player.match(/data-testid="cmp-tab"/g)).toHaveLength(5);
    expect(player).not.toContain('data-value="monster"');
  });
});

describe("FR-CMP-35 group rows", () => {
  const CLASSES = ["Barbarian", "Bard", "Cleric", "Druid", "Fighter", "Monk"];
  const ASI: EntrySummary = {
    id: "asi-barbarian",
    kind: "feature",
    name: "Ability Score Improvement",
    sourceLabel: "SRD 5.1",
    line: "12 entries · Barbarian, Bard, Cleric, Druid, Fighter, Monk, Paladin, Ranger, Rogue",
    group: { count: 12 },
  };
  const members: EntrySummary[] = CLASSES.map((c) => ({
    id: `asi-${c.toLowerCase()}`,
    kind: "feature",
    name: "Ability Score Improvement",
    sourceLabel: "SRD 5.1",
    line: `${c} · 4th level`,
  }));

  test("FR-CMP-35 FR-CMP-36 collapsed group row: one cmp-result with data-group-count, name + group line, toggle aria-expanded false, no members", () => {
    const html = render("dm", <GroupRow r={ASI} expanded={false} />);
    expect(html.match(/data-testid="cmp-result"/g)).toHaveLength(1);
    expect(html).toContain(
      'data-record-id="asi-barbarian" data-value="feature" data-group-count="12"',
    );
    expect(html).toMatch(
      /data-testid="cmp-group-toggle" data-record-id="asi-barbarian" aria-expanded="false"/,
    );
    expect(text(html)).toContain("Ability Score Improvement");
    expect(text(html)).toContain("12 entries · Barbarian, Bard, Cleric");
    expect(html).not.toContain("cmp-group-member");
  });

  test("FR-CMP-35 expanded: members in place below the row, each with its own line; loading skeleton first; same in the player client", () => {
    for (const role of ["dm", "player"] as const) {
      const html = render(
        role,
        <GroupRow r={ASI} expanded>
          <GroupMembers group={ASI} members={{ state: "ready", members }} viewer={role} />
        </GroupRow>,
      );
      expect(html).toContain('aria-expanded="true"');
      expect(html.match(/data-testid="cmp-group-member"/g)).toHaveLength(members.length);
      expect(html).toContain('data-testid="cmp-group-member" data-record-id="asi-fighter"');
      expect(text(html)).toContain("Fighter · 4th level");
      // The toggle precedes its members.
      expect(html.indexOf("cmp-group-toggle")).toBeLessThan(html.indexOf("cmp-group-member"));
    }
    const loading = render(
      "dm",
      <GroupRow r={ASI} expanded>
        <GroupMembers group={ASI} members={{ state: "loading" }} viewer="dm" />
      </GroupRow>,
    );
    expect(loading).toContain('data-testid="cmp-group-loading"');
    const collapsed = render(
      "dm",
      <GroupRow r={ASI} expanded={false}>
        <GroupMembers group={ASI} members={{ state: "ready", members }} viewer="dm" />
      </GroupRow>,
    );
    expect(collapsed).not.toContain("cmp-group-member");
  });

  test("FR-CMP-35 search placeholder 'Search: words in any order'", () => {
    resetCmpNav();
    expect(render("dm", <CompendiumBody api={{} as Api} viewer="dm" />)).toContain(
      'placeholder="Search: words in any order"',
    );
  });
});

// ---------- kit parity K4 (§6.8) ----------

/** The opening tag of the first element with `testId` (attributes in render order). */
const tagOf = (html: string, testId: string) => {
  const at = html.indexOf(`data-testid="${testId}"`);
  return html.slice(html.lastIndexOf("<", at), html.indexOf(">", at) + 1);
};

describe("FR-KIT-76 compendium table", () => {
  const GOB_ROW: EntrySummary = {
    id: "e-gob",
    kind: "monster",
    name: "Goblin",
    sourceLabel: "SRD 5.1",
    line: "CR 1/4 · Small humanoid",
    definitionId: "d-gob",
  };

  test("FR-KIT-76 table rows: sticky header Name · Details · Source; each row one grid line: name, details, source chip; zebra + hover; drag kept (DM monster)", () => {
    const head = render("dm", <TableHead />);
    expect(head).toContain('data-slot="cmp-table-head"');
    expect(head).toContain('aria-hidden="true"');
    expect(head).toMatch(/sticky top-0/);
    expect(text(head)).toBe("NameDetailsSource");
    const dm = render("dm", <ResultRow r={GOB_ROW} viewer="dm" />);
    const row = tagOf(dm, "cmp-result");
    expect(row).toContain('data-slot="cmp-row"');
    expect(row).toContain('data-record-id="e-gob" data-value="monster"');
    expect(row).toMatch(/grid-cols-\[minmax\(0,1fr\)_minmax\(0,1\.25fr\)_4\.5rem\]/);
    expect(row).toContain("min-h-[30px]"); // K13 (DM #363): the kit's 30-px row
    expect(row).toContain("hover:bg-accent");
    expect(row).toContain('draggable="true"');
    // The details line is the name cell's next sibling (small-copy-s7 reads it so), then the chip.
    expect(dm).toMatch(
      /data-testid="cmp-result-name"[^>]*><span class="truncate">Goblin<\/span><\/span><span[^>]*tabular-nums[^>]*>CR 1\/4 · Small humanoid<\/span><span data-slot="badge"[^>]*>SRD<\/span>/,
    );
    // A player row is no drag source.
    expect(
      tagOf(render("player", <ResultRow r={GOB_ROW} viewer="player" />), "cmp-result"),
    ).toContain('draggable="false"');
    // Zebra: the list styles every other row; read from the source (static render has no list).
    const src = readFileSync(join(import.meta.dir, "CompendiumWindow.tsx"), "utf8");
    expect(src).toContain("[&>li:nth-child(even)]:bg-muted/40");
    expect(src).toMatch(/data-testid="cmp-results" data-slot="cmp-table"/);
  });

  test("FR-KIT-76 K13 kit rows (DM #363): 30 px, every cell in body type (tabular figures without the number-face class), the name its weight only; a long name's whole text in its Tooltip", () => {
    const LONG: EntrySummary = { ...GOB_ROW, name: "Ability Score Improvement (Fighter)" };
    const html = render("dm", <ResultRow r={LONG} viewer="dm" />);
    const row = tagOf(html, "cmp-result");
    expect(row).toContain("min-h-[30px]");
    expect(row).toContain("py-[5px]");
    expect(row).not.toContain("min-h-10");
    const name = html.slice(html.indexOf('data-testid="cmp-result-name"'));
    expect(name).toMatch(/^data-testid="cmp-result-name" data-slot="cmp-row-name"/);
    expect(tagOf(html, "cmp-result-name")).toContain("font-medium");
    // The Tooltip trigger is the row itself (its only Tab stop; walkthrough step 4); no focusable
    // or tip-enrolled part inside it.
    expect(name).toContain('<span class="truncate">Ability Score');
    expect(row).toContain("data-tip");
    expect(html.match(/data-tip/g)?.length).toBe(1);
    expect(html).not.toContain("tabindex");
    expect(html).toMatch(
      /<span class="truncate text-muted-foreground \[font-variant-numeric:tabular-nums\]">/,
    );
    expect(html).not.toMatch(/class="[^"]*\btabular-nums\b(?!\])/);
    expect(html).not.toContain("text-xs text-muted-foreground");
    // Gilt & Stone: the name in body type, not the name face (K13 block after K4's).
    const gilt = readFileSync(join(import.meta.dir, "../../themes/gilt.css"), "utf8");
    const k13 = gilt.slice(gilt.indexOf("/* KIT: round 3"));
    expect(k13).toMatch(
      /\[data-slot="cmp-row-name"\] \{\s+color: var\(--foreground\);\s+font-family: var\(--font-body\);/,
    );
  });

  test("FR-KIT-76 group rows: an expandable table row (chevron + name, the count line in Details); members indented on the same grid", () => {
    const ASI: EntrySummary = {
      id: "asi-barbarian",
      kind: "feature",
      name: "Ability Score Improvement",
      sourceLabel: "SRD 5.1",
      line: "12 entries · Barbarian, Bard",
      group: { count: 12 },
    };
    const html = render(
      "dm",
      <GroupRow r={ASI} expanded>
        <GroupMembers
          group={ASI}
          members={{
            state: "ready",
            members: [{ ...ASI, id: "asi-bard", line: "Bard · 4th level", group: undefined }],
          }}
          viewer="dm"
        />
      </GroupRow>,
    );
    expect(tagOf(html, "cmp-result")).toContain('data-group-count="12"');
    expect(tagOf(html, "cmp-group-toggle")).toContain("grid-cols-");
    expect(html).toMatch(/data-testid="cmp-result-name"[^>]*><svg/); // chevron before the name
    expect(text(html)).toContain("12 entries · Barbarian, Bard");
    expect(tagOf(html, "cmp-group-member")).toContain('data-slot="cmp-row"');
    expect(html).toMatch(/<span class="col-span-2 truncate pl-5">Bard · 4th level<\/span>/);
  });
});

describe("FR-KIT-77 stat block card", () => {
  test("FR-KIT-77 stat block card: italic type line; one ruled row AC · HP (formula) · Speed; 6-column grid label / score / modifier; sections as name + muted line rows", () => {
    const html = render("dm", <EntryView data={GOBLIN} viewer="dm" />);
    expect(html).toContain('data-slot="statblock"');
    expect(html).toMatch(
      /<p class="text-sm italic text-muted-foreground">Small humanoid \(goblinoid\), neutral evil<\/p>/,
    );
    const core = html.slice(html.indexOf('data-testid="cmp-statblock-core"'));
    expect(tagOf(html, "cmp-statblock-core")).toContain('data-slot="statblock-core"');
    expect(tagOf(html, "cmp-statblock-core")).toContain("border-t");
    expect(text(core.slice(0, core.indexOf('data-testid="cmp-statblock-scores"')))).toMatch(
      /AC 15 \(leather armor, shield\)HP 7 \(2d6\)Speed 30 ft\./,
    );
    expect(tagOf(html, "cmp-statblock-scores")).toContain('data-slot="statblock-abilities"');
    expect(tagOf(html, "cmp-statblock-scores")).toContain("grid-cols-6");
    expect(html.match(/data-testid="cmp-statblock-score"/g)).toHaveLength(6);
    const str = html.slice(html.indexOf(">", html.indexOf('data-value="str"')) + 1);
    expect(text(str.slice(0, str.indexOf("</div>")))).toBe("STR8−1");
    // Labels carry the label slot (gilt.css: label type, gold).
    expect(html.match(/data-slot="statblock-label"/g)?.length).toBeGreaterThanOrEqual(9);
    // Sections: name + muted line, the dice still clickable.
    const at = html.indexOf('data-testid="cmp-statblock-section" data-value="Scimitar"');
    const sec = html.slice(html.lastIndexOf("<", at));
    expect(tagOf(sec, "cmp-statblock-section")).toContain('data-slot="statblock-entry"');
    expect(sec).toMatch(
      /data-slot="statblock-entry-name"[^>]*>Scimitar\.<\/div><div class="text-muted-foreground">/,
    );
    expect(html.match(/data-testid="dicex-notation"/g)).toHaveLength(2);
  });

  test("FR-KIT-77 stat block card is read-only: no roll buttons, no window opener (FR-KIT-101 lands with K7)", () => {
    const html = render("dm", <EntryView data={GOBLIN} viewer="dm" />);
    expect(html).not.toContain("ent-statblock");
    expect(html).not.toContain("statblock-attack");
  });
});

describe("FR-KIT-01 same DOM per theme (compendium)", () => {
  test("FR-KIT-01 same DOM per theme: the table row and the stat block render the same markup under Simple Dark and Gilt & Stone; no theme read", () => {
    const row: EntrySummary = {
      id: "e-gob",
      kind: "monster",
      name: "Goblin",
      sourceLabel: "SRD 5.1",
      line: "CR 1/4 · Small humanoid",
    };
    const [a, b] = (["default", "gilt"] as const).map((t) =>
      render(
        "dm",
        <div data-theme={t}>
          <TableHead />
          <ResultRow r={row} viewer="dm" />
          <EntryView data={GOBLIN} viewer="dm" />
        </div>,
      ).replace(t, "·"),
    );
    expect(a).toBe(b ?? "");
    for (const f of ["CompendiumWindow.tsx", "views.tsx", "statblock-card.tsx"])
      expect(readFileSync(join(import.meta.dir, f), "utf8")).not.toMatch(/data-theme|useTheme/);
  });
});

describe("FR-KIT-07 slots present (K4)", () => {
  const GILT = readFileSync(join(import.meta.dir, "../../themes/gilt.css"), "utf8");
  const KIT = GILT.slice(GILT.indexOf("/* KIT: library"));

  test("FR-KIT-07 slots present: cmp-table, cmp-row, statblock, statblock-core, statblock-abilities (+ party-card, sheet-portrait, sheet-name) styled by gilt.css's one KIT library block", () => {
    const html =
      render("dm", <EntryView data={GOBLIN} viewer="dm" />) +
      render(
        "dm",
        <ResultRow
          r={{ id: "x", kind: "spell", name: "X", sourceLabel: "SRD 5.1", line: "" }}
          viewer="dm"
        />,
      );
    for (const slot of ["cmp-row", "statblock", "statblock-core", "statblock-abilities"])
      expect(html).toContain(`data-slot="${slot}"`);
    expect(readFileSync(join(import.meta.dir, "CompendiumWindow.tsx"), "utf8")).toContain(
      'data-slot="cmp-table"',
    );
    expect(GILT.match(/\/\* KIT: library/g)?.length).toBe(1);
    for (const slot of [
      "cmp-table",
      "cmp-row",
      "cmp-table-head",
      "statblock-core",
      "statblock-abilities",
      "statblock-label",
      "party-card",
      "party-card-ac",
      "sheet-name",
    ])
      expect(KIT).toContain(`[data-slot="${slot}"]`);
  });
});
