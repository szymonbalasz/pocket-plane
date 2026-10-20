// Sprint 6 CP1 (PARTY §13): the Companions tab (FR-PARTY-41–46) as a static render over a fake
// sync store per viewer, and its view model: groups by owner PC, HP numbers for the DM and the
// owner (the combatant's in a fight), a band for other players, Card for DM / owner, the empty
// states and the footer, the tab strip that scrolls rather than cutting a label. Clicks (New
// pet…, Release…) and the real 340-px layout: e2e/cp-pets.e2e.ts.
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
import { PartyBoard } from "./Board";
import { type CompanionsDmParts, CompanionsTab } from "./Companions";
import {
  companionGroups,
  EMPTY_COMPANIONS,
  EMPTY_COMPANIONS_PLAYER,
  fightRunning,
  PARTY_TABS,
} from "./logic";
import { tabKeyOf } from "./open-tab";
import { partyMemory } from "./seen";

const DM: You = { campaignId: "c", role: "dm", playerId: null };
const P1: You = { campaignId: "c", role: "player", playerId: "p1" };
const P2: You = { campaignId: "c", role: "player", playerId: "p2" };

const at = { createdAt: "t", updatedAt: "t", tokenShape: null };
const block = { size: "large", ac: 13, hpMax: 59, initBonus: 1, attacks: [], cr: "3" };
/** The DM's full pet row; `owner` drops what the owner never gets (FR-ENT-37). */
const owlbearDm = {
  ...at,
  id: "owl",
  kind: "monster",
  campaignId: "c",
  name: "Owlbear",
  portraitAssetId: null,
  statBlock: block,
  ownerPlayerId: "p1",
  hpCurrent: 24,
  derivedFromId: "srd-owlbear",
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
  band: "bloodied",
};
const drakeDm = {
  ...owlbearDm,
  id: "drake",
  name: "Drake Companion",
  statBlock: { ...block, hpMax: 22 },
  hpCurrent: 22,
  companionOf: "brakka",
  turnMode: "in-owner-turn",
};
const mira = { id: "mira", kind: "character", name: "Mira", ownerPlayerId: "p1" };
const brakka = { id: "brakka", kind: "character", name: "Brakka", ownerPlayerId: "p1" };
const players = {
  p1: { id: "p1", campaignId: "c", name: "Player 1", color: "#19b98a" },
  p2: { id: "p2", campaignId: "c", name: "Player 2", color: "#56b4e9" },
};
// In a fight: the DM's combatant row (entityId), the owner's and another player's views.
const cDm = {
  id: "cb",
  kind: "monster",
  entityId: "owl",
  name: "Owlbear",
  active: true,
  removed: false,
  pet: true,
  ownerCharacterId: "mira",
  turnMode: "after-owner",
  hpCurrent: 20,
  hpMax: 59,
};
const { entityId: _e, active: _a, ...cOwner } = cDm;
const cOther = {
  id: "cb",
  kind: "monster",
  name: "Owlbear",
  removed: false,
  ownerCharacterId: "mira",
  ownerPlayerId: "p1",
  turnMode: "after-owner",
  band: "bloodied",
};

const byId = (rows: object[]) => Object.fromEntries(rows.map((r) => [(r as { id: string }).id, r]));

function render(
  you: You,
  entities: object[],
  combatants: object[] = [],
  opts: { card?: boolean; dm?: CompanionsDmParts; board?: boolean } = {},
) {
  const store = createStore<SyncState>()(
    () =>
      ({
        state: "live",
        everLive: true,
        store: {
          ...emptyStore(),
          you,
          records: {
            entity: byId(entities),
            combatant: byId(combatants),
            player: players,
            "loot-entry": {},
            "party-pot": {},
            wallet: {},
          },
        },
        lazy: lazyAfterSnapshot(1),
        connection: { load: () => null, retryLoad: () => null },
      }) as unknown as SyncState,
  );
  const defs = opts.card
    ? [
        defineWindow({
          kind: COMPANION_CARD_KIND,
          title: "Companion",
          clients: ["dm", "player"],
          defaultSize: { w: 320, h: 360 },
          minSize: { w: 280, h: 240 },
          defaultPosition: { anchor: "top-left", dx: 56 },
          component: () => null,
        }),
      ]
    : [];
  // The shell's title marker takes `document` at render; a stub is enough for a static render.
  const g = globalThis as { document?: unknown };
  g.document = { title: "", hidden: false };
  try {
    return renderToStaticMarkup(
      <SyncContext.Provider value={store}>
        <ShellProvider registry={createWindowRegistry(you.role === "dm" ? "dm" : "player", defs)}>
          <TooltipProvider delayDuration={0} skipDelayDuration={0}>
            {opts.board ? (
              <PartyBoard handouts={<p />} companions={opts.dm} />
            ) : (
              <CompanionsTab dm={opts.dm} />
            )}
          </TooltipProvider>
        </ShellProvider>
      </SyncContext.Provider>,
    );
  } finally {
    delete g.document;
  }
}

