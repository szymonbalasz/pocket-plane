// Sprint 8 CB3 (party-board §13, FR-PARTY-51–56): the Party status rows per viewer as a pure model
// and a static render over a fake sync store. Player 1 = Mira + Brakka, Player 2 = Thorn; Owlbear
// (Mira's present pet), Fire Elemental (Mira's summon), Goblin 2 (released: no owner), Wolf
// (hostile), Spy (Brakka's, hidden), Goblin + Elite (monsters). Layout (FR-PARTY-58, FR-SHELL-141):
// `e2e/useful-size.e2e.ts`; clicks and live updates: `e2e/cb-party.e2e.ts`.
import { afterEach, describe, expect, test } from "bun:test";
import type { You } from "@shared/protocol/frames";
import { lazyAfterSnapshot } from "@shared/protocol/lazy";
import { emptyStore } from "@shared/protocol/store";
import { TooltipProvider } from "@ui/components/ui/overlays";
import { SyncContext, type SyncState } from "@ui/sync/store";
import { renderToStaticMarkup } from "react-dom/server";
import { createStore } from "zustand";
import { createWindowRegistry } from "../play-shell/registry";
import { ShellProvider } from "../play-shell/ShellContext";
import { PartySummaryWindow } from "./Summary";
import {
  EMPTY_PARTY,
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
      <ShellProvider registry={createWindowRegistry(you.role === "dm" ? "dm" : "player", [])}>
        <TooltipProvider delayDuration={0} skipDelayDuration={0}>
          <PartySummaryWindow />
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

describe("Party status (FR-PARTY-51–56)", () => {
  test("FR-PARTY-51 rows: own first then by name (players), by name (DM); drafts out where known; companions under owners; never a monster, released, hostile or hidden companion", () => {
    const dm = partySummary(inputs.dm, viewerOf(DM));
    expect(dm.pcs.map((r) => r.name)).toEqual(["Brakka", "Mira", "Thorn"]);
    expect(dm.companions.map((g) => [g.characterName, g.rows.map((r) => r.name)])).toEqual([
      ["Mira", ["Fire Elemental", "Owlbear"]],
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
      const names = s.companions.flatMap((g) => g.rows.map((r) => r.name));
      for (const never of ["Goblin", "Goblin 2", "Wolf", "Spy", "Elite Goblin Warrior"]) {
        expect(names).not.toContain(never);
      }
    }
    // Static render, DM: rows by name, companions under Mira; Thorn hidden from players → eye-off.
    const html = render(DM, inputs.dm);
    expect(ids(html, "party-summary-row")).toEqual(["brakka", "mira", "thorn"]);
    expect(ids(html, "party-summary-group")).toEqual(["mira"]);
    expect(ids(html, "party-summary-companion")).toEqual(["c-fe", "owl"]);
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
    expect(ids(render(DM, hostile), "party-summary-companion")).toEqual(["owl"]);
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
    // Owner: numbers + AC (pet row: the combatant's in a fight; summon: its card).
    expect(p1.companions[0]?.rows.map((r) => [r.name, r.hp && summaryHpValue(r), r.ac])).toEqual([
      ["Fire Elemental", "80/102", 13],
      ["Owlbear", "40/59", 13],
    ]);
    // Player 2: the band only, no AC.
    const p2 = partySummary(inputs.p2, viewerOf(P2));
    expect(p2.companions[0]?.rows.map((r) => [r.name, summaryHpValue(r), r.ac])).toEqual([
      ["Fire Elemental", "healthy", null],
      ["Owlbear", "healthy", null],
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
    expect(html).toContain('data-testid="party-summary-hp" data-value="healthy"');
  });

  test("FR-PARTY-51 hidden companion: another player sees a pet row only while it holds a visible combatant or token for it", () => {
    const owl = (s: ReturnType<typeof partySummary>) =>
      s.companions.flatMap((g) => g.rows.map((r) => r.id)).includes("owl");
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
