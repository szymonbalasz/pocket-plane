import { describe, expect, test } from "bun:test";
import type { NotificationRecord } from "@shared/notifications/schemas";
import type { RecordStore } from "@shared/protocol/store";
import { concentrationView } from "@ui/features/combat-extras/concentration";
import { type SyncView, summaryText, waitingForPlayers } from "@ui/features/notifications/logic";
import {
  hideNote,
  initialToasts,
  pruneToasts,
  releaseHidden,
  syncToasts,
  type ToastMemory,
  type ToastState,
  visibleToasts,
} from "@ui/features/notifications/toasts";
import { createNotificationViews } from "@ui/features/notifications/views";
import { dmDamageCardView } from "./card-view";
import { pendingForEncounter, pendingRowText } from "./pending";

const views = createNotificationViews([dmDamageCardView, concentrationView]);

const note = (id: string, seq: number, o: Partial<NotificationRecord>): NotificationRecord =>
  ({
    id,
    seq,
    state: "pending",
    actionRole: "dm",
    text: id,
    ...o,
  }) as NotificationRecord;

describe("FR-CBT-79 pending list", () => {
  const card = note("card", 3, { kind: "damage-card", payload: { encounterId: "e1" } });
  const conc = note("conc", 2, {
    kind: "cbtx-concentration",
    actionRole: "player",
    text: "Mira: concentration save DC 10 (Bless)",
    payload: { effectId: "x", encounterId: "e1" },
  });
  const other = note("other", 1, {
    kind: "cbtx-concentration",
    payload: { effectId: "y", encounterId: "e2" },
  });
  const loose = note("loose", 4, { kind: "test", payload: { encounterId: "e1" } });

  test("FR-CBT-79 pending list: damage card + linked concentration card, oldest first; other encounter's, closed and unlinked kinds not listed", () => {
    const rows = [card, conc, other, loose, { ...card, id: "done", state: "resolved" as const }];
    expect(pendingForEncounter(rows, "e1", views).map((n) => n.id)).toEqual(["conc", "card"]);
    expect(pendingForEncounter(rows, "e2", views).map((n) => n.id)).toEqual(["other"]);
    expect(pendingForEncounter(rows, null, views)).toEqual([]);
  });

  test("FR-CBT-79 FR-CBT-77 sim-6 glitch 1: a linked action newer than 3 damage cards sorts first, inside the 3-row cap", () => {
    const cards = [5, 6, 7].map((seq) => ({ ...card, id: `card-${seq}`, seq }));
    const newer = { ...conc, seq: 8 };
    expect(pendingForEncounter([...cards, newer], "e1", views).map((n) => n.id)).toEqual([
      "conc",
      "card-5",
      "card-6",
      "card-7",
    ]);
  });

  test("FR-CBT-79 row text: player-owned → 'Waiting for Mira: …'; DM-owned and damage cards as their text", () => {
    expect(pendingRowText(conc)).toBe("Waiting for Mira: concentration save DC 10 (Bless)");
    expect(pendingRowText({ ...conc, actionRole: "dm" })).toBe(conc.text);
    expect(pendingRowText({ ...card, actionRole: "player" })).toBe(card.text);
  });
});

describe("FR-CBT-75 opened from a notification", () => {
  test("FR-CBT-75 placement: the card's action opens the popup at the origin rect and closes its toast", async () => {
    const { useCombatDialogs } = await import("./popup-store");
    let closed = 0;
    const rect = { x: 560, y: 92, w: 320, h: 90 };
    dmDamageCardView.onAction?.(note("card", 1, { kind: "damage-card" }), {
      send: async () => undefined,
      openWindow: () => {},
      origin: { source: "toast", rect },
      closeToast: () => {
        closed += 1;
      },
    });
    expect(useCombatDialogs.getState()).toMatchObject({ cardId: "card", origin: rect });
    expect(closed).toBe(1);
    // Pending row / own attack: no origin → FR-CBT-55/56 placement (the popup hides the toast).
    useCombatDialogs.getState().openCard("card");
    expect(useCombatDialogs.getState().origin).toBeNull();
    useCombatDialogs.getState().closeCard();
  });
});