const attr = (html: string, testId: string, name: string) =>
  [...html.matchAll(new RegExp(`data-testid="${testId}"[^>]*?${name}="([^"]*)"`, "g"))].map(
    (m) => m[1],
  );

afterEach(() => partyMemory().tabs.bind(null));

describe("FR-PARTY-41 companions tab", () => {
  test("FR-PARTY-41 companions tab: Handouts, Inventory, Loot, Companions; a stored `companions` restores; groups by PC with the owner's colour dot", () => {
    expect(PARTY_TABS).toEqual(["handouts", "inventory", "loot", "companions"]);
    partyMemory().tabs.choose(tabKeyOf(DM), "companions");
    const html = render(DM, [mira, brakka, owlbearDm, drakeDm], [], { board: true });
    expect(attr(html, "party-tab", "data-value")).toEqual([...PARTY_TABS]);
    expect(html).toContain(">Companions<");
    expect(html).toContain('data-testid="party-companions"');
    // Groups by PC name (Brakka, Mira), each with Player 1's colour.
    expect(attr(html, "party-companion-group", "data-record-id")).toEqual(["brakka", "mira"]);
    expect(html.match(/background-color:#19b98a/g)).toHaveLength(2);
    expect(attr(html, "party-companion-row", "data-record-id")).toEqual(["drake", "owl"]);
  });

  test("FR-PARTY-42 DM rows: HP numbers, mode icon, Card (when the card is registered), base name slot, menu", () => {
    const menu: CompanionsDmParts = {
      header: () => <button type="button" data-testid="stub-new" />,
      menu: ({ row }) => <button type="button" data-testid="stub-menu" data-record-id={row.id} />,
    };
    const html = render(DM, [mira, owlbearDm], [], { card: true, dm: menu });
    expect(attr(html, "party-companion-hp", "data-value")).toEqual(["24/59"]);
    expect(attr(html, "party-companion-mode-icon", "data-value")).toEqual(["after-owner"]);
    expect(attr(html, "party-companion-card", "data-record-id")).toEqual(["owl"]);
    expect(attr(html, "stub-menu", "data-record-id")).toEqual(["owl"]);
    expect(html).toContain('data-testid="stub-new"');
    expect(html).not.toContain("party-companion-band");
    // No card window registered yet (CP4): no Card button.
    expect(render(DM, [mira, owlbearDm])).not.toContain("party-companion-card");
  });
});

describe("FR-PARTY-42 band for other players", () => {
  test("FR-PARTY-42 band for other players: player-2 sees 'Bloodied' at 24 / 59, no numbers, no Card; player-1 sees 24 / 59 and Card", () => {
    const p2 = render(P2, [mira, owlbearOther], [], { card: true });
    expect(attr(p2, "party-companion-band", "data-value")).toEqual(["bloodied"]);
    expect(p2).toContain(">Bloodied<");
    for (const leak of [
      "party-companion-hp",
      "party-companion-card",
      "59",
      "party-companion-mode-icon",
    ]) {
      expect(p2).not.toContain(leak);
    }
    const p1 = render(P1, [mira, owlbearOwner], [], { card: true });
    expect(attr(p1, "party-companion-hp", "data-value")).toEqual(["24/59"]);
    expect(attr(p1, "party-companion-card", "data-record-id")).toEqual(["owl"]);
    expect(p1).not.toContain("party-companion-base");
    // A pet player-2 doesn't receive (not present) isn't listed: the empty state.
    expect(render(P2, [mira])).toContain(EMPTY_COMPANIONS_PLAYER);
  });

  test("FR-PARTY-42 in a fight every viewer reads the combatant: DM by entityId, owner and others by owner + name; 'In combat'", () => {
    const g = (you: You, e: object[], c: object[]) =>
      companionGroups(e, c, { role: you.role, playerId: you.playerId })[0]?.rows[0];
    expect(g(DM, [owlbearDm], [cDm])).toMatchObject({
      inCombat: true,
      hp: { current: 20, max: 59 },
    });
    expect(g(P1, [owlbearOwner], [cOwner])).toMatchObject({
      inCombat: true,
      hp: { current: 20, max: 59 },
      card: true,
    });
    expect(g(P2, [owlbearOther], [{ ...cOther, band: "healthy" }])).toMatchObject({
      inCombat: true,
      hp: null,
      band: "healthy",
      card: false,
    });
    // A summon of the same owner (the owner sees `pet: false`) is never taken for the pet.
    expect(g(P1, [owlbearOwner], [{ ...cOwner, pet: false }])).toMatchObject({
      inCombat: false,
      hp: { current: 24 },
    });
    // The owner's view with `entityId` (CP4) matches by id, also after a mid-fight rename; other
    // players match by owner + name only, so a renamed pet falls back to its row (accepted edge).
    const renamed = { ...cOwner, entityId: "owl", name: "Old Owlbear" };
    expect(g(P1, [owlbearOwner], [renamed])).toMatchObject({ inCombat: true, hp: { current: 20 } });
    expect(g(P2, [owlbearOther], [{ ...cOther, name: "Old Owlbear" }])).toMatchObject({
      inCombat: false,
      band: "bloodied",
    });
    // An ended fight's combatant (DM: inactive) doesn't count.
    expect(g(DM, [owlbearDm], [{ ...cDm, active: false }])).toMatchObject({ inCombat: false });
    const html = render(P2, [mira, owlbearOther], [cOther]);
    expect(attr(html, "party-companion-row", "data-in-combat")).toEqual(["true"]);
    expect(html).toContain(">In combat<");
  });
});

describe("FR-PARTY-44 empty and other states", () => {
  test("FR-PARTY-44 empty states: DM and player texts; the summons footer only while a fight runs", () => {
    expect(render(DM, [mira])).toContain(EMPTY_COMPANIONS);
    expect(render(DM, [mira])).not.toContain(EMPTY_COMPANIONS_PLAYER);
    expect(render(P1, [mira])).toContain(EMPTY_COMPANIONS_PLAYER);
    expect(fightRunning([])).toBe(false);
    expect(fightRunning([{ ...cDm, active: false }])).toBe(false);
    expect(fightRunning([cOther])).toBe(true);
    expect(render(P1, [mira, owlbearOwner], [cOwner])).toContain("Summons show in Initiative");
    expect(render(P1, [mira, owlbearOwner])).not.toContain("party-companions-footer");
  });

  test("FR-PARTY-44 a released pet leaves the list; a reassigned one moves group", () => {
    const released = { ...owlbearDm, companionOf: null, ownerPlayerId: null, turnMode: null };
    expect(companionGroups([mira, released], [], { role: "dm", playerId: null })).toEqual([]);
    const moved = companionGroups([mira, brakka, { ...owlbearDm, companionOf: "brakka" }], [], {
      role: "dm",
      playerId: null,
    });
    expect(moved.map((g) => [g.characterName, g.rows.map((r) => r.name)])).toEqual([
      ["Brakka", ["Owlbear"]],
    ]);
  });
});

describe("FR-PARTY-46 layout", () => {
  test("FR-PARTY-46 tabs fit at min width: the strip scrolls sideways, triggers never shrink or wrap", () => {
    const html = render(P1, [mira], [], { board: true });
    const list = html.match(/<div[^>]*data-testid="party-tabs"[^>]*>/)?.[0] ?? "";
    expect(list).toContain("overflow-x-auto");
    expect(list).toContain("w-full");
    const triggers = [...html.matchAll(/<button[^>]*data-testid="party-tab"[^>]*>/g)].map(
      (m) => m[0],
    );
    expect(triggers).toHaveLength(4);
    for (const t of triggers) {
      expect(t).toContain("shrink-0");
      expect(t).toContain("whitespace-nowrap");
    }
  });
});
