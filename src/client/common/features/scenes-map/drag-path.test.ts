// FR-MAP-53 path visibility, FR-MAP-54 trail reducer, FR-MAP-55 blocked step (sprint 4). The
// path's cells are tested with `dragPath` (`@shared/scenes-map/drag-path.test.ts`).
import { describe, expect, test } from "bun:test";
import { ENCOUNTER_TYPE } from "@shared/combat-tracker/schemas";
import type { RecordStore } from "@shared/protocol/store";
import { wallHint } from "@shared/scene-tools/geometry";
import type { Segment, Wall } from "@shared/scene-tools/schemas";
import { TOKEN_TYPE, type TokenView } from "@shared/scenes-map/schemas";
import {
  blockedStep,
  cellsAttr,
  combatTurnKey,
  knownCells,
  nextTrails,
  noTrails,
  ownDragBlocked,
  pathFootprint,
  pathShown,
  type TrailState,
  tokenMovesOf,
} from "./drag-path";
import { clearTrails, createPreviewStore } from "./drag-preview";

const SCENE = "s-ambush";
const tok = (id: string, col: number, row: number, extra: Partial<TokenView> = {}) =>
  ({
    id,
    sceneId: SCENE,
    col,
    row,
    size: "medium",
    ownerPlayerId: null,
    hidden: false,
    ...extra,
  }) as TokenView;

const storeOf = (tokens: TokenView[], encounters: Record<string, unknown>[] = []): RecordStore => ({
  you: null,
  seq: 5,
  records: {
    [TOKEN_TYPE]: Object.fromEntries(tokens.map((t) => [t.id, t])),
    [ENCOUNTER_TYPE]: Object.fromEntries(encounters.map((e) => [e.id as string, e])),
  },
});

describe("FR-MAP-53 path visibility", () => {
  test("FR-MAP-53 path visibility: DM / owner / other player × player token / unowned visible / hidden / not in store", () => {
    const mira = tok("mira", 2, 7, { ownerPlayerId: "p1" });
    const sneak = tok("sneak", 4, 9);
    const hiddenWolf = tok("wolf", 9, 9, { hidden: true });
    // What each client holds: players never receive hidden (or fog-hidden) tokens.
    const held = {
      dm: new Map([mira, sneak, hiddenWolf].map((t) => [t.id, t])),
      owner: new Map([mira, sneak].map((t) => [t.id, t])),
      other: new Map([mira, sneak].map((t) => [t.id, t])),
    };
    const role = { dm: "dm", owner: "player", other: "player" } as const;
    const matrix = Object.fromEntries(
      (["dm", "owner", "other"] as const).map((c) => [
        c,
        ["mira", "sneak", "wolf", "ghost"].map((id) => pathShown(held[c].get(id), role[c])),
      ]),
    );
    expect(matrix).toEqual({
      dm: [true, true, true, false],
      owner: [true, false, false, false],
      other: [true, false, false, false],
    });
  });

  test("FR-MAP-53 cells attr and a Large token's footprint per step, each cell once", () => {
    expect(
      cellsAttr([
        { col: 2, row: 7 },
        { col: 3, row: 7 },
      ]),
    ).toBe("2,7 3,7");
    const cells = pathFootprint(
      [
        { col: 4, row: 10 },
        { col: 5, row: 11 },
      ],
      2,
    );
    expect(cellsAttr(cells)).toBe("4,10 5,10 4,11 5,11 6,11 5,12 6,12");
  });
});

describe("FR-MAP-55 blocked step", () => {
  const walls: Wall[] = [[1, 8, 0, 8, 20]];
  const pieceFor = (from: { col: number; row: number }, to: { col: number; row: number }) => {
    const p = wallHint(from, to, 1, walls, []);
    return p ? [p] : [];
  };

  test("FR-MAP-55 blocked index from the hint: Mira (5, 8) → (10, 8) across x = 8 → step 3 (8, 8) on", () => {
    const from = { col: 5, row: 8 };
    const to = { col: 10, row: 8 };
    const pieces = pieceFor(from, to);
    expect(pieces).toHaveLength(1);
    expect(blockedStep(from, to, 1, pieces)).toBe(3);
    // No hint (the cell changed, no wall, a reject) → plain path.
    expect(blockedStep(from, to, 1, [])).toBe(-1);
    // Diagonal: (6, 2) → (9, 5); centres (6.5, 2.5) → (9.5, 5.5) cross x = 8 at t = 0.5 → step 2.
    const d = pieceFor({ col: 6, row: 2 }, { col: 9, row: 5 });
    expect(blockedStep({ col: 6, row: 2 }, { col: 9, row: 5 }, 1, d)).toBe(2);
    // Large (centre + 1): (4, 4) → (8, 4); centres x 5 → 9 cross 8 at t = 0.75 → step 3.
    const big = wallHint({ col: 4, row: 4 }, { col: 8, row: 4 }, 2, walls, []);
    expect(big).not.toBeNull();
    expect(blockedStep({ col: 4, row: 4 }, { col: 8, row: 4 }, 2, [big as Segment])).toBe(3);
  });

  test("FR-MAP-55 DM never blocked; a player's own drag uses the hint", () => {
    const drag = { from: { col: 5, row: 8 }, to: { col: 10, row: 8 }, size: 1 };
    const pieces = pieceFor(drag.from, drag.to);
    expect(ownDragBlocked("dm", drag, pieces)).toBe(-1);
    expect(ownDragBlocked("player", drag, pieces)).toBe(3);
  });
});

