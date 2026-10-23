// Sprint 8 CB3 + sprint 9 PM2 (party-board §13, FR-PARTY-51–56, -61, -65): the Party status tab's
// rows per viewer as a pure model and a static render over a fake sync store. Player 1 = Mira +
// Brakka, Player 2 = Thorn; Owlbear (Mira's present pet), Fire Elemental (Mira's summon), Goblin 2
// (released: no owner), Wolf (hostile), Spy (Brakka's, hidden), Goblin + Elite (monsters); out of a
// fight: Owlbear hidden while present, Drake (Brakka's, shown), Pony (Mira's, prepared), Hawk (Ivo's,
// a draft PC: "Other companions"). Layout (FR-PARTY-58, -63): `e2e/useful-size.e2e.ts`; clicks and
// live updates: `e2e/cb-party.e2e.ts`, `e2e/party-manager.e2e.ts`.
import { afterEach, describe, expect, test } from "bun:test";
import type { You } from "@shared/protocol/frames";
import { lazyAfterSnapshot } from "@shared/protocol/lazy";
import { emptyStore } from "@shared/protocol/store";
import { TooltipProvider } from "@ui/components/ui/overlays";
import { SyncContext, type SyncState } from "@ui/sync/store";
import { renderToStaticMarkup } from "react-dom/server";
import { createStore } from "zustand";
import { COMPANION_CARD_KIND } from "../combat-tracker/companion-card-request";
import { createWindowRegistry, defineWindow } from "../play-shell/registry";
import { ShellProvider } from "../play-shell/ShellContext";
import { StatusTab } from "./StatusTab";
import {
  EMPTY_PARTY,
  OTHER_COMPANIONS,
  type PartySummary,
  partySummary,
  type SummaryInput,
  summaryHpValue,
  summaryTip,
} from "./summary-logic";

const DM: You = { campaignId: "c", role: "dm", playerId: null };
const P1: You = { campaignId: "c", role: "player", playerId: "p1" };
const P2: You = { campaignId: "c", role: "player", playerId: "p2" };
const viewerOf = (y: You) => ({ role: y.role, playerId: y.playerId });

const at = {
  campaignId: "c",
  tokenShape: null,
  derivedFromId: null,
  createdAt: "t",
  updatedAt: "t",
};
const block = (ac: number, hpMax: number, className: string) => ({
  size: "medium",
  ac,
  hpMax,
  initBonus: 1,
  attacks: [],
  level: 3,
  className,
});
/** A character as the DM and its owner hold it. */
const full = (id: string, name: string, owner: string, hp: number, ac: number, max: number) => ({
  ...at,
  id,
  kind: "character",
  name,
  portraitAssetId: null,
  statBlock: block(ac, max, "Fighter"),
  ownerPlayerId: owner,
  hpCurrent: hp,
  tempHp: 0,
  deathSuccesses: 0,
  deathFailures: 0,
});
/** The other-player whitelist (ADR-0063). */
const redacted = (c: ReturnType<typeof full>) => ({
  id: c.id,
  kind: "character",
  name: c.name,
  portraitAssetId: null,
  ownerPlayerId: c.ownerPlayerId,
  down: c.hpCurrent === 0,
  level: 3,
  className: "Fighter",
  species: null,
  deathState: null,
  hpCurrent: c.hpCurrent,
  hpMax: c.statBlock.hpMax,
  tempHp: c.tempHp,
  ac: c.statBlock.ac,
});
const mira = full("mira", "Mira", "p1", 12, 16, 12);
const brakka = full("brakka", "Brakka", "p1", 35, 18, 55);
const thorn = { ...full("thorn", "Thorn", "p2", 10, 15, 10), tempHp: 5 };
const draft = full("ivo", "Ivo", "p1", 8, 12, 8);
const sheets = [{ id: "s-ivo", entityId: "ivo", status: "draft" }];

const owlbearDm = {
  ...at,
  id: "owl",
  kind: "monster",
  name: "Owlbear",
  portraitAssetId: null,
  statBlock: { size: "large", ac: 13, hpMax: 59, initBonus: 1, attacks: [], cr: "3" },
  ownerPlayerId: "p1",
  hpCurrent: 45,
  companionOf: "mira",
  turnMode: "after-owner",
  petPresent: true,
};
const { derivedFromId: _d, petPresent: _p, ...owlbearOwner } = owlbearDm;
const owlbearOther = {
  id: "owl",
  kind: "monster",
  name: "Owlbear",
  portraitAssetId: null,
  ownerPlayerId: "p1",
  companionOf: "mira",
  band: "healthy",
};
const goblinDef = {
  ...owlbearDm,
  id: "gob-def",
  name: "Goblin",
  ownerPlayerId: null,
  companionOf: null,
  petPresent: false,
  hpCurrent: null,
};

