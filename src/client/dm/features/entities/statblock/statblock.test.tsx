// Kit parity K7 (§6.11, FR-KIT-100–107): the DM stat-block window. Registration, openers (pure
// targets, the token registries, the opener's store), the card's static render bound and unbound,
// the binding fallback, and the routing of every roll button as names + payloads (no new intent).
// The browser flow (Initiative ⋯ → Stat block → Attack + damage → the popup): kit-statblock.e2e.ts.
import { describe, expect, mock, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { CombatantView } from "@shared/combat-tracker/schemas";
import type { EntryResponse } from "@shared/compendium/rest";
import type { Attack } from "@shared/entities/schemas";
import type { RecordStore } from "@shared/protocol/store";
import type { TokenRecord } from "@shared/scenes-map/schemas";
import { companionStore, renderWith } from "@ui/features/combat-tracker/companions-fixture";
import { EntryView } from "@ui/features/compendium/views";
import { doubleClickFor, menuFor } from "../../scenes-map/token-menu";
import {
  abilitySend,
  attackSends,
  boundCombatant,
  EMPTY_TEXT,
  type RollAs,
  STATBLOCK_KIND,
  type StatBlockTarget,
  typeLine,
} from "./logic";
import { rowTarget, tokenTarget } from "./openers";
import { useStatBlockTarget } from "./store";
import { type MonsterDefinition, StatBlockView } from "./window";

mock.module("../../campaign-management/PlayersPanel", () => ({ PlayersPanel: () => null }));
const { dmWindows } = await import("../../../windows");
// The player registry's source (a DM test may not import @player, AGENTS §9.1).
const PLAYER_REGISTRY = readFileSync(
  fileURLToPath(new URL("../../../../player/windows.ts", import.meta.url)),
  "utf8",
);

const SCIMITAR: Attack = {
  id: "a-scim",
  name: "Scimitar",
  toHit: 4,
  damage: "1d6+2",
  damageType: "slashing",
};
const SHORTBOW: Attack = {
  id: "a-bow",
  name: "Shortbow",
  toHit: 4,
  damage: "1d6+2",
  damageType: "piercing",
};

const GOBLIN = {
  id: "d-goblin",
  kind: "monster",
  name: "Goblin",
  campaignId: null,
  portraitAssetId: null,
  tokenShape: null,
  derivedFromId: null,
  createdAt: "",
  updatedAt: "",
  source: "srd-5.1",
  sourceKey: "goblin",
  licence: "CC BY 4.0",
  attribution: "SRD",
  importedAt: "",
  ownerPlayerId: null,
  hpCurrent: null,
  statBlock: {
    size: "small",
    type: "humanoid",
    ac: 15,
    hpMax: 7,
    hpFormula: "2d6",
    initBonus: 2,
    speed: 30,
    abilities: { str: 8, dex: 14, con: 10, int: 10, wis: 8, cha: 8 },
    saveProficiencies: ["dex"],
    attacks: [SCIMITAR, SHORTBOW],
    cr: "1/4",
  },
} as unknown as MonsterDefinition;

const ENTRY = {
  entry: {
    id: "e-goblin",
    kind: "monster",
    name: "Goblin",
    facets: { size: "small", type: "humanoid" },
    body: {
      meta: { subtype: "goblinoid", alignment: "neutral evil" },
      traits: [{ name: "Nimble Escape", text: "Disengage or Hide as a bonus action." }],
      actions: [
        { name: "Scimitar", text: "Melee Weapon Attack: +4 to hit." },
        { name: "Net", text: "Ranged Weapon Attack." },
      ],
      bonusActions: [],
      reactions: [],
    },
  },
  source: null,
} as unknown as EntryResponse;

const noSend = { send: async () => undefined, disabled: false };

const card = (o: {
  combatant?: CombatantView | null;
  entry?: EntryResponse | null;
  def?: MonsterDefinition;
}) => {
  const def = o.def ?? GOBLIN;
  const c = o.combatant ?? null;
  const as: RollAs = c
    ? { combatantId: c.id, name: c.name }
    : { definitionId: def.id, name: def.name };
  return renderWith(
    companionStore("dm"),
    <StatBlockView
      def={def}
      combatant={c}
      hp={c ? { cur: 4, max: 7 } : null}
      ac={c ? 15 : null}
      entry={o.entry ?? null}
      ctx={{ as, ...noSend }}
      footer={null}
    />,
  );
};

const GOBLIN_ROW = companionStore("dm").records.combatant?.goblin as CombatantView;
const text = (html: string) => html.replace(/<[^>]+>/g, "");
const count = (html: string, s: string) => html.split(s).length - 1;

describe("FR-KIT-100 statblock registered", () => {
  test("FR-KIT-100 statblock registered (DM yes, player no): ent.statblock “Stat block”, closed by default and on reload, launcher order 31 after Creatures, 300×440 / useful 300×360 / min 280×240 top-left dx 56", () => {
    const def = dmWindows.get(STATBLOCK_KIND);
    expect(def).toMatchObject({
      title: "Stat block",
      clients: ["dm"],
      defaultSize: { w: 300, h: 440 },
      usefulSize: { w: 300, h: 360 },
      minSize: { w: 280, h: 240 },
      minOpenH: 360,
      defaultPosition: { anchor: "top-left", dx: 56 },
      restoreOpen: false,
    });
    expect(def?.defaultOpen).toBeFalsy();
    expect(def?.launcher).toMatchObject({ label: "Stat block", order: 31 });
    expect(dmWindows.get("ent.creatures")?.launcher?.order).toBe(30);
    expect(PLAYER_REGISTRY).not.toMatch(/statblock|statBlock|Stat block/);
  });
});

describe("FR-KIT-101 openers", () => {
  const token = (o: Partial<TokenRecord>) =>
    ({
      id: "t1",
      definitionId: "d-goblin",
      characterId: null,
      ownerPlayerId: null,
      ...o,
    }) as TokenRecord;

  test("FR-KIT-101 openers: Initiative ⋯ on monster rows only (bound to the row); token menu Stat block on every monster token; double-click after the companion card", () => {
    expect(rowTarget(GOBLIN_ROW)).toEqual({ definitionId: "d-goblin", combatantId: "goblin" });
    const mira = companionStore("dm").records.combatant?.mira as CombatantView;
    expect(rowTarget(mira)).toBeNull();
    // The token menu (FR-CMP-22 amended): monster tokens, imported or custom; never a PC's.
    expect(menuFor(token({})).map((e) => e.id)).toContain("cmp.statblock");
    expect(menuFor(token({ definitionId: "custom-1" })).map((e) => e.id)).toContain(
      "cmp.statblock",
    );
    expect(menuFor(token({ characterId: "ch-mira" })).map((e) => e.id)).not.toContain(
      "cmp.statblock",
    );
    // Double-click: a monster token → the stat block; an owned companion keeps its card.
    expect(doubleClickFor(token({}))?.id).toBe("ent.statblock");
    expect(doubleClickFor(token({ characterId: "ch-mira" }))).toBeNull();
    expect(doubleClickFor(token({ ownerPlayerId: "p1" }))?.id).toBe("charx.companion-card");
  });

  test("FR-KIT-101 openers: a token bound to a monster combatant of the running fight opens bound; otherwise its definition", () => {
    const store = companionStore("dm");
    const combatant = { ...store.records.combatant };
    combatant.goblin = { ...(combatant.goblin as object), tokenId: "t1" };
    const bound = { ...store, records: { ...store.records, combatant } } as RecordStore;
    expect(tokenTarget(bound, token({}))).toEqual({
      definitionId: "d-goblin",
      combatantId: "goblin",
    });
    expect(tokenTarget(store, token({}))).toEqual({ definitionId: "d-goblin" });
    expect(tokenTarget(undefined, token({}))).toEqual({ definitionId: "d-goblin" });
  });

  test("FR-KIT-101 openers: the compendium's monster entry offers Open at the table (cmp-statblock-open, in cmp-entry-actions); the shared view adds none for players", async () => {
    const { EntryActions } = await import("../../compendium/EntryActions");
    const data = {
      ...ENTRY,
      definition: { id: "d-goblin", statBlock: GOBLIN.statBlock },
    } as EntryResponse;
    const dmHtml = renderWith(
      companionStore("dm"),
      <EntryView
        data={data}
        viewer="dm"
        actions={<EntryActions api={{} as never} data={data} openAtTable={() => {}} />}
      />,
    );
    const actions = dmHtml.slice(dmHtml.indexOf('data-testid="cmp-entry-actions"'));
    expect(actions).toMatch(/data-testid="cmp-statblock-open" data-record-id="d-goblin"/);
    expect(text(dmHtml)).toContain("Open at the table");
    const playerHtml = renderWith(companionStore("p1"), <EntryView data={data} viewer="player" />);
    expect(playerHtml).not.toContain("cmp-statblock-open");
  });
});

describe("FR-KIT-102 reused", () => {
  test("FR-KIT-102 reused: one window, `ent.statblock:main`; opening another creature replaces the content", () => {
    const a: StatBlockTarget = { definitionId: "d-goblin", combatantId: "goblin" };
    const b: StatBlockTarget = { definitionId: "d-wolf", entryId: "e-wolf" };
    useStatBlockTarget.getState().show(a);
    useStatBlockTarget.getState().show(b);
    expect(useStatBlockTarget.getState().target).toEqual(b);
    // The window title stays "Stat block"; the name heads the body.
    expect(dmWindows.get(STATBLOCK_KIND)?.title).toBe("Stat block");
    expect(card({})).toMatch(/data-testid="ent-statblock-name"[^>]*>Goblin</);
  });
});

describe("FR-KIT-103 card", () => {
  test("FR-KIT-103 card: name, type line, AC · HP (max + formula) · Speed, six abilities with Check / Save buttons, attack rows with three buttons, no combat chip unbound", () => {
    const html = card({});
    expect(html).toContain('data-slot="statblock"');
    expect(html).not.toContain("ent-statblock-combat");
    expect(text(html)).toContain("Small humanoid");
    const core = html.slice(
      html.lastIndexOf("<", html.indexOf('data-testid="ent-statblock-core"')),
    );
    expect(core).toContain('data-slot="statblock-core"');
    expect(text(core)).toMatch(/^AC 15HP 7 \(2d6\)Speed 30 ft/);
    expect(count(html, 'data-testid="ent-statblock-ability"')).toBe(6);
    for (const a of ["str", "dex", "con", "int", "wis", "cha"]) {
      expect(html).toContain(`data-testid="ent-statblock-ability" data-value="${a}"`);
      expect(html).toMatch(new RegExp(`data-testid="ent-statblock-roll-check" data-value="${a}"`));
      expect(html).toMatch(new RegExp(`data-testid="ent-statblock-roll-save" data-value="${a}"`));
    }
    // Dex +2 check, Save +4 (proficient, CR 1/4 → +2).
    expect(text(html)).toContain("Save +4");
    expect(count(html, 'data-testid="ent-statblock-attack"')).toBe(2);
    expect(html).toMatch(/data-testid="ent-statblock-attack" data-record-id="a-scim"/);
    // The kit's attack row: the name, then the muted line on its own, then the buttons.
    expect(html).toMatch(
      /data-slot="statblock-entry-name"[^>]*>Scimitar<\/div><div class="text-muted-foreground"><span data-testid="ent-statblock-attack-line"[^>]*>\+4 · 1d6\+2 slashing<\/span><\/div><div class="[^"]*\bmt-1\b[^"]*"><button[^>]*data-testid="ent-statblock-roll-attack"/,
    );
    for (const id of ["attack", "damage", "both"]) {
      expect(count(html, `data-testid="ent-statblock-roll-${id}"`)).toBe(2);
    }
    expect(html).toContain('data-slot="statblock-attack"');
  });

  test("FR-KIT-103 card compact for §7.3's useful 300 × 360 (walkthrough F2): the modifier (Check) beside the score as the kit's “8 −1”, a small Save line with column spacing, tighter gaps", () => {
    const html = card({});
    const str = html.slice(html.indexOf('data-testid="ent-statblock-ability" data-value="str"'));
    expect(str).toMatch(
      /<span class="flex items-baseline justify-center gap-1"><b data-slot="statblock-score"[^>]*>8<\/b><button[^>]*data-testid="ent-statblock-roll-check"/,
    );
    expect(str).toMatch(
      /class="[^"]*h-4[^"]*text-\[11px\][^"]*"[^>]*data-testid="ent-statblock-roll-save"/,
    );
    expect(html).toMatch(/data-slot="statblock-abilities" class="[^"]*gap-x-1\.5[^"]*py-0\.5/);
    expect(html).toMatch(/data-slot="statblock" class="[^"]*space-y-1"/);
  });

  test("FR-KIT-103 card: with the compendium entry, the full type line and the traits / other actions as collapsible sections (the attacks keep their rows)", () => {
    const html = card({ entry: ENTRY });
    expect(text(html)).toContain("Small humanoid (goblinoid), neutral evil");
    expect(html).toMatch(
      /<details[^>]*data-testid="ent-statblock-section" data-slot="statblock-section" data-value="Traits"/,
    );
    expect(html).toMatch(
      /data-testid="ent-statblock-section" data-slot="statblock-section" data-value="Actions"/,
    );
    expect(text(html)).toContain("Nimble Escape.");
    expect(text(html)).toContain("Net.");
    // The Scimitar action is the attack row's, not repeated in Actions.
    expect(count(text(html), "Scimitar")).toBe(1);
  });

  test("FR-KIT-103 card: bound, the In combat chip and the HP bar with cur / max; the empty state copy", () => {
    const html = card({ combatant: GOBLIN_ROW });
    expect(html).toMatch(/data-testid="ent-statblock-combat" data-record-id="goblin"/);
    expect(html).toMatch(/data-testid="ent-statblock-hp"[^>]*data-slot="kit-hpbar"/);
    expect(text(html)).toContain("4 / 7");
    expect(EMPTY_TEXT).toBe("Pick a creature: Initiative ⋯, a token, or the compendium");
    const none = card({
      def: {
        ...GOBLIN,
        statBlock: { ...GOBLIN.statBlock, abilities: undefined },
      } as MonsterDefinition,
    });
    // FR-KIT-106: a definition without abilities shows no grid.
    expect(none).not.toContain("ent-statblock-abilities");
  });

  test("FR-KIT-103 type line from what is known", () => {
    expect(typeLine({ size: "small" })).toBe("Small");
    expect(typeLine({ size: "small", type: "humanoid", subtype: "goblinoid" })).toBe(
      "Small humanoid (goblinoid)",
    );
    expect(typeLine({ size: "large", type: "beast", alignment: "unaligned" })).toBe(
      "Large beast, unaligned",
    );
  });
});

describe("FR-KIT-104 binding", () => {
  const store = companionStore("dm");
  const target = { definitionId: "d-goblin", combatantId: "goblin" };
  const patch = (c: Record<string, unknown>, enc: Record<string, unknown> = {}) =>
    ({
      ...store,
      records: {
        ...store.records,
        encounter: { e1: { ...(store.records.encounter?.e1 as object), ...enc } },
        combatant: { ...store.records.combatant, goblin: { ...GOBLIN_ROW, ...c } },
      },
    }) as RecordStore;

  test("FR-KIT-104 binding: bound to an active combatant of the started encounter; falls back to the definition when it is removed, dismissed, gone or the encounter ends", () => {
    expect(boundCombatant(store, target)?.id).toBe("goblin");
    expect(boundCombatant(store, { definitionId: "d-goblin" })).toBeNull();
    expect(boundCombatant(store, null)).toBeNull();
    expect(boundCombatant(patch({ removed: true }), target)).toBeNull();
    expect(boundCombatant(patch({ active: false }), target)).toBeNull();
    expect(boundCombatant(patch({}, { status: "ended" }), target)).toBeNull();
    const gone = { ...store, records: { ...store.records, combatant: {} } } as RecordStore;
    expect(boundCombatant(gone, target)).toBeNull();
  });
});

describe("FR-KIT-105 attack routing", () => {
  const bound: RollAs = { combatantId: "goblin", name: "Goblin" };
  const plain: RollAs = { definitionId: "d-goblin", name: "Goblin" };
  const names = (s: { name: string }[]) => s.map((x) => x.name);

  test("FR-KIT-105 attack routing (stub send: names + payloads): bound → cbt.attack {rolls: toHit} / cbt.rollDamage / cbt.attack with the attack id", () => {
    expect(attackSends(bound, SCIMITAR, "a-scim", "toHit", { mode: "advantage" })).toEqual([
      {
        name: "cbt.attack",
        payload: { attackerId: "goblin", mode: "advantage", rolls: "toHit", attackId: "a-scim" },
      },
    ]);
    expect(attackSends(bound, SCIMITAR, "a-scim", "damage", { mode: "normal" })).toEqual([
      { name: "cbt.rollDamage", payload: { attackerId: "goblin", attackId: "a-scim" } },
    ]);
    expect(attackSends(bound, SCIMITAR, undefined, "both", { mode: "normal" })).toEqual([
      { name: "cbt.attack", payload: { attackerId: "goblin", mode: "normal" } },
    ]);
    // Physical dice: the entries as combat takes them (to-hit + base part).
    const manual = [{ diceTotal: 15 }, { diceTotal: 4 }];
    expect(
      attackSends(bound, SCIMITAR, "a-scim", "both", { mode: "normal", manual })[0]?.payload,
    ).toMatchObject({ manual });
  });

  test("FR-KIT-105 attack routing (stub send): definition → plain dice.roll as the creature, labelled, always `public: false` (ADR-0024 ruling: DM-only even with the DM's switch or preset on); Attack + damage = to-hit then damage (two entries, no card); never a new intent", () => {
    const both = attackSends(plain, SCIMITAR, "a-scim", "both", {
      mode: "disadvantage",
      manual: [{ diceTotal: 9 }, { diceTotal: 5 }],
      public: true,
    });
    expect(both).toEqual([
      {
        name: "dice.roll",
        payload: {
          expression: "1d20+4",
          mode: "disadvantage",
          category: "attack",
          label: "Goblin — Scimitar attack",
          actor: { entityId: "d-goblin" },
          manual: { diceTotal: 9 },
          public: false,
        },
      },
      {
        name: "dice.roll",
        payload: {
          expression: "1d6+2",
          mode: "normal",
          category: "damage",
          label: "Goblin — Scimitar damage",
          actor: { entityId: "d-goblin" },
          manual: { diceTotal: 5 },
          public: false,
        },
      },
    ]);
    expect(names(attackSends(plain, SCIMITAR, undefined, "toHit", { mode: "normal" }))).toEqual([
      "dice.roll",
    ]);
    const dmg = attackSends(plain, SCIMITAR, undefined, "damage", { mode: "normal" });
    expect(dmg.map((s) => s.payload.category)).toEqual(["damage"]);
    // Extra damage parts ride in the one damage expression.
    const flame = { ...SCIMITAR, extraDamage: [{ damage: "1d6", type: "fire" as const }] };
    expect(
      attackSends(plain, flame, undefined, "damage", { mode: "normal" })[0]?.payload.expression,
    ).toBe("1d6+2+1d6");
    const all = ["toHit", "damage", "both"].flatMap((a) =>
      [bound, plain].flatMap((as) =>
        names(attackSends(as, SCIMITAR, "a-scim", a as "toHit", { mode: "normal" })),
      ),
    );
    expect([...new Set(all)].sort()).toEqual(["cbt.attack", "cbt.rollDamage", "dice.roll"]);
  });
});

describe("FR-KIT-106 ability rolls", () => {
  test("FR-KIT-106 ability rolls: bound → cbt.rollAbility {combatantId, kind, ability}; definition → dice.roll ability-check / saving-throw as the creature", () => {
    expect(
      abilitySend({ combatantId: "goblin", name: "Goblin" }, "save", "dex", 4, { mode: "normal" }),
    ).toEqual({
      name: "cbt.rollAbility",
      payload: { combatantId: "goblin", kind: "save", ability: "dex", mode: "normal" },
    });
    const plain: RollAs = { definitionId: "d-goblin", name: "Goblin" };
    expect(abilitySend(plain, "check", "str", -1, { mode: "advantage" })).toEqual({
      name: "dice.roll",
      payload: {
        expression: "1d20-1",
        mode: "advantage",
        category: "ability-check",
        label: "Goblin — Strength check",
        actor: { entityId: "d-goblin" },
        public: false,
      },
    });
    expect(abilitySend(plain, "save", "dex", 4, { mode: "normal" }).payload).toMatchObject({
      expression: "1d20+4",
      category: "saving-throw",
      label: "Goblin — Dexterity save",
    });
  });
});

describe("FR-KIT-107 dm only", () => {
  const root = fileURLToPath(new URL("../../../../../../", import.meta.url));
  const files = (dir: string): string[] =>
    readdirSync(dir).flatMap((n) => {
      const p = join(dir, n);
      return statSync(p).isDirectory() ? files(p) : /\.tsx?$/.test(n) ? [p] : [];
    });

  test("FR-KIT-107 dm only, boundary test: no player or shared client file imports the statblock module; no server or shared code knows the window (0 B: no record, intent or event)", () => {
    const clientFiles = [
      ...files(join(root, "src/client/player")),
      ...files(join(root, "src/client/common")),
    ];
    const importers = clientFiles.filter((f) =>
      /from\s+"[^"]*entities\/statblock[^"]*"/.test(readFileSync(f, "utf8")),
    );
    expect(importers).toEqual([]);
    const wire = [...files(join(root, "src/server")), ...files(join(root, "src/shared"))].filter(
      (f) => readFileSync(f, "utf8").includes(STATBLOCK_KIND),
    );
    expect(wire).toEqual([]);
  });

  test("FR-KIT-107 dm only: the player registry has no stat block window or launcher; players get no token menu (the DM map owns it)", () => {
    expect(PLAYER_REGISTRY).not.toContain(STATBLOCK_KIND);
    const playerMap = files(join(root, "src/client/player")).filter((f) =>
      /token-menu|cmp-token-menu-statblock|cbt-init-row-statblock|cmp-statblock-open/.test(
        readFileSync(f, "utf8"),
      ),
    );
    expect(playerMap).toEqual([]);
  });
});
