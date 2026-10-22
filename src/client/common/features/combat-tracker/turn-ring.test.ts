// FR-CBT-166: combat's `cbt` line fills the turn ring (scenes-map FR-MAP-108) per viewer, in-code
// stores shaped like each client's: the DM's full rows; players' redactions (a hidden, fog-hidden
// or `ownerHidden` row never reaches them, FR-CBT-31 / ADR-0039, and its turn is null for them).
import { describe, expect, test } from "bun:test";
import type { You } from "@shared/protocol/frames";
import { emptyStore, type RecordStore } from "@shared/protocol/store";
import type { TokenView } from "@shared/scenes-map/schemas";
import type { TokenOverlayView } from "../scenes-map/token-overlays";
import { cbtTokenOverlay, TURN_MARK, TURN_MARK_HIDDEN } from "./token-overlay";

const dmYou: You = { campaignId: "c", role: "dm", playerId: null };
const p1You: You = { campaignId: "c", role: "player", playerId: "p1" };
const p2You: You = { campaignId: "c", role: "player", playerId: "p2" };

interface Row {
  id: string;
  kind: "pc" | "monster";
  tokenId: string | null;
  name: string;
  entityId?: string;
  hidden?: boolean;
  ownerHidden?: boolean;
  removed?: boolean;
  position: number | null;
  playerPosition: number | null;
  ownerCharacterId?: string;
  ownerPlayerId?: string;
  turnMode?: "after-owner" | "in-owner-turn" | "own";
}

// Brakka (P1) with an in-turn Drake and an after-owner Owlbear; Thorn (P2); Goblin; the hidden
// Elite; Fog Goblin (fog-hidden: its hidden copy is set, FR-FOG-14); Shade, in-turn companion of
// the hidden Ghost PC (`ownerHidden`); a removed Orc.
const ROWS: Row[] = [
  {
    id: "c-brakka",
    kind: "pc",
    entityId: "ch-brakka",
    tokenId: "t-brakka",
    name: "Brakka",
    position: 1,
    playerPosition: 1,
  },
  {
    id: "c-drake",
    kind: "monster",
    tokenId: "t-drake",
    name: "Drake",
    position: null,
    playerPosition: null,
    ownerCharacterId: "ch-brakka",
    ownerPlayerId: "p1",
    turnMode: "in-owner-turn",
  },
  {
    id: "c-owl",
    kind: "monster",
    tokenId: "t-owl",
    name: "Owlbear",
    position: 2,
    playerPosition: 2,
    ownerCharacterId: "ch-brakka",
    ownerPlayerId: "p1",
    turnMode: "after-owner",
  },
  {
    id: "c-thorn",
    kind: "pc",
    entityId: "ch-thorn",
    tokenId: "t-thorn",
    name: "Thorn",
    position: 3,
    playerPosition: 3,
  },
  {
    id: "c-gob",
    kind: "monster",
    tokenId: "t-gob",
    name: "Goblin",
    position: 4,
    playerPosition: 4,
  },
  {
    id: "c-elite",
    kind: "monster",
    tokenId: "t-elite",
    name: "Elite",
    hidden: true,
    position: 5,
    playerPosition: null,
  },
  {
    id: "c-fog",
    kind: "monster",
    tokenId: "t-fog",
    name: "Fog Goblin",
    hidden: true,
    position: 6,
    playerPosition: null,
  },
  {
    id: "c-ghost",
    kind: "pc",
    entityId: "ch-ghost",
    tokenId: "t-ghost",
    name: "Ghost",
    hidden: true,
    position: 7,
    playerPosition: null,
  },
  {
    id: "c-shade",
    kind: "monster",
    tokenId: "t-shade",
    name: "Shade",
    ownerHidden: true,
    position: null,
    playerPosition: null,
    ownerCharacterId: "ch-ghost",
    ownerPlayerId: "p2",
    turnMode: "in-owner-turn",
  },
  {
    id: "c-orc",
    kind: "monster",
    tokenId: "t-orc",
    name: "Orc",
    removed: true,
    position: 8,
    playerPosition: null,
  },
  {
    id: "c-bare",
    kind: "monster",
    tokenId: null,
    name: "Tokenless",
    position: 9,
    playerPosition: 5,
  },
];

/** What a player receives (FR-CBT-31): no hidden / `ownerHidden` / removed rows, no DM fields. */
const playerRows = () =>
  ROWS.filter((r) => !r.hidden && !r.ownerHidden && !r.removed).map(
    ({ hidden: _h, ownerHidden: _o, position: _p, ...r }) => ({
      ...r,
      encounterId: "e1",
      removed: false,
      movedFt: 0,
    }),
  );
const dmRows = () =>
  ROWS.map((r) => ({
    hidden: false,
    ownerHidden: false,
    removed: false,
    ...r,
    encounterId: "e1",
    active: true,
    movedFt: 0,
  }));

/** The server's `playerTurnOf`: null for a hidden, `ownerHidden` or removed turn combatant. */
function playerTurn(turnId: string | null): string | null {
  const t = ROWS.find((r) => r.id === turnId);
  return t && !t.hidden && !t.ownerHidden && !t.removed ? t.id : null;
}