const enc = {
  id: "e1",
  status: "started",
  turnCombatantId: "c-thorn",
  playerTurnCombatantId: "c-thorn",
};
const pc = (id: string, entityId: string, name: string, hidden = false) => ({
  id,
  encounterId: "e1",
  kind: "pc",
  entityId,
  name,
  active: true,
  removed: false,
  hidden,
});
const mon = (id: string, name: string, o: object = {}) => ({
  id,
  encounterId: "e1",
  kind: "monster",
  entityId: `def-${id}`,
  name,
  imageAssetId: null,
  active: true,
  removed: false,
  hidden: false,
  ownerHidden: false,
  pet: false,
  ownerCharacterId: null,
  ownerPlayerId: null,
  hpCurrent: 7,
  hpMax: 7,
  card: null,
  ...o,
});
const elemental = mon("c-fe", "Fire Elemental", {
  ownerCharacterId: "mira",
  ownerPlayerId: "p1",
  hpCurrent: 80,
  hpMax: 102,
  card: { ac: 13 },
});
/** The DM's combatants: PCs (Thorn hidden), the pet in the fight, a summon, monsters. */
const combatantsDm = [
  pc("c-mira", "mira", "Mira"),
  pc("c-brakka", "brakka", "Brakka"),
  pc("c-thorn", "thorn", "Thorn", true),
  mon("c-owl", "Owlbear", {
    entityId: "owl",
    pet: true,
    ownerCharacterId: "mira",
    ownerPlayerId: "p1",
    hpCurrent: 40,
    hpMax: 59,
    card: { ac: 13 },
  }),
  elemental,
  mon("c-gob2", "Goblin 2"), // released: no owner
  mon("c-wolf", "Wolf", { side: "enemy" }), // hostile
  mon("c-spy", "Spy", { ownerCharacterId: "brakka", ownerPlayerId: "p1", hidden: true }),
  mon("c-elite", "Elite Goblin Warrior", { hidden: true }),
];
/** Player views: the owner's companion with numbers, others a band; no hidden rows. */
const ownerView = (c: ReturnType<typeof mon>) => {
  const { hidden: _h, ownerHidden: _o, active: _a, ...rest } = c;
  return rest;
};
const otherView = (c: ReturnType<typeof mon>) => ({
  id: c.id,
  encounterId: "e1",
  kind: "monster",
  name: c.name,
  imageAssetId: null,
  removed: false,
  band: "healthy",
  ...(c.ownerCharacterId
    ? { ownerCharacterId: c.ownerCharacterId, ownerPlayerId: c.ownerPlayerId }
    : {}),
});
const pcView = (c: ReturnType<typeof pc>) => {
  const { hidden: _h, active: _a, ...rest } = c;
  return rest;
};
const poisoned = {
  id: "fx1",
  kind: "condition",
  condition: "poisoned",
  level: null,
  label: null,
  targetCombatantId: null,
  targetCharacterId: "mira",
  encounterId: "e1",
  endsRound: null,
};
const secretHex = {
  ...poisoned,
  id: "fx2",
  kind: "custom",
  condition: null,
  label: "Hex",
  targetCharacterId: "thorn",
  secret: true,
};

const inputs: Record<"dm" | "p1" | "p2", SummaryInput> = {
  dm: {
    entities: [mira, brakka, thorn, draft, owlbearDm, goblinDef],
    combatants: combatantsDm,
    encounters: [enc],
    effects: [poisoned, secretHex] as never,
    sheets,
    tokens: [],
  },
  p1: {
    entities: [mira, brakka, redacted(thorn), draft, owlbearOwner],
    combatants: [
      pcView(pc("c-mira", "mira", "Mira")),
      pcView(pc("c-brakka", "brakka", "Brakka")),
      ownerView(combatantsDm[3] as ReturnType<typeof mon>),
      ownerView(elemental),
      otherView(mon("c-gob2", "Goblin 2")),
      otherView(mon("c-wolf", "Wolf")),
    ],
    encounters: [{ id: "e1", status: "started", playerTurnCombatantId: null }],
    effects: [poisoned] as never,
    sheets,
    tokens: [],
  },
  p2: {
    // Ivo is a draft; Player 2 can't know (no sheet), so it lists like any PC.
    entities: [redacted(mira), redacted(brakka), thorn, redacted(draft), owlbearOther],
    combatants: [
      pcView(pc("c-mira", "mira", "Mira")),
      pcView(pc("c-brakka", "brakka", "Brakka")),
      pcView(pc("c-thorn", "thorn", "Thorn")),
      otherView(combatantsDm[3] as ReturnType<typeof mon>),
      otherView(elemental),
      otherView(mon("c-wolf", "Wolf")),
    ],
    encounters: [{ id: "e1", status: "started", playerTurnCombatantId: "c-thorn" }],
    effects: [poisoned] as never,
    sheets: [],
    tokens: [],
  },
};

