// NOTE §13 unit level, client: toast trigger, summary, timers, cap, button rules, unread, seen.
import { describe, expect, test } from "bun:test";
import type { NotificationRecord } from "@shared/notifications/schemas";
import type { RecordStore } from "@shared/protocol/store";
import {
  actionButton,
  audienceLabel,
  classify,
  dismissButton,
  historySections,
  rejectMessage,
  type SyncView,
  seenKey,
  stateLabel,
  summaryCount,
  summaryText,
  toastTriggers,
  unreadCount,
} from "./logic";
import { createSeenStore } from "./seen";
import {
  addNote,
  closeToast,
  INFO_TOAST_MS,
  initialToasts,
  nextExpiry,
  pruneToasts,
  setHidden,
  setHovered,
  setSummary,
  syncToasts,
  type ToastMemory,
  visibleToasts,
} from "./toasts";

let seq = 0;
function note(p: Partial<NotificationRecord> = {}): NotificationRecord {
  seq += 1;
  return {
    id: `n${seq}`,
    campaignId: "c1",
    seq,
    kind: "test",
    audience: "all",
    audiencePlayerId: null,
    text: `t${seq}`,
    payload: {},
    actionLabel: null,
    actionRole: null,
    actionPlayerId: null,
    state: "info",
    resolution: null,
    closedAt: null,
    closedByRole: null,
    closedByPlayerId: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...p,
  };
}
const pendingFor = (role: "dm" | "player", playerId: string | null = null, p = {}) =>
  note({
    state: "pending",
    actionLabel: "Go",
    actionRole: role,
    actionPlayerId: playerId,
    ...(role === "player" ? { audience: "player", audiencePlayerId: playerId } : {}),
    ...p,
  });

const DM = { campaignId: "c1", role: "dm" as const, playerId: null };
const P1 = { campaignId: "c1", role: "player" as const, playerId: "p1" };
const P2 = { campaignId: "c1", role: "player" as const, playerId: "p2" };

function store(you: RecordStore["you"], rows: NotificationRecord[], s = 0): RecordStore {
  return {
    you,
    seq: s,
    records: { notification: Object.fromEntries(rows.map((r) => [r.id, r])) },
  };
}
const view = (st: RecordStore, state: SyncView["state"] = "live"): SyncView => ({
  state,
  store: st,
});

describe("toast trigger (FR-NOTE-13)", () => {
  test("FR-NOTE-13 event vs snapshot: only event frames toast; snapshots never per item", () => {
    const a = note();
    const b = note();
    const snap = store(DM, [a], 0);
    expect(classify(null, view(snap))).toBe("connect");
    expect(toastTriggers(null, view(snap))).toEqual([]);
    const ev = store(DM, [a, b], 1);
    expect(classify(view(snap), view(ev))).toBe("event");
    expect(toastTriggers(view(snap), view(ev)).map((n) => n.id)).toEqual([b.id]);
    // A resync snapshot while live that brings a new row: no toast.
    const resync = store(DM, [a, b, note()], 0);
    expect(classify(view(ev), view(resync))).toBe("resync");
    expect(toastTriggers(view(ev), view(resync))).toEqual([]);
    // Reconnect snapshot (was not live): connect, no per-item toast.
    expect(classify(view(ev, "reconnecting"), view(resync))).toBe("connect");
    // Campaign switch while live counts as a connect.
    const other = store({ ...DM, campaignId: "c2" }, [], 0);
    expect(classify(view(ev), view(other))).toBe("connect");
    // No store change → nothing.
    expect(classify(view(ev), view(ev, "reconnecting"))).toBeNull();
  });

  test("FR-NOTE-13 audience: info → DM for dm/all; player for visible rows", () => {
    const base = note({ audience: "all" });
    const cases = [
      note({ audience: "all" }),
      note({ audience: "dm" }),
      note({ audience: "player", audiencePlayerId: "p1" }),
    ];
    const got = (you: RecordStore["you"]) =>
      cases.map((n) => {
        const prev = store(you, [base], 3);
        const next = store(you, [base, n], 4);
        return toastTriggers(view(prev), view(next)).length;
      });
    expect(got(DM)).toEqual([1, 1, 0]);
    expect(got(P1)).toEqual([1, 0, 1]);
    expect(got(P2)).toEqual([1, 0, 0]);
  });

  test("FR-NOTE-13 pending → the action owner only (damage card to a player: DM toasts, player doesn't)", () => {
    const base = note();
    const card = pendingFor("dm", null, { audience: "player", audiencePlayerId: "p1" });
    const ask = pendingFor("player", "p1");
    const run = (you: RecordStore["you"], n: NotificationRecord) =>
      toastTriggers(view(store(you, [base], 1)), view(store(you, [base, n], 2))).length;
    expect([run(DM, card), run(P1, card), run(P2, card)]).toEqual([1, 0, 0]);
    expect([run(DM, ask), run(P1, ask), run(P2, ask)]).toEqual([0, 1, 0]);
  });

  test("FR-NOTE-13 a below-floor row changing state live (new ID, old seq) is not a creation", () => {
    const old = pendingFor("dm", null, { state: "pending" });
    const newer = note();
    const prev = store(DM, [newer], 5);
    const next = store(DM, [newer, old], 6);
    expect(toastTriggers(view(prev), view(next))).toEqual([]);
  });
});

