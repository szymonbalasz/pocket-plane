// FR-NOTE-30 action cue (predicate, default tokens, hook, 4 s expiry and restart, DM only) and
// FR-CBTX-49 concentration cue tokens.
import { afterEach, describe, expect, test } from "bun:test";
import type { NotificationRecord } from "@shared/notifications/schemas";
import type { RecordStore } from "@shared/protocol/store";
import type { TokenView } from "@shared/scenes-map/schemas";
import { concentrationCueTokens } from "../combat-extras/concentration";
import type { TokenOverlayView } from "../scenes-map/token-overlays";
import type { SyncView } from "./logic";
import {
  CUE_MS,
  clearCues,
  cueTokensFor,
  cueTriggers,
  defaultCueTokens,
  NOTE_CUE_ID,
  noteCueOverlay,
  setCueClock,
  startCues,
} from "./token-cue";
import { defineNotificationView } from "./views";

const DM = { campaignId: "c", role: "dm" as const, playerId: null };
const P1 = { campaignId: "c", role: "player" as const, playerId: "p1" };

const note = (id: string, seq: number, o: Partial<NotificationRecord> = {}) =>
  ({
    id,
    seq,
    kind: "cbtx-concentration",
    text: "Mira: concentration save DC 10 (Bless)",
    state: "pending",
    actionRole: "player",
    actionPlayerId: "p1",
    payload: { effectId: "fx" },
    ...o,
  }) as NotificationRecord;

const tok = (id: string, sceneId: string, o: Partial<TokenView> = {}) =>
  ({ id, sceneId, ownerPlayerId: "p1", characterId: "mira", ...o }) as TokenView;

function store(
  you: RecordStore["you"],
  o: { notes?: NotificationRecord[]; tokens?: TokenView[]; seq?: number; bound?: string[] } = {},
): RecordStore {
  const byId = (rows: { id: string }[]) => Object.fromEntries(rows.map((r) => [r.id, r]));
  return {
    you,
    seq: o.seq ?? 0,
    records: {
      notification: byId(o.notes ?? []),
      token: byId(o.tokens ?? []),
      encounter: { e1: { id: "e1", status: "started" } },
      combatant: byId(
        (o.bound ?? []).map((tokenId, i) => ({
          id: `k${i}`,
          encounterId: "e1",
          tokenId,
          active: true,
          removed: false,
        })),
      ),
      effect: { fx: { id: "fx", targetCharacterId: "mira" } },
    },
  };
}

const live = (s: RecordStore): SyncView => ({ state: "live", store: s });

describe("FR-NOTE-30 cue predicate", () => {
  test("FR-NOTE-30 cue predicate: live NotificationCreated + pending + player owner → cue; snapshot, resync, info row, DM-owned row, player client → none", () => {
    const ask = note("a", 5);
    const before = live(store(DM, { seq: 1 }));
    const after = live(store(DM, { notes: [ask], seq: 2 }));
    expect(cueTriggers(before, after, "event").map((n) => n.id)).toEqual(["a"]);
    expect(cueTriggers(before, after, "connect")).toEqual([]);
    expect(cueTriggers(before, after, "resync")).toEqual([]);
    expect(cueTriggers(null, after, "connect")).toEqual([]);
    const info = note("i", 6, { state: "info", actionRole: null, actionPlayerId: null });
    const dmOwned = note("d", 7, { actionRole: "dm", actionPlayerId: null });
    const more = live(store(DM, { notes: [ask, info, dmOwned], seq: 3 }));
    expect(cueTriggers(after, more, "event")).toEqual([]);
    const p1Before = live(store(P1, { seq: 1 }));
    const p1After = live(store(P1, { notes: [ask], seq: 2 }));
    expect(cueTriggers(p1Before, p1After, "event")).toEqual([]);
  });

  test("FR-NOTE-30 default tokens: the owner's bound token on the viewed scene, else every owned token there; hook wins", () => {
    const tokens = [
      tok("t-mira", "s1"),
      tok("t-mira-2", "s1"),
      tok("t-mira-far", "s2"),
      tok("t-thorn", "s1", { ownerPlayerId: "p2", characterId: "thorn" }),
    ];
    const ask = note("a", 1, { kind: "test" });
    expect(defaultCueTokens(ask, store(DM, { tokens, bound: ["t-mira-2"] }), "s1")).toEqual([
      "t-mira-2",
    ]);
    expect(defaultCueTokens(ask, store(DM, { tokens }), "s1")).toEqual(["t-mira", "t-mira-2"]);
    expect(defaultCueTokens(ask, store(DM, { tokens, bound: ["t-mira-far"] }), "s1")).toEqual([
      "t-mira",
      "t-mira-2",
    ]);
    expect(defaultCueTokens(ask, store(DM, { tokens }), null)).toEqual([]);
    const hooked = defineNotificationView({
      kind: "test",
      icon: () => null,
      cueTokens: () => ["t-thorn"],
    });
    expect(cueTokensFor(hooked, ask, store(DM, { tokens }), "s1")).toEqual(["t-thorn"]);
  });
});

describe("FR-NOTE-30 cue lifetime", () => {
  let now = 1000;
  afterEach(() => {
    clearCues();
    setCueClock(null);
  });
  const view = (client: "dm" | "player"): TokenOverlayView => ({
    client,
    selected: false,
    targeting: false,
  });

  test("FR-NOTE-30 4 s expiry, restart on a second cue; label = the text; player client none; subscribe notifies", () => {
    setCueClock(() => now);
    const ask = note("a", 1, { kind: "test" });
    const tokens = [tok("t-mira", "s1")];
    const s = store(DM, { notes: [ask], tokens });
    let changes = 0;
    const off = noteCueOverlay.subscribe?.(() => {
      changes++;
    });
    startCues([ask], () => undefined);
    expect(changes).toBe(1);
    const t = tokens[0] as TokenView;
    expect(noteCueOverlay.decorate?.(t, s, view("dm"))).toEqual({
      cue: { id: NOTE_CUE_ID, label: "Mira: concentration save DC 10 (Bless)" },
    });
    expect(noteCueOverlay.decorate?.(t, s, view("player"))).toBeNull();
    now += CUE_MS - 1000;
    startCues([ask], () => undefined); // restart
    now += 2000;
    expect(noteCueOverlay.decorate?.(t, s, view("dm"))?.cue?.id).toBe(NOTE_CUE_ID);
    now += CUE_MS;
    expect(noteCueOverlay.decorate?.(t, s, view("dm"))).toBeNull();
    // A resolved row stops cueing at once.
    startCues([ask], () => undefined);
    const resolved = store(DM, { notes: [{ ...ask, state: "resolved" }], tokens });
    expect(noteCueOverlay.decorate?.(t, resolved, view("dm"))).toBeNull();
    off?.();
  });
});

describe("FR-CBTX-49 cueTokens", () => {
  test("FR-CBTX-49 cueTokens: bound combatant's token; else the character's tokens on the viewed scene; other scene → none", () => {
    const n = note("c", 1);
    const tokens = [tok("t-mira", "s1"), tok("t-mira-2", "s1"), tok("t-mira-far", "s2")];
    expect(concentrationCueTokens(n, store(DM, { tokens, bound: ["t-mira"] }), "s1")).toEqual([
      "t-mira",
    ]);
    expect(concentrationCueTokens(n, store(DM, { tokens }), "s1")).toEqual(["t-mira", "t-mira-2"]);
    expect(
      concentrationCueTokens(n, store(DM, { tokens: [tokens[2] as TokenView] }), "s1"),
    ).toEqual([]);
  });
});