const byId = (rows: readonly unknown[]) =>
  Object.fromEntries(rows.map((r) => [(r as { id: string }).id, r]));

const cardWindow = defineWindow({
  kind: COMPANION_CARD_KIND,
  title: "Companion",
  clients: ["dm", "player"],
  defaultSize: { w: 320, h: 360 },
  minSize: { w: 280, h: 240 },
  defaultPosition: { anchor: "top-left", dx: 56 },
  component: () => null,
});

function render(you: You, input: SummaryInput, live = true) {
  const store = createStore<SyncState>()(
    () =>
      ({
        state: live ? "live" : "reconnecting",
        everLive: true,
        store: {
          ...emptyStore(),
          you,
          records: {
            entity: byId(input.entities),
            combatant: byId(input.combatants),
            encounter: byId(input.encounters),
            effect: byId(input.effects),
            "creature-sheet": byId(input.sheets),
            token: byId(input.tokens),
            scene: byId(input.scenes ?? []),
            player: {
              p1: { id: "p1", campaignId: "c", name: "Player 1", color: "#19b98a" },
              p2: { id: "p2", campaignId: "c", name: "Player 2", color: "#56b4e9" },
            },
          },
        },
        lazy: lazyAfterSnapshot(1),
        connection: { load: () => null, retryLoad: () => null },
      }) as unknown as SyncState,
  );
  const g = globalThis as { document?: unknown };
  g.document = { title: "", hidden: false };
  return renderToStaticMarkup(
    <SyncContext.Provider value={store}>
      <ShellProvider
        registry={createWindowRegistry(you.role === "dm" ? "dm" : "player", [cardWindow])}
      >
        <TooltipProvider delayDuration={0} skipDelayDuration={0}>
          <StatusTab />
        </TooltipProvider>
      </ShellProvider>
    </SyncContext.Provider>,
  );
}

afterEach(() => {
  delete (globalThis as { document?: unknown }).document;
});

/** `data-record-id`s of the elements with this test id, in document order. */
const ids = (html: string, testId: string) =>
  [...html.matchAll(new RegExp(`data-testid="${testId}" data-record-id="([^"]+)"`, "g"))].map(
    (m) => m[1],
  );

/** Every companion row of a model: under the PCs in order, then "Other companions". */
const comps = (s: PartySummary) => [...s.pcs.flatMap((p) => p.companions), ...s.others];
/** Per PC: [PC name, its companions' names]. */
const tree = (s: PartySummary) => s.pcs.map((p) => [p.name, p.companions.map((c) => c.name)]);