function store(you: You, turnId: string | null, o: { round?: number; status?: string } = {}) {
  const dm = you.role === "dm";
  const rows = dm ? dmRows() : playerRows();
  const enc = {
    id: "e1",
    status: o.status ?? "started",
    round: o.round ?? 1,
    playerTurnCombatantId: playerTurn(turnId),
  };
  const s: RecordStore = {
    ...emptyStore(),
    you,
    records: {
      encounter: { e1: dm ? { ...enc, turnCombatantId: turnId } : enc },
      combatant: Object.fromEntries(rows.map((r) => [r.id, r])),
    },
  };
  return s;
}

const view = (client: "dm" | "player"): TokenOverlayView => ({
  client,
  selected: false,
  targeting: false,
});
/** The tokens a client holds: players never receive hidden / fog-hidden tokens (ADR-0039). */
const tokensOf = (you: You) =>
  ROWS.filter((r) => r.tokenId && (you.role === "dm" || (!r.hidden && !r.ownerHidden))).map(
    (r) => r.tokenId as string,
  );
/** Ringed tokens on a client: token id → `hidden` flag. */
function rings(you: You, turnId: string | null, o?: { round?: number; status?: string }) {
  const s = store(you, turnId, o);
  const v = view(you.role === "dm" ? "dm" : "player");
  const out: Record<string, boolean> = {};
  for (const id of tokensOf(you)) {
    const d = cbtTokenOverlay.decorate?.({ id } as TokenView, s, v);
    if (d?.turn) {
      expect(d.turn.id).toBe("cbt-token-turn");
      out[id] = d.turn.hidden === true;
    }
  }
  return out;
}

describe("FR-CBT-166 turn ring per viewer", () => {
  test("FR-CBT-166 turn ring per viewer: visible turn → the turn token for the DM and each player", () => {
    for (const you of [dmYou, p1You, p2You])
      expect(rings(you, "c-thorn")).toEqual({ "t-thorn": false });
    for (const you of [dmYou, p1You, p2You])
      expect(rings(you, "c-gob")).toEqual({ "t-gob": false });
    // An after-owner companion has its own turn: only it rings, not its owner.
    for (const you of [dmYou, p1You, p2You])
      expect(rings(you, "c-owl")).toEqual({ "t-owl": false });
  });

  test("FR-CBT-166 turn ring per viewer: in-owner-turn companions ring with their owner", () => {
    const want = { "t-brakka": false, "t-drake": false };
    for (const you of [dmYou, p1You, p2You]) expect(rings(you, "c-brakka")).toEqual(want);
  });

  test("FR-CBT-166 turn ring per viewer: hidden turn → DM dashed, players none (and no data)", () => {
    expect(rings(dmYou, "c-elite")).toEqual({ "t-elite": true });
    for (const you of [p1You, p2You]) expect(rings(you, "c-elite")).toEqual({});
    for (const you of [p1You, p2You]) {
      const s = JSON.stringify(store(you, "c-elite"));
      expect(s).not.toContain("c-elite");
      expect(s).not.toContain("t-elite");
    }
  });

  test("FR-CBT-166 turn ring per viewer: fog-hidden turn → DM dashed, players none", () => {
    expect(rings(dmYou, "c-fog")).toEqual({ "t-fog": true });
    for (const you of [p1You, p2You]) expect(rings(you, "c-fog")).toEqual({});
  });

  test("FR-CBT-166 turn ring per viewer: hidden owner's turn → DM dashed on it and its ownerHidden companion", () => {
    expect(rings(dmYou, "c-ghost")).toEqual({ "t-ghost": true, "t-shade": true });
    for (const you of [p1You, p2You]) expect(rings(you, "c-ghost")).toEqual({});
  });

  test("FR-CBT-166 turn ring per viewer: none in round 0, after End, without a turn, on a removed or token-less turn", () => {
    for (const you of [dmYou, p1You, p2You]) {
      expect(rings(you, "c-thorn", { round: 0 })).toEqual({});
      expect(rings(you, "c-thorn", { status: "ended" })).toEqual({});
      expect(rings(you, null)).toEqual({});
      expect(rings(you, "c-orc")).toEqual({});
      expect(rings(you, "c-bare")).toEqual({});
    }
  });

  test("FR-CBT-166 turn ring per viewer: constant marks (memoised decorations, FR-MAP-111)", () => {
    const a = cbtTokenOverlay.decorate?.(
      { id: "t-thorn" } as TokenView,
      store(dmYou, "c-thorn"),
      view("dm"),
    );
    const b = cbtTokenOverlay.decorate?.(
      { id: "t-thorn" } as TokenView,
      store(dmYou, "c-thorn"),
      view("dm"),
    );
    expect(a?.turn).toBe(TURN_MARK);
    expect(b?.turn).toBe(a?.turn as typeof TURN_MARK);
    const h = cbtTokenOverlay.decorate?.(
      { id: "t-elite" } as TokenView,
      store(dmYou, "c-elite"),
      view("dm"),
    );
    expect(h?.turn).toBe(TURN_MARK_HIDDEN);
  });
});