describe("FR-MAP-54 trail", () => {
  const started = (round: number, turn: string | null, extra: Record<string, unknown> = {}) => ({
    id: "enc-1",
    status: "started",
    sceneId: SCENE,
    round,
    turnCombatantId: turn,
    playerTurnCombatantId: turn,
    ...extra,
  });
  const upsert = (id: string) => ({ type: TOKEN_TYPE, id, op: "upsert" as const });

  /** One applied frame as MapCanvas runs it: moves from `known`, then the reducer. */
  function frame(
    st: { trails: TrailState; known: Record<string, { col: number; row: number }> },
    store: RecordStore,
    changes: { type: string; id: string; op: "upsert" | "delete" }[],
    client: "dm" | "player" = "dm",
  ) {
    const r = tokenMovesOf(changes, st.known, store, SCENE);
    return {
      known: r.known,
      trails: nextTrails(st.trails, combatTurnKey(store, client, SCENE), r.moves, r.deleted),
    };
  }

  test("FR-MAP-54 trail: a segment per committed token upsert in combat; none outside combat", () => {
    const mira = tok("mira", 5, 8, { ownerPlayerId: "p1" });
    let st = { trails: noTrails, known: knownCells([mira]) };
    // Out of combat: the move commits, no trail.
    st = frame(st, storeOf([{ ...mira, col: 6 }]), [upsert("mira")]);
    expect(st.trails.byToken).toEqual({});
    expect(st.known.mira).toEqual({ col: 6, row: 8 });
    // Round 1, Mira's turn: (6, 8) → (6, 7), then → (7, 7): two segments, each a straight path.
    const enc = [started(1, "c-mira")];
    st = frame(st, storeOf([{ ...mira, col: 6, row: 7 }], enc), [upsert("mira")]);
    st = frame(st, storeOf([{ ...mira, col: 7, row: 7 }], enc), [upsert("mira")]);
    expect(st.trails.byToken.mira?.map(cellsAttr)).toEqual(["6,8 6,7", "6,7 7,7"]);
    // An upsert that doesn't move (rename, HP) adds none; nor does a token first seen.
    st = frame(st, storeOf([{ ...mira, col: 7, row: 7 }, tok("thorn", 2, 9)], enc), [
      upsert("mira"),
      upsert("thorn"),
    ]);
    expect(st.trails.byToken.mira).toHaveLength(2);
    expect(st.trails.byToken.thorn).toBeUndefined();
    // A refused move sends no upsert: an unrelated frame changes nothing (same state object).
    const before = st.trails;
    st = frame(st, storeOf([{ ...mira, col: 7, row: 7 }], enc), []);
    expect(st.trails).toBe(before);
  });

  test("FR-MAP-54 trail cleared on turn / round change, end, scene change, snapshot; DM: other scene → none", () => {
    const mira = tok("mira", 5, 8, { ownerPlayerId: "p1" });
    const moved = (col: number, enc: Record<string, unknown>[]) => storeOf([{ ...mira, col }], enc);
    const withTrail = () => {
      let st = { trails: noTrails, known: knownCells([mira]) };
      st = frame(st, moved(6, [started(1, "c-mira")]), [upsert("mira")]);
      expect(st.trails.byToken.mira).toHaveLength(1);
      return st;
    };
    // Next / Prev (turn), Start round 1 (round): the encounter upsert's frame.
    const enc = { type: ENCOUNTER_TYPE, id: "enc-1", op: "upsert" as const };
    expect(frame(withTrail(), moved(6, [started(1, "c-thorn")]), [enc]).trails.byToken).toEqual({});
    expect(frame(withTrail(), moved(6, [started(2, "c-mira")]), [enc]).trails.byToken).toEqual({});
    // End: no started encounter.
    const ended = [started(1, "c-mira", { status: "ended" })];
    expect(frame(withTrail(), moved(6, ended), [enc]).trails).toEqual(noTrails);
    // Players read their copy of the turn (no sceneId): a hidden monster's turn (null) clears too.
    const pl = (turn: string | null) => [
      { id: "enc-1", status: "started", round: 1, playerTurnCombatantId: turn },
    ];
    let p = { trails: noTrails, known: knownCells([mira]) };
    p = frame(p, moved(6, pl("c-mira")), [upsert("mira")], "player");
    expect(p.trails.byToken.mira).toHaveLength(1);
    expect(frame(p, moved(6, pl(null)), [enc], "player").trails.byToken).toEqual({});
    // DM: an encounter started on another scene → no trails on this one.
    const elsewhere = [started(1, "c-mira", { sceneId: "s-cellar" })];
    let d = { trails: noTrails, known: knownCells([mira]) };
    d = frame(d, moved(6, elsewhere), [upsert("mira")]);
    expect(d.trails.byToken).toEqual({});
    // A deleted token (or one moved off the scene) loses its trail.
    const st = withTrail();
    expect(
      frame(st, storeOf([], [started(1, "c-mira")]), [{ ...upsert("mira"), op: "delete" }]).trails
        .byToken,
    ).toEqual({});
    // Scene change and snapshot: MapCanvas drops the store's trails (clearTrails).
    const s = createPreviewStore();
    s.setState({ trails: withTrail().trails });
    clearTrails(s);
    expect(s.getState().trails).toBe(noTrails);
  });
});