describe("summary (FR-NOTE-15)", () => {
  test("FR-NOTE-15 summary on load/reconnect only, not on resync while live", () => {
    const rows = [pendingFor("dm"), pendingFor("player", "p1"), note()];
    const dm = store(DM, rows, 0);
    expect(summaryCount("connect", dm)).toBe(1);
    expect(summaryCount("resync", dm)).toBe(0);
    expect(summaryCount("event", dm)).toBe(0);
    expect(summaryCount("connect", store(P1, rows, 0))).toBe(1);
    expect(summaryCount("connect", store(P2, rows, 0))).toBe(0);
    expect(summaryText(1)).toBe("1 pending action");
    expect(summaryText(3)).toBe("3 pending actions");
  });
});

describe("reconnect and reload (FR-NOTE-14/15, NOTE §11)", () => {
  // What the runtime does per sync change, over the page's toast memory.
  const step = (m: ToastMemory, prev: SyncView | null, next: SyncView, now = 0) =>
    syncToasts(m, prev, next, classify(prev, next), now);
  const fresh = (): ToastMemory => ({ toasts: initialToasts(0), campaignId: null });
  const shown = (m: ToastMemory) =>
    m.toasts.toasts.map((t) => (t.kind === "summary" ? `summary:${t.count}` : t.key));

  // DM live with a damage card that arrived by event → sticky toast.
  const other = note();
  const card = pendingFor("dm", null, { audience: "player", audiencePlayerId: "p1" });
  const before = view(store(DM, [other], 4));
  const withCard = view(store(DM, [other, card], 5));
  const live = () => step(step(fresh(), null, before), before, withCard);

  test("FR-NOTE-15 FR-NOTE-14 reconnect (server restart): the card toast stays, one summary toast", () => {
    const m = live();
    expect(shown(m)).toEqual([card.id]);
    const down = view(withCard.store, "reconnecting");
    const back = view(store(DM, [other, card], 0));
    const after = step(step(m, withCard, down), down, back);
    expect(shown(after)).toEqual([card.id, `summary:1`]);
    // Players rejoining (presence events) change nothing.
    const presence = view({ ...back.store, seq: 1 });
    expect(shown(step(after, back, presence))).toEqual([card.id, "summary:1"]);
  });

  test("FR-NOTE-15 runtime mounted after events followed the snapshot: still a connect + summary", () => {
    const m = step(fresh(), null, view(store(DM, [other, card], 3)));
    expect(shown(m)).toEqual(["summary:1"]);
    expect(m.campaignId).toBe("c1");
  });

  test("FR-NOTE-14 remount on a fresh connection (DM retry after a throttled 4401) keeps the card toast", () => {
    // Same page memory, new sync store: the runtime's first look is `prev` null.
    const m = step(live(), null, view(store(DM, [other, card], 2)));
    expect(shown(m)).toEqual([card.id, "summary:1"]);
  });

  test("FR-NOTE-13 FR-NOTE-15 reload: no per-item toast, only the summary; card still reachable", () => {
    const m = step(fresh(), null, view(store(DM, [other, card], 0)));
    expect(shown(m)).toEqual(["summary:1"]);
    expect(historySections(store(DM, [other, card])).pending.map((n) => n.id)).toEqual([card.id]);
  });

  test("FR-NOTE-15 no summary on a resync while live; a campaign switch clears the stack", () => {
    const m = live();
    expect(shown(step(m, withCard, view(store(DM, [other, card], 0))))).toEqual([card.id]);
    const switched = view(store({ ...DM, campaignId: "c2" }, [], 0));
    const after = step(m, withCard, switched);
    expect(shown(after)).toEqual([]);
    expect(after.campaignId).toBe("c2");
  });
});

