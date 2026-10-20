// Test support (sprint 6, CBT §13.3, `cp-combat`'s shape without summons' server path): the
// started fight as each client holds it: Worg 18, Brakka 17 (+ in-turn Drake Companion, Fire
// Elemental 2), Mira 15, Owlbear (after Mira, pet), Goblin 12, Thorn 10 (+ in-turn Wolf pet),
// Fire Elemental 3 (Thorn's, own 9). DM records, player-1's view (Mira, Brakka) and player-2's
// (Thorn), plus a static render with a live fake sync store and the shell. Tests only.
import type { CombatantView } from "@shared/combat-tracker/schemas";
import { lazyAfterSnapshot } from "@shared/protocol/lazy";
import { viewAsAfterSnapshot } from "@shared/protocol/scene-window";
import { emptyStore, type RecordStore } from "@shared/protocol/store";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createStore } from "zustand";
import { TooltipProvider } from "../../components/ui/overlays";
import { SyncContext, type SyncState } from "../../sync/store";
import { createWindowRegistry } from "../play-shell/registry";
import { ShellProvider } from "../play-shell/ShellContext";

const card = (attacks: { id: string; name: string; toHit: number; damage: string }[]) => ({
  size: "large",
  ac: 13,
  hpMax: 59,
  speed: 40,
  attacks,
});

const base = { encounterId: "e1", campaignId: "c1", active: true, removed: false, movedFt: 0 };
const dmRow = (o: Record<string, unknown>) => ({
  ...base,
  tokenId: null,
  imageAssetId: null,
  hidden: false,
  initRollId: null,
  playerPosition: null,
  hpCurrent: null,
  hpMax: null,
  tempHp: 0,
  side: null,
  publicSide: null,
  ownerCharacterId: null,
  ownerPlayerId: null,
  turnMode: null,
  pet: false,
  ownerHidden: false,
  concentrationEffectId: null,
  card: null,
  ...o,
});

/** DM records by id (rank order = `position`; in-turn companions have none). */
export const DM_ROWS = [
  dmRow({
    id: "wolf",
    seq: 1,
    kind: "monster",
    entityId: "d-wolf",
    name: "Worg",
    initiative: 18,
    position: 1,
    hpCurrent: 11,
    hpMax: 11,
  }),
  dmRow({
    id: "brakka",
    seq: 2,
    kind: "pc",
    entityId: "ch-brakka",
    name: "Brakka",
    initiative: 17,
    position: 2,
  }),
  dmRow({
    id: "drake",
    seq: 7,
    kind: "monster",
    entityId: "pet-drake",
    name: "Drake Companion",
    initiative: null,
    position: null,
    hpCurrent: 22,
    hpMax: 22,
    side: "ally",
    publicSide: "ally",
    ownerCharacterId: "ch-brakka",
    ownerPlayerId: "p1",
    turnMode: "in-owner-turn",
    pet: true,
    card: card([{ id: "bite", name: "Bite", toHit: 6, damage: "1d6+4" }]),
  }),
  dmRow({
    id: "fe2",
    seq: 9,
    kind: "monster",
    entityId: "d-fe",
    name: "Fire Elemental 2",
    initiative: null,
    position: null,
    hpCurrent: 102,
    hpMax: 102,
    side: "ally",
    publicSide: "ally",
    ownerCharacterId: "ch-brakka",
    ownerPlayerId: "p1",
    turnMode: "in-owner-turn",
    card: card([{ id: "touch", name: "Touch", toHit: 6, damage: "2d6+3" }]),
  }),
  dmRow({
    id: "mira",
    seq: 3,
    kind: "pc",
    entityId: "ch-mira",
    name: "Mira",
    initiative: 15,
    position: 3,
  }),
  dmRow({
    id: "owlbear",
    seq: 6,
    kind: "monster",
    entityId: "pet-owlbear",
    name: "Owlbear",
    initiative: null,
    position: 4,
    hpCurrent: 45,
    hpMax: 59,
    side: "ally",
    publicSide: "ally",
    ownerCharacterId: "ch-mira",
    ownerPlayerId: "p1",
    turnMode: "after-owner",
    pet: true,
    card: card([{ id: "claws", name: "Claws", toHit: 7, damage: "2d8+5" }]),
  }),
  dmRow({
    id: "goblin",
    seq: 4,
    kind: "monster",
    entityId: "d-goblin",
    name: "Goblin",
    initiative: 12,
    position: 5,
    hpCurrent: 7,
    hpMax: 7,
  }),
  dmRow({
    id: "thorn",
    seq: 5,
    kind: "pc",
    entityId: "ch-thorn",
    name: "Thorn",
    initiative: 10,
    position: 6,
  }),
  dmRow({
    id: "wolfpet",
    seq: 8,
    kind: "monster",
    entityId: "pet-wolf",
    name: "Wolf",
    initiative: null,
    position: null,
    hpCurrent: 11,
    hpMax: 11,
    side: "ally",
    publicSide: "ally",
    ownerCharacterId: "ch-thorn",
    ownerPlayerId: "p2",
    turnMode: "in-owner-turn",
    pet: true,
  }),
  dmRow({
    id: "fe3",
    seq: 10,
    kind: "monster",
    entityId: "d-fe",
    name: "Fire Elemental 3",
    initiative: 9,
    position: 7,
    hpCurrent: 102,
    hpMax: 102,
    side: "ally",
    publicSide: "ally",
    ownerCharacterId: "ch-thorn",
    ownerPlayerId: "p2",
    turnMode: "own",
    concentrationEffectId: "fx1",
  }),
] as unknown as (CombatantView & Record<string, unknown>)[];