describe("Party status (FR-PARTY-51–56)", () => {
  test("FR-PARTY-51 rows: own first then by name (players), by name (DM); drafts out where known; companions under owners; never a monster, released, hostile or hidden companion", () => {
    const dm = partySummary(inputs.dm, viewerOf(DM));
    expect(dm.pcs.map((r) => r.name)).toEqual(["Brakka", "Mira", "Thorn"]);
    expect(tree(dm)).toEqual([
      ["Brakka", []],
      ["Mira", ["Fire Elemental", "Owlbear"]],
      ["Thorn", []],
    ]);
    const p1 = partySummary(inputs.p1, viewerOf(P1));
    expect(p1.pcs.map((r) => [r.name, r.own])).toEqual([
      ["Brakka", true],
      ["Mira", true],
      ["Thorn", false],
    ]);
    const p2 = partySummary(inputs.p2, viewerOf(P2));
    expect(p2.pcs.map((r) => r.name)).toEqual(["Thorn", "Brakka", "Ivo", "Mira"]);
    for (const s of [dm, p1, p2]) {
      const names = comps(s).map((r) => r.name);
      for (const never of ["Goblin", "Goblin 2", "Wolf", "Spy", "Elite Goblin Warrior"]) {
        expect(names).not.toContain(never);
      }
    }
    // Static render, DM: rows by name, companions under Mira; Thorn hidden from players → eye-off.
    const html = render(DM, inputs.dm);
    expect(ids(html, "party-summary-row")).toEqual(["brakka", "mira", "thorn"]);
    expect(ids(html, "party-companion-group")).toEqual(["brakka", "mira", "thorn"]);
    expect(ids(html, "party-companion-row")).toEqual(["c-fe", "owl"]);
    expect(html.match(/data-testid="party-summary-hidden"/g)).toHaveLength(1);
    expect(dm.pcs.find((r) => r.name === "Thorn")?.hidden).toBe(true);
    // Player 1: own Mira and Brakka on top, Thorn below; no eye-off for players.
    const h1 = render(P1, inputs.p1);
    expect(ids(h1, "party-summary-row")).toEqual(["brakka", "mira", "thorn"]);
    expect(h1).not.toContain("party-summary-hidden");
    // A companion that turns hostile (owner cleared) leaves at once.
    const hostile = {
      ...inputs.dm,
      combatants: combatantsDm.map((c) =>
        c.id === "c-fe" ? { ...c, ownerCharacterId: null, ownerPlayerId: null, side: "enemy" } : c,
      ),
    };
    expect(ids(render(DM, hostile), "party-companion-row")).toEqual(["owl"]);
  });

  test("FR-PARTY-52 FR-PARTY-53 figures: HP, temp HP and stored AC for every PC; companions numbers for DM / owner, band for others; secret effects never", () => {
    const p1 = partySummary(inputs.p1, viewerOf(P1));
    const thornRow = p1.pcs.find((r) => r.id === "thorn");
    expect(thornRow).toMatchObject({
      hp: { current: 10, max: 10 },
      temp: 5,
      ac: 15,
      canOpen: false,
    });
    expect(summaryTip(thornRow as never)).toBe("Thorn · HP 10 / 10 + 5 temp · AC 15");
    const miraRow = p1.pcs.find((r) => r.id === "mira");
    expect(miraRow).toMatchObject({ canOpen: true, ac: 16 });
    expect(summaryTip(miraRow as never)).toBe("Mira · HP 12 / 12 · AC 16 · Poisoned");
    // Owner: numbers + Card (pet row: the combatant's in a fight; summon: its own).
    expect(comps(p1).map((r) => [r.name, r.hp && summaryHpValue(r), r.card])).toEqual([
      ["Fire Elemental", "80/102", true],
      ["Owlbear", "40/59", true],
    ]);
    // Player 2: the band only, no Card.
    const p2 = partySummary(inputs.p2, viewerOf(P2));
    expect(comps(p2).map((r) => [r.name, summaryHpValue(r), r.card])).toEqual([
      ["Fire Elemental", "healthy", false],
      ["Owlbear", "healthy", false],
    ]);
    // DM: every PC opens; the secret Hex on Thorn is never an icon.
    const dm = partySummary(inputs.dm, viewerOf(DM));
    expect(dm.pcs.every((r) => r.canOpen)).toBe(true);
    expect(dm.pcs.find((r) => r.id === "thorn")?.effects).toEqual([]);
    // Markup: HP data-value, temp, AC, the condition icon and the turn marker (Thorn, DM's field).
    const html = render(P2, inputs.p2);
    expect(html).toContain('data-testid="party-summary-hp" data-value="10/10"');
    expect(html).toContain('data-testid="party-summary-temp" data-value="5"');
    expect(html).toContain('data-testid="party-summary-ac" data-value="15"');
    expect(html).toContain('data-testid="party-summary-effect" data-value="poisoned"');
    expect(html.match(/data-testid="party-summary-turn"/g)).toHaveLength(1);
    expect(html).toContain('data-testid="party-companion-band" data-value="healthy"');
    expect(html).not.toContain("party-companion-hp");
    expect(html).not.toContain("party-companion-card");
  });

  test("FR-PARTY-51 hidden companion: another player sees a pet row only while it holds a visible combatant or token for it", () => {
    const owl = (s: PartySummary) => comps(s).some((r) => r.id === "owl");
    // The DM hides the Owlbear: player 2 gets the combatant delete, keeps the pet row.
    const hidden = {
      ...inputs.p2,
      combatants: inputs.p2.combatants.filter((c) => (c as { id: string }).id !== "c-owl"),
    };
    expect(owl(partySummary(inputs.p2, viewerOf(P2)))).toBe(true);
    expect(owl(partySummary(hidden, viewerOf(P2)))).toBe(false);
    expect(render(P2, hidden)).not.toContain(">Owlbear<");
    // Out of the fight with a visible token on the active scene: listed again (band only).
    const token = {
      id: "t-owl",
      name: "Owlbear",
      ownerPlayerId: "p1",
      characterId: null,
      hidden: false,
    };
    expect(owl(partySummary({ ...hidden, tokens: [token] }, viewerOf(P2)))).toBe(true);
    // A character token of the same owner never stands in for the pet.
    const pcToken = { ...token, characterId: "mira" };
    expect(owl(partySummary({ ...hidden, tokens: [pcToken] }, viewerOf(P2)))).toBe(false);
    // The owner keeps its own pet without a combatant or token (accepted: not present, CB13).
    const ownerHidden = {
      ...inputs.p1,
      combatants: inputs.p1.combatants.filter((c) => (c as { id: string }).id !== "c-owl"),
    };
    expect(owl(partySummary(ownerHidden, viewerOf(P1)))).toBe(true);
  });

  test("FR-PARTY-56 states: no PCs → empty text; disconnected → figures muted; Dying badge at 0 HP", () => {
    expect(render(P1, { ...inputs.p1, entities: [] })).toContain(EMPTY_PARTY);
    expect(render(P1, inputs.p1, false)).toContain('data-live="false"');
    const down = {
      ...inputs.p2,
      entities: [{ ...redacted(mira), hpCurrent: 0, down: true, deathState: "dying" }],
    };
    const html = render(P2, down);
    expect(html).toContain('data-testid="party-summary-death" data-value="dying"');
    expect(html).toContain('data-value="0/12"');
  });
});

