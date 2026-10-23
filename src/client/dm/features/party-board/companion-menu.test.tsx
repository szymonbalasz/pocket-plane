// Sprint 9 PM2 (FR-PARTY-62): the DM's companion actions inside Party Manager's Party status tab,
// as a static render over a fake sync store: New pet… in the tab's header row, the row menu on
// pets only (summons have none: Initiative owns them), everything disabled while disconnected;
// Owner… / Release… locked while the pet is in a fight. The player client passes no DM parts.
// The menu's dialogs and their `PUT`s: e2e/cp-pets.e2e.ts.
import { describe, expect, test } from "bun:test";
import type { You } from "@shared/protocol/frames";
import { lazyAfterSnapshot } from "@shared/protocol/lazy";
import { emptyStore } from "@shared/protocol/store";
import { TooltipProvider } from "@ui/components/ui/overlays";
import { PET_IN_FIGHT_HINT } from "@ui/features/party-board/logic";
import { StatusTab } from "@ui/features/party-board/StatusTab";
import { HandoutBody } from "@ui/features/party-board/Viewer";
import { partyBoardWindowBase } from "@ui/features/party-board/window";
import { createWindowRegistry } from "@ui/features/play-shell/registry";
import { ShellProvider } from "@ui/features/play-shell/ShellContext";
import { SyncContext, type SyncState } from "@ui/sync/store";
import { renderToStaticMarkup } from "react-dom/server";
import { createStore } from "zustand";
import { PET_OWNER_HINT } from "../combat-tracker/companion-menu";
import { dmCompanionParts, petMenuLock } from "./companion-menu";

const DM: You = { campaignId: "c", role: "dm", playerId: null };
const P1: You = { campaignId: "c", role: "player", playerId: "p1" };

const at = { campaignId: "c", tokenShape: null, createdAt: "t", updatedAt: "t" };
const mira = {
  ...at,
  id: "mira",
  kind: "character",
  name: "Mira",
  portraitAssetId: null,
  derivedFromId: null,
  statBlock: {
    size: "medium",
    ac: 15,
    hpMax: 20,
    initBonus: 1,
    attacks: [],
    level: 3,
    className: "Ranger",
  },
  ownerPlayerId: "p1",
  hpCurrent: 20,
  tempHp: 0,
  deathSuccesses: 0,
  deathFailures: 0,
};
const owl = {
  ...at,
  id: "owl",
  kind: "monster",
  name: "Owlbear",
  portraitAssetId: null,
  derivedFromId: "srd-owlbear",
  statBlock: { size: "large", ac: 13, hpMax: 59, initBonus: 1, attacks: [], cr: "3" },
  ownerPlayerId: "p1",
  hpCurrent: 45,
  companionOf: "mira",
  turnMode: "after-owner",
  petPresent: true,
};
const summon = {
  id: "c-fe",
  encounterId: "e1",
  kind: "monster",
  entityId: "srd-fire-elemental",
  name: "Fire Elemental",
  imageAssetId: null,
  active: true,
  removed: false,
  hidden: false,
  ownerHidden: false,
  pet: false,
  ownerCharacterId: "mira",
  ownerPlayerId: "p1",
  turnMode: "in-owner-turn",
  hpCurrent: 80,
  hpMax: 102,
};

const byId = (rows: readonly object[]) =>
  Object.fromEntries(rows.map((r) => [(r as { id: string }).id, r]));

function render(you: You, live = true) {
  const store = createStore<SyncState>()(
    () =>
      ({
        state: live ? "live" : "reconnecting",
        everLive: true,
        store: {
          ...emptyStore(),
          you,
          records: {
            entity: byId([mira, owl]),
            combatant: byId([summon]),
            encounter: { e1: { id: "e1", status: "started" } },
            player: { p1: { id: "p1", campaignId: "c", name: "Player 1", color: "#19b98a" } },
          },
        },
        lazy: lazyAfterSnapshot(1),
        connection: { load: () => null, retryLoad: () => null },
      }) as unknown as SyncState,
  );
  const g = globalThis as { document?: unknown };
  g.document = { title: "", hidden: false };
  try {
    return renderToStaticMarkup(
      <SyncContext.Provider value={store}>
        <ShellProvider registry={createWindowRegistry(you.role === "dm" ? "dm" : "player", [])}>
          <TooltipProvider delayDuration={0} skipDelayDuration={0}>
            <StatusTab dm={you.role === "dm" ? dmCompanionParts : undefined} />
          </TooltipProvider>
        </ShellProvider>
      </SyncContext.Provider>,
    );
  } finally {
    delete g.document;
  }
}

const tag = (html: string, testId: string) =>
  [...html.matchAll(new RegExp(`<button[^>]*data-testid="${testId}"[^>]*>`, "g"))].map((m) => m[0]);

describe("FR-PARTY-62 DM companion actions", () => {
  test("FR-PARTY-62 DM companion actions: New pet… in the header, the row menu on pets only (none on summons, none for players), disabled while disconnected; Owner… / Release… locked in a fight", () => {
    const html = render(DM);
    expect(tag(html, "party-companion-new")).toHaveLength(1);
    expect(tag(html, "party-companion-new")[0]).not.toContain(' disabled=""');
    expect(html).toContain("New pet…");
    // The header sits above the PC list.
    expect(html.indexOf("party-companion-new")).toBeLessThan(html.indexOf("party-summary"));
    const menus = tag(html, "party-companion-menu");
    expect(menus).toHaveLength(1);
    expect(menus[0]).toContain('data-record-id="owl"');
    expect(menus[0]).toContain('data-locked="false"');
    // The summon is listed under Mira, with no menu.
    expect(html).toContain('data-testid="party-companion-row" data-record-id="c-fe"');
    // Disconnected: the last list, New pet… disabled (the menu's items disable themselves).
    const off = render(DM, false);
    expect(tag(off, "party-companion-new")[0]).toContain(' disabled=""');
    // Players: no New pet…, no row menu.
    const p1 = render(P1);
    expect(p1).not.toContain("party-companion-new");
    expect(p1).not.toContain("party-companion-menu");
    // In a fight, Owner… and Release… say why they are disabled.
    expect(petMenuLock({ inCombat: true })).toBe(PET_IN_FIGHT_HINT);
    expect(petMenuLock({ inCombat: false })).toBeNull();
  });
});

describe("FR-PARTY-59 renamed", () => {
  test("FR-PARTY-59 renamed: title and launcher label Party Manager (kind unchanged), the viewer's empty text, combat's pet-owner hint", () => {
    expect(partyBoardWindowBase).toMatchObject({
      kind: "party.board",
      title: "Party Manager",
      launcher: { label: "Party Manager" },
    });
    expect(renderToStaticMarkup(<HandoutBody handoutId={null} render={() => null} />)).toContain(
      "Open a handout from Party Manager.",
    );
    expect(PET_OWNER_HINT).toBe("Change a pet's owner in Party Manager");
  });
});