const playerOf = (r: Record<string, unknown>, viewer: string): Record<string, unknown> => {
  const common = {
    id: r.id,
    encounterId: "e1",
    kind: r.kind,
    tokenId: null,
    name: r.name,
    imageAssetId: null,
    playerPosition: r.position,
    removed: false,
    movedFt: 0,
    side: r.kind === "pc" ? "ally" : (r.publicSide ?? "enemy"),
  };
  if (r.kind === "pc") return { ...common, entityId: r.entityId, initiative: r.initiative };
  const cur = r.hpCurrent as number;
  const max = r.hpMax as number;
  const band = cur <= 0 ? "down" : 2 * cur <= max ? "bloodied" : "healthy";
  const owner = r.ownerCharacterId
    ? { ownerCharacterId: r.ownerCharacterId, ownerPlayerId: r.ownerPlayerId, turnMode: r.turnMode }
    : {};
  if (r.ownerPlayerId === viewer) {
    return {
      ...common,
      band,
      ...owner,
      hpCurrent: cur,
      hpMax: max,
      tempHp: 0,
      pet: r.pet,
      card: r.card,
    };
  }
  return { ...common, band, ...owner };
};

const ENTITIES = {
  "ch-mira": { id: "ch-mira", kind: "character", name: "Mira", ownerPlayerId: "p1" },
  "ch-brakka": { id: "ch-brakka", kind: "character", name: "Brakka", ownerPlayerId: "p1" },
  "ch-thorn": { id: "ch-thorn", kind: "character", name: "Thorn", ownerPlayerId: "p2" },
};
const PLAYERS = {
  p1: { id: "p1", name: "Player 1", color: "#e69f00" },
  p2: { id: "p2", name: "Player 2", color: "#56b4e9" },
};

const byId = (rows: readonly Record<string, unknown>[]) =>
  Object.fromEntries(rows.map((r) => [r.id as string, r]));

/** The store a client holds; `turn` = the turn combatant (DM) / its player copy. */
export function companionStore(
  viewer: "dm" | "p1" | "p2",
  turn: string | null = "wolf",
): RecordStore {
  const enc = {
    id: "e1",
    campaignId: "c1",
    name: "Ambush at the Ford",
    status: "started",
    round: 1,
    ...(viewer === "dm" ? { turnCombatantId: turn } : {}),
    playerTurnCombatantId: turn,
  };
  const combatants =
    viewer === "dm"
      ? DM_ROWS
      : DM_ROWS.map((r) => playerOf(r, viewer)).map((r) =>
          // Players: an in-turn companion has no `playerPosition` either.
          r.turnMode === "in-owner-turn" ? { ...r, playerPosition: null } : r,
        );
  return {
    ...emptyStore(),
    you:
      viewer === "dm"
        ? { campaignId: "c1", role: "dm", playerId: null }
        : { campaignId: "c1", role: "player", playerId: viewer },
    records: {
      encounter: { e1: enc },
      combatant: byId(combatants),
      entity: ENTITIES,
      player: PLAYERS,
    },
  } as RecordStore;
}

/** Static render with a live fake sync store, the shell and Tooltips. */
export function renderWith(store: RecordStore, node: ReactNode): string {
  const sync = createStore<SyncState>()(
    () =>
      ({
        state: "live",
        store,
        notLiveSince: null,
        everLive: true,
        scenes: { loaded: [], loading: [] },
        viewAs: viewAsAfterSnapshot(),
        lazy: lazyAfterSnapshot(1),
        connection: { sendIntent: () => Promise.resolve({}) },
      }) as unknown as SyncState,
  );
  const role = store.you?.role === "dm" ? "dm" : "player";
  // The shell reads `document` / `window` at render (title marker, viewport); stubs are enough
  // for a static render.
  const g = globalThis as { document?: unknown; window?: unknown };
  const had = "document" in g;
  const hadWindow = "window" in g;
  const noop = () => {};
  if (!had) g.document = { title: "", hidden: false };
  if (!hadWindow) {
    g.window = {
      innerWidth: 1440,
      innerHeight: 900,
      devicePixelRatio: 1,
      addEventListener: noop,
      removeEventListener: noop,
      matchMedia: () => ({ matches: false, addEventListener: noop, removeEventListener: noop }),
    };
  }
  try {
    return renderToStaticMarkup(
      <SyncContext.Provider value={sync}>
        <ShellProvider registry={createWindowRegistry(role, [])}>
          <TooltipProvider delayDuration={0} skipDelayDuration={0}>
            {node}
          </TooltipProvider>
        </ShellProvider>
      </SyncContext.Provider>,
    );
  } finally {
    if (!had) delete g.document;
    if (!hadWindow) delete g.window;
  }
}

/** The markup of the element with `data-testid=id` and `data-record-id=rec` up to its next sibling row. */
export function rowHtml(html: string, id: string, rec: string): string {
  const start = html.indexOf(`data-testid="${id}" data-record-id="${rec}"`);
  if (start < 0) return "";
  const open = html.lastIndexOf("<", start);
  const rest = html.slice(start);
  const next = rest.indexOf(`data-testid="${id}" data-record-id=`, 1);
  return html.slice(open, next < 0 ? undefined : start + next);
}
