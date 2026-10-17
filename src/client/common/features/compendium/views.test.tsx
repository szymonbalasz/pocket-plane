// FR-CMP-19 entry views (static render over a fake store): the Goblin stat block (core from the
// definition + reference sections), spell, homebrew item, footer + About; FR-CMP-21 the DM's drag
// handle; FR-CMP-18 the window body's search, Filters and Tabs per role; FR-CMP-35 group rows.
import { describe, expect, test } from "bun:test";
import type { EntryResponse, EntrySummary } from "@shared/compendium/rest";
import { emptyStore } from "@shared/protocol/store";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createStore } from "zustand";
import type { Api } from "../../api";
import { TooltipProvider } from "../../components/ui/overlays";
import { SyncContext, type SyncState } from "../../sync/store";
import { CompendiumBody, GroupMembers, GroupRow } from "./CompendiumWindow";
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
const ROW = { campaignId: null, derivedFromId: null, createdAt: "t", updatedAt: "t" };

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
    expect(t).toContain("Armor Class 15 (leather armor, shield)");
    expect(t).toContain("Hit Points 7 (2d6)");
    expect(t).toContain("DEX14 (+2)");
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