describe("Party status companions (FR-PARTY-61)", () => {
  // Out of a fight on scene s1: Owlbear's token hidden (hidden while present), Drake's shown, Pony
  // prepared (no token), Hawk owned by Ivo (a draft PC). Ivo is Player 1's.
  const scene = { id: "s1", active: true };
  const tok = (id: string, pet: { id: string; name: string }, hidden: boolean) => ({
    id,
    sceneId: "s1",
    definitionId: pet.id,
    name: pet.name,
    ownerPlayerId: "p1",
    characterId: null,
    hidden,
  });
  const pet = (id: string, name: string, owner: string, present: boolean) => ({
    ...owlbearDm,
    id,
    name,
    companionOf: owner,
    petPresent: present,
    derivedFromId: `srd-${id}`,
  });
  const owl = { ...owlbearDm, petPresent: false };
  const drake = pet("drake", "Drake", "brakka", true);
  const pony = pet("pony", "Pony", "mira", false);
  const hawk = pet("hawk", "Hawk", "ivo", false);
  const ownerOf = (p: Record<string, unknown>) => {
    const { derivedFromId: _x, petPresent: _y, ...rest } = p;
    return rest;
  };
  const otherOf = (p: { id: string; name: string; companionOf: string }) => ({
    id: p.id,
    kind: "monster",
    name: p.name,
    portraitAssetId: null,
    ownerPlayerId: "p1",
    companionOf: p.companionOf,
    band: "healthy",
  });
  const calm: Record<"dm" | "p1" | "p2", SummaryInput> = {
    dm: {
      entities: [mira, brakka, thorn, draft, owl, drake, pony, hawk],
      combatants: [],
      encounters: [],
      effects: [],
      sheets,
      tokens: [tok("t-owl", owl, true), tok("t-drake", drake, false)],
      scenes: [scene],
    },
    p1: {
      entities: [mira, brakka, redacted(thorn), draft, ...[owl, drake, pony, hawk].map(ownerOf)],
      combatants: [],
      encounters: [],
      effects: [],
      sheets,
      // Hidden tokens never reach a player.
      tokens: [tok("t-drake", drake, false)].map(({ definitionId: _d, ...t }) => t),
      scenes: [scene],
    },
    p2: {
      // FR-ENT-37: only the present Drake is sent (Owlbear's token is hidden, Pony prepared).
      entities: [redacted(mira), redacted(brakka), thorn, redacted(draft), otherOf(drake)],
      combatants: [],
      encounters: [],
      effects: [],
      sheets: [],
      tokens: [tok("t-drake", drake, false)].map(({ definitionId: _d, ...t }) => t),
      scenes: [scene],
    },
  };

  test("FR-PARTY-61 companions under owners: DM every pet (hidden one eye-off), player 1 own pets with numbers + Card, player 2 present pets with a band only (prepared and hidden-while-present absent); orphans under Other companions", () => {
    const dm = partySummary(calm.dm, viewerOf(DM));
    expect(tree(dm)).toEqual([
      ["Brakka", ["Drake"]],
      ["Mira", ["Owlbear", "Pony"]],
      ["Thorn", []],
    ]);
    expect(dm.others.map((r) => r.name)).toEqual(["Hawk"]);
    expect(comps(dm).map((r) => [r.name, r.hidden, r.hp && summaryHpValue(r), r.card])).toEqual([
      ["Drake", false, "45/59", true],
      ["Owlbear", true, "45/59", true],
      ["Pony", false, "45/59", true],
      ["Hawk", false, "45/59", true],
    ]);
    const dmHtml = render(DM, calm.dm);
    expect(ids(dmHtml, "party-companion-group")).toEqual(["brakka", "mira", "thorn"]);
    expect(ids(dmHtml, "party-companion-row")).toEqual(["drake", "owl", "pony", "hawk"]);
    expect(dmHtml.match(/data-testid="party-companion-hidden"/g)).toHaveLength(1);
    expect(dmHtml).toContain('data-testid="party-companion-other"');
    expect(dmHtml).toContain(`>${OTHER_COMPANIONS}<`);
    // Each group wraps its PC row and then its companions (indented, after the PC).
    const mira0 = dmHtml.indexOf('data-testid="party-summary-row" data-record-id="mira"');
    expect(dmHtml.indexOf('data-record-id="owl"')).toBeGreaterThan(mira0);
    expect(dmHtml.indexOf('data-record-id="thorn"')).toBeGreaterThan(
      dmHtml.indexOf('data-record-id="pony"'),
    );

    // Player 1 (owner): every own pet with numbers and Card, the hidden Owlbear without eye-off.
    const p1 = partySummary(calm.p1, viewerOf(P1));
    expect(tree(p1)).toEqual([
      ["Brakka", ["Drake"]],
      ["Mira", ["Owlbear", "Pony"]],
      ["Thorn", []],
    ]);
    expect(p1.others.map((r) => r.name)).toEqual(["Hawk"]);
    expect(comps(p1).every((r) => r.hp !== null && r.card && !r.hidden)).toBe(true);
    const h1 = render(P1, calm.p1);
    expect(ids(h1, "party-companion-card")).toEqual(["drake", "owl", "pony", "hawk"]);
    expect(h1).not.toContain("party-companion-hidden");
    expect(h1).not.toContain("party-companion-base");

    // Player 2: Player 1's present Drake with a band; no Owlbear, Pony or Hawk.
    const p2 = partySummary(calm.p2, viewerOf(P2));
    expect(tree(p2)).toEqual([
      ["Thorn", []],
      ["Brakka", ["Drake"]],
      ["Ivo", []],
      ["Mira", []],
    ]);
    expect(p2.others).toEqual([]);
    const h2 = render(P2, calm.p2);
    expect(ids(h2, "party-companion-row")).toEqual(["drake"]);
    expect(h2).toContain('data-testid="party-companion-band" data-value="healthy"');
    for (const leak of ["party-companion-hp", "party-companion-card", "Owlbear", "Pony", "Hawk"]) {
      expect(h2).not.toContain(leak);
    }
    // Player 1's Owlbear hidden while present but its row still held (in a fight, the combatant
    // gone): player 2 still doesn't list it (FR-PARTY-51's rule).
    const held = { ...calm.p2, entities: [...calm.p2.entities, otherOf(owlbearDm)] };
    expect(comps(partySummary(held, viewerOf(P2))).map((r) => r.name)).toEqual(["Drake"]);
  });

  test("FR-PARTY-62 no companions → nothing under the PCs, no empty line; no Summons footer", () => {
    const html = render(P2, { ...calm.p2, entities: [thorn] });
    expect(ids(html, "party-companion-group")).toEqual(["thorn"]);
    expect(html).not.toContain("party-companion-row");
    expect(html).not.toContain("party-companion-other");
    expect(html).not.toContain("Summons show in Initiative");
    expect(html).not.toContain("No companions");
  });
});