describe("toast timers and cap (FR-NOTE-14)", () => {
  test("FR-NOTE-14 info hides after 6 s; timer pauses while hovered and while the tab is hidden", () => {
    let s = initialToasts(0);
    s = addNote(s, note(), 0);
    s = setHovered(s, true, 2000);
    expect(nextExpiry(s)).toBeNull();
    s = setHovered(s, false, 60_000); // 58 s hovered: no time spent
    expect(nextExpiry(s)).toBe(INFO_TOAST_MS - 2000);
    s = setHidden(s, true, 61_000);
    s = setHidden(s, false, 600_000);
    expect(visibleToasts(s).shown).toHaveLength(1);
    s = setHovered(s, false, 600_000 + 2999);
    expect(s.toasts).toHaveLength(1);
    s = setHovered(s, false, 600_000 + 3000);
    expect(s.toasts).toHaveLength(0);
  });

  test("FR-NOTE-14 pending stays until it leaves pending or is closed (closing ≠ dismissing)", () => {
    const p = pendingFor("dm");
    let s = addNote(initialToasts(0), p, 0);
    s = setHovered(s, false, 3_600_000);
    expect(s.toasts).toHaveLength(1);
    const st = store(DM, [p], 1);
    expect(pruneToasts(s, st, 3_600_000).toasts).toHaveLength(1);
    const resolved = store(DM, [{ ...p, state: "resolved" }], 2);
    expect(pruneToasts(s, resolved, 3_600_001).toasts).toHaveLength(0);
    expect(closeToast(s, p.id, 1).toasts).toHaveLength(0);
  });

  test("FR-NOTE-14 at most 3 visible; the rest are '+N more'", () => {
    let s = initialToasts(0);
    const ns = [note(), note(), note(), note(), note()];
    for (const n of ns) s = addNote(s, n, 0);
    s = addNote(s, ns[0] as NotificationRecord, 0); // no duplicates
    const v = visibleToasts(s);
    expect(v.more).toBe(2);
    expect(v.shown.map((t) => t.key)).toEqual(ns.slice(2).map((n) => n.id));
  });

  test("FR-NOTE-15 summary toast follows the pending-for-me count", () => {
    const a = pendingFor("dm");
    const b = pendingFor("dm");
    let s = setSummary(initialToasts(0), 2, 0);
    expect(s.toasts[0]).toMatchObject({ kind: "summary", count: 2 });
    s = pruneToasts(s, store(DM, [a, { ...b, state: "dismissed" }], 1), 1);
    expect(s.toasts[0]).toMatchObject({ kind: "summary", count: 1 });
    s = pruneToasts(s, store(DM, [{ ...a, state: "resolved" }], 2), 2);
    expect(s.toasts).toHaveLength(0);
    expect(setSummary(initialToasts(0), 0, 0).toasts).toHaveLength(0);
  });
});