describe("FR-CBT-77 window def", () => {
  test("FR-CBT-77 DM Initiative grows to content; activity = round:turnCombatantId of the started encounter", async () => {
    const { dmInitiativeWindow } = await import("./initiative-window");
    expect(dmInitiativeWindow.growToContent).toBe(true);
    const store = (enc: object | null) =>
      ({ you: null, seq: 0, records: { encounter: enc ? { e1: enc } : {} } }) as never;
    expect(
      dmInitiativeWindow.activity?.(
        store({ id: "e1", status: "started", round: 2, turnCombatantId: "k1" }),
      ),
    ).toBe("2:k1");
    expect(
      dmInitiativeWindow.activity?.(store({ id: "e1", status: "ended", round: 2 })),
    ).toBeNull();
    expect(dmInitiativeWindow.activity?.(store(null))).toBeNull();
  });
});

// BL-120 (sim-15 glitch 3, c02 / c07, `.verify/20261024-234809-session-sim-15/`): the DM stack's
// counts and Initiative's "Pending (n)" from one source. Exact inputs: a started encounter, the
// sim's pending cards at the connect (the summary), live cards after it, one opened and put off
// with "Later". Each repro first reads the stack as the runtime drew it before the fix (folded
// cards in "+N more", the Later card nowhere).
describe("BL-120 one count source: summary, '+N more', Pending (n)", () => {
  const DM = { campaignId: "c1", role: "dm" as const, playerId: null };
  const fight = { e1: { id: "e1", status: "started" } };
  const cardN = (i: number) =>
    note(`card-${i}`, i, { kind: "damage-card", payload: { encounterId: "e1" } });
  const storeOf = (rows: NotificationRecord[], seq = 0): RecordStore => ({
    you: DM,
    seq,
    records: { notification: Object.fromEntries(rows.map((r) => [r.id, r])), encounter: fight },
  });
  const waitingOf = (s: RecordStore) => waitingForPlayers(s, views);
  const live = (st: RecordStore): SyncView => ({ state: "live", store: st });
  /** Connect with `at` rows, then each of `later` arrives in its own event frame. */
  function play(at: NotificationRecord[], later: NotificationRecord[]): ToastState {
    let st = storeOf(at, 1);
    let m: ToastMemory = { toasts: initialToasts(0), campaignId: null };
    m = syncToasts(m, null, live(st), "connect", 0, waitingOf);
    for (const [i, n] of later.entries()) {
      const next = storeOf(
        [...Object.values(st.records.notification ?? {}), n] as NotificationRecord[],
        i + 2,
      );
      m = syncToasts(m, live(st), live(next), "event", i + 1, waitingOf);
      st = next;
    }
    return m.toasts;
  }
  const badge = (rows: NotificationRecord[]) => pendingForEncounter(rows, "e1", views).length;
  /** What the stack counts: the summary (with its folded cards and waiting part), shown cards, "+N more". */
  function onStack(s: ToastState, cap: number) {
    const v = visibleToasts(s, cap);
    const summary = v.shown.find((t) => t.kind === "summary");
    const own = summary?.kind === "summary" ? summary.count + v.inSummary : 0;
    const waiting = summary?.kind === "summary" ? (summary.waiting ?? 0) : 0;
    const cards = v.shown.filter((t) => t.kind === "note").length;
    return { own, waiting, cards, more: v.more, total: own + waiting + cards + v.more };
  }

  test("FR-CBT-79 BL-120 sim-15 c02: '1 pending action +2 more' beside Pending (3) → '3 pending actions', no '+2 more'", () => {
    const rows = [1, 2, 3].map(cardN);
    // One card at the connect (the summary), two live cards folded into it (FR-NOTE-77, cap 0).
    const s = play(rows.slice(0, 1), rows.slice(1));
    expect(badge(rows)).toBe(3);
    // Before: the folded cards were "+2 more" beside "1 pending action".
    const v = visibleToasts(s, 0);
    expect(v.more + v.inSummary).toBe(2);
    expect(onStack(s, 0)).toEqual({ own: 3, waiting: 0, cards: 0, more: 0, total: 3 });
    expect(summaryText(onStack(s, 0).own)).toBe("3 pending actions");
  });

  test("FR-CBT-79 BL-120 sim-15 c07: '5 pending actions' + 3 cards + '+1 more' = 9 beside Pending (10) → the Later card counts: 7 + 3 = 10", () => {
    const rows = Array.from({ length: 10 }, (_, i) => cardN(i + 1));
    let s = play(rows.slice(0, 5), rows.slice(5));
    expect(badge(rows)).toBe(10);
    const st = storeOf(rows);
    // The DM opens card 6's popup (its toast hides, FR-NOTE-26): the popup shows it.
    s = hideNote(s, "card-6", 10);
    expect(onStack(s, 3)).toEqual({ own: 6, waiting: 0, cards: 3, more: 0, total: 9 });
    // Before: Later left it hidden, counted nowhere: 5 + 3 cards + "+1 more" = 9.
    const v = visibleToasts(s, 3);
    expect(5 + 3 + v.more + v.inSummary).toBe(9);
    // BL-120: the popup closed with the card still pending → it counts in the summary.
    s = releaseHidden(s, ["card-6"], st, 11, waitingOf);
    expect(onStack(s, 3)).toEqual({ own: 7, waiting: 0, cards: 3, more: 0, total: 10 });
    // Its toast stays hidden (FR-NOTE-26); reopening its popup takes it out of the summary again.
    expect(s.toasts.some((t) => t.key === "card-6")).toBe(false);
    s = hideNote(s, "card-6", 12);
    expect(onStack(s, 3).total).toBe(9);
    // A pruned frame (any live change) keeps the same count.
    expect(onStack(pruneToasts(s, st, 13, waitingOf), 3).total).toBe(9);
    s = releaseHidden(s, ["card-6"], st, 14, waitingOf);
    expect(onStack(pruneToasts(s, st, 15, waitingOf), 3).total).toBe(10);
  });

  test("FR-CBT-79 BL-120 Later with no summary showing: the summary comes back for it; player-owned rows in its waiting part; resolved cards stay out", () => {
    const rows = [1, 2].map(cardN);
    const save = note("save", 3, {
      kind: "cbtx-concentration",
      actionRole: "player",
      actionPlayerId: "p1",
      payload: { effectId: "x", encounterId: "e1" },
    });
    // No pending row at the connect: no summary; two live cards.
    let s = play([], [...rows, save]);
    expect(s.toasts.some((t) => t.kind === "summary")).toBe(false);
    expect(badge([...rows, save])).toBe(3);
    s = hideNote(s, "card-1", 10);
    s = releaseHidden(s, ["card-1"], storeOf([...rows, save]), 11, waitingOf);
    expect(onStack(s, 3)).toEqual({ own: 1, waiting: 1, cards: 1, more: 0, total: 3 });
    // Applied from its popup (the resolve frame comes before the ack, then the popup closes):
    // nothing to release, no summary for it.
    let t = play([], rows);
    t = hideNote(t, "card-1", 10);
    const applied = [
      { ...rows[0], state: "resolved" } as NotificationRecord,
      rows[1] as NotificationRecord,
    ];
    t = pruneToasts(t, storeOf(applied), 11, waitingOf);
    expect(releaseHidden(t, ["card-1"], storeOf(applied), 12, waitingOf)).toBe(t);
    expect(onStack(t, 3)).toEqual({ own: 0, waiting: 0, cards: 1, more: 0, total: 1 });
  });
});