describe("buttons, list, labels (FR-NOTE-16/17/20)", () => {
  const generic = { genericResolve: true };
  test("FR-NOTE-16 action button: pending, owner or DM, handler or genericResolve; disabled unless live", () => {
    const ask = pendingFor("player", "p1");
    const dmV = { role: "dm" as const, playerId: null };
    const p1V = { role: "player" as const, playerId: "p1" };
    const p2V = { role: "player" as const, playerId: "p2" };
    expect(actionButton(ask, dmV, true, generic)).toBe("enabled");
    expect(actionButton(ask, p1V, true, generic)).toBe("enabled");
    expect(actionButton(ask, p2V, true, generic)).toBe("none");
    expect(actionButton(ask, p1V, false, generic)).toBe("disabled");
    expect(actionButton(ask, p1V, true, undefined)).toBe("none");
    expect(actionButton(ask, p1V, true, { onAction: () => {} })).toBe("enabled");
    expect(actionButton({ ...ask, state: "resolved" }, dmV, true, generic)).toBe("none");
    const card = pendingFor("dm", null, { audience: "player", audiencePlayerId: "p1" });
    expect(actionButton(card, p1V, true, generic)).toBe("none");
    expect(dismissButton(card, dmV, true)).toBe("enabled");
    expect(dismissButton(card, dmV, false)).toBe("disabled");
    expect(dismissButton(card, p1V, true)).toBe("none");
    expect(dismissButton(note(), dmV, true)).toBe("none");
  });

  test("FR-NOTE-17 sections: Pending (DM all; player own) then History, newest first; labels", () => {
    const info = note();
    const card = pendingFor("dm", null, { audience: "player", audiencePlayerId: "p1" });
    const ask = pendingFor("player", "p1");
    const done = note({ state: "resolved", closedByRole: "player", closedByPlayerId: "p1" });
    const rows = [info, card, ask, done];
    const dm = historySections(store(DM, rows));
    expect(dm.pending.map((n) => n.id)).toEqual([ask.id, card.id]);
    expect(dm.history.map((n) => n.id)).toEqual([done.id, info.id]);
    const p1 = historySections(store(P1, rows));
    expect(p1.pending.map((n) => n.id)).toEqual([ask.id]);
    expect(p1.history.map((n) => n.id)).toEqual([done.id, card.id, info.id]);
    const names = (id: string | null) => (id === "p1" ? "Player 1" : "?");
    expect(stateLabel(done, names)).toBe("Resolved by Player 1");
    expect(stateLabel({ ...done, closedByRole: "dm", closedByPlayerId: null }, names)).toBe(
      "Resolved by DM",
    );
    expect(stateLabel(card, names)).toBe("Pending");
    expect(stateLabel({ ...card, state: "dismissed" }, names)).toBe("Dismissed");
    expect(stateLabel(info, names)).toBeNull();
    expect([audienceLabel(info, names), audienceLabel(card, names)]).toEqual(["All", "Player 1"]);
    expect(audienceLabel(note({ audience: "dm" }), names)).toBe("DM");
  });

  test("FR-NOTE-20 reject: conflict → 'No longer pending', else the message", () => {
    expect(rejectMessage({ code: "conflict", message: "x" })).toBe("No longer pending");
    expect(rejectMessage({ code: "forbidden", message: "Not allowed" })).toBe("Not allowed");
    expect(rejectMessage(null)).toBe("Action failed");
  });
});

describe("unread (FR-NOTE-18)", () => {
  test("FR-NOTE-18 unread = addressed rows with seq > last seen; key per campaign and owner", () => {
    const info = note({ audience: "all" });
    const dmOnly = note({ audience: "dm" });
    const ask = pendingFor("player", "p1");
    const card = pendingFor("dm", null, { audience: "player", audiencePlayerId: "p1" });
    const rows = [info, dmOnly, ask, card];
    expect(unreadCount(store(DM, rows), 0)).toBe(3);
    expect(unreadCount(store(P1, rows), 0)).toBe(2);
    expect(unreadCount(store(P1, rows), ask.seq)).toBe(0);
    expect(unreadCount(store(P2, rows), 0)).toBe(1);
    expect(seenKey(store(DM, []))).toBe("pp.note.seen.v1.c1.dm");
    expect(seenKey(store(P1, []))).toBe("pp.note.seen.v1.c1.p1");
  });

  test("FR-NOTE-18 seen store: localStorage-like backend; failure → memory only, one warning", () => {
    const data = new Map<string, string>();
    const ok = createSeenStore(() => ({
      getItem: (k) => data.get(k) ?? null,
      setItem: (k, v) => void data.set(k, v),
    }));
    expect(ok.get("k")).toBeNull();
    ok.set("k", 7);
    expect([ok.get("k"), data.get("k")]).toEqual([7, "7"]);
    const warnings: string[] = [];
    const broken = createSeenStore(
      () => {
        throw new Error("blocked");
      },
      (m) => warnings.push(m),
    );
    expect(broken.get("k")).toBeNull();
    broken.set("k", 3);
    broken.set("k", 4);
    expect(broken.get("k")).toBe(4);
    expect(warnings).toHaveLength(1);
  });
});
