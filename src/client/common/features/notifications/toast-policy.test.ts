// FR-NOTE-50, -52 (sprint 8, WF4): one toast policy: classes, order from home, at most 3 cards /
// alerts / info (info held back first) + "+N more", one callout that replaces itself; each kind
// names its class. Pure model (`toasts.ts`) and the class rule (`@shared/notifications`).
import { describe, expect, test } from "bun:test";
import type { NotificationRecord } from "@shared/notifications/schemas";
import { TOAST_CLASS_MS, toastClassOf } from "@shared/notifications/toast-class";
import {
  addNote,
  alertKey,
  CALLOUT_MS,
  type ClassOf,
  classOfToast,
  clearCallout,
  clearToasts,
  createToastMemory,
  INFO_TOAST_MS,
  initialToasts,
  nextExpiry,
  registerToastMemory,
  setCallout,
  setHovered,
  setSummary,
  showCallout,
  syncAlerts,
  type ToastState,
  visibleToasts,
} from "./toasts";
import { createNotificationViews, defineNotificationView } from "./views";

let seq = 0;
function note(p: Partial<NotificationRecord> = {}): NotificationRecord {
  seq += 1;
  return {
    id: `n${seq}`,
    campaignId: "c1",
    seq,
    kind: "test",
    audience: "dm",
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
    byRole: null,
    byPlayerId: null,
    createdAt: "2026-10-22T10:00:00.000Z",
    updatedAt: "2026-10-22T10:00:00.000Z",
    ...p,
  };
}
const card = () => note({ state: "pending", actionLabel: "Apply", actionRole: "dm" });
const alertKind: ClassOf = (n) => toastClassOf(n.kind === "alerty" ? "alert" : "info", n.state);
const alert = () => note({ kind: "alerty" });

const classes = (s: ToastState, max?: number) =>
  visibleToasts(s, max).shown.map((t) => classOfToast(t));

describe("FR-NOTE-50 toast policy", () => {
  test("FR-NOTE-50 toast policy: order from home is summary, cards, alerts, info; each class oldest first", () => {
    let s = initialToasts(0);
    const [i1, a1, c1] = [note(), alert(), card()];
    for (const n of [i1, a1, c1]) s = addNote(s, n as NotificationRecord, 0, alertKind);
    s = setSummary(s, 2, 0);
    expect(classes(s)).toEqual(["summary", "card", "alert", "info"]);
    const c2 = card();
    s = addNote(s, c2, 1, alertKind);
    // 4 counted: the info is held back first; the cards keep their insertion order.
    const v = visibleToasts(s);
    expect(v.shown.map((t) => t.key)).toEqual(["summary", c1?.id, c2.id, a1?.id]);
    expect(v.more).toBe(1);
  });

  test("FR-NOTE-50 toast policy: at most 3 cards / alerts / info; info overflows before alerts before cards; the summary doesn't count", () => {
    let s = setSummary(initialToasts(0), 1, 0);
    const infos = [note(), note(), note()] as const;
    for (const n of infos) s = addNote(s, n, 0, alertKind);
    expect(visibleToasts(s)).toMatchObject({ more: 0 });
    expect(classes(s)).toEqual(["summary", "info", "info", "info"]);
    const cards = [card(), card()] as const;
    for (const n of cards) s = addNote(s, n, 1, alertKind);
    // 2 cards + the newest info; 2 info held back.
    let v = visibleToasts(s);
    expect(v.more).toBe(2);
    expect(v.shown.map((t) => t.key)).toEqual(["summary", ...cards.map((n) => n.id), infos[2].id]);
    const a = alert();
    s = addNote(s, a, 2, alertKind);
    v = visibleToasts(s);
    expect(classes(s)).toEqual(["summary", "card", "card", "alert"]);
    expect(v.more).toBe(3);
    // Four cards: the newest three show, every alert and info held back.
    const more = [card(), card()] as const;
    for (const n of more) s = addNote(s, n, 3, alertKind);
    v = visibleToasts(s);
    expect(v.shown.map((t) => t.key)).toEqual(["summary", cards[1].id, more[0].id, more[1].id]);
    expect(v.more).toBe(5);
    // P3 E3: the runtime's lowered cap keeps the order rule (at least one counted toast).
    expect(classes(s, 1)).toEqual(["summary", "card"]);
    expect(classes(s, 0)).toEqual(["summary", "card"]);
  });

  test("FR-NOTE-50 toast policy: card sticky, alert and info 6 s, callout 4 s; every timer pauses while hovered", () => {
    expect(TOAST_CLASS_MS).toEqual({ card: null, alert: 6000, info: 6000, callout: 4000 });
    let s = initialToasts(0);
    s = addNote(s, card(), 0, alertKind);
    s = addNote(s, alert(), 0, alertKind);
    s = setCallout(s, { id: "x", content: "Overkill!" }, 0);
    expect(nextExpiry(s)).toBe(CALLOUT_MS);
    s = setHovered(s, true, 1000);
    expect(nextExpiry(s)).toBeNull();
    s = setHovered(s, false, 90_000);
    expect(s.callout?.remaining).toBe(CALLOUT_MS - 1000);
    s = setHovered(s, false, 93_000);
    expect(s.callout).toBeNull();
    expect(classes(s)).toEqual(["card", "alert"]);
    s = setHovered(s, false, 90_000 - 1000 + INFO_TOAST_MS);
    expect(classes(s)).toEqual(["card"]);
  });

  test("FR-NOTE-50 toast policy: one callout at a time (a new one replaces it), outside the count of 3", () => {
    let s = initialToasts(0);
    for (const n of [card(), card(), card()]) s = addNote(s, n, 0);
    s = setCallout(s, { id: "stats-overkill", content: "a" }, 0);
    s = setCallout(s, { id: "stats-feed", content: "b", ms: 2500 }, 100);
    const v = visibleToasts(s);
    expect(v.callout).toMatchObject({ id: "stats-feed", content: "b", remaining: 2500 });
    expect(v.more).toBe(0);
    expect(v.shown).toHaveLength(3);
    // Closing another id leaves it; closing it (or any) clears it; a campaign switch clears it.
    expect(clearCallout(s, 200, "stats-overkill").callout?.id).toBe("stats-feed");
    expect(clearCallout(s, 200).callout).toBeNull();
    expect(clearToasts(s, 200).callout).toBeNull();
  });

  test("FR-NOTE-50 toast policy: showCallout reaches every mounted page stack; no stack → dropped", () => {
    showCallout({ id: "lost", content: "nobody" });
    const m = createToastMemory(Date.now());
    const off = registerToastMemory(m);
    try {
      expect(m.getState().toasts.callout ?? null).toBeNull();
      showCallout({ id: "one", content: "first" });
      showCallout({ id: "two", content: "second", ms: 1000 });
      expect(m.getState().toasts.callout).toMatchObject({ id: "two", content: "second" });
      expect(m.getState().toasts.toasts).toHaveLength(0); // no notification toast
    } finally {
      off();
    }
  });
});

describe("FR-NOTE-52 toast classes", () => {
  test("FR-NOTE-52 toast classes: a pending row is a card; else the kind's alert, else info", () => {
    expect(toastClassOf("card", "pending")).toBe("card");
    expect(toastClassOf("info", "pending")).toBe("card");
    expect(toastClassOf("card", "info")).toBe("info");
    expect(toastClassOf("alert", "info")).toBe("alert");
    expect(toastClassOf(undefined, "info")).toBe("info");
    let s = addNote(initialToasts(0), card(), 0, () => "info");
    s = addNote(s, alert(), 0, alertKind);
    s = addNote(s, note(), 0, alertKind);
    expect(s.toasts.map((t) => (t.kind === "note" ? [t.cls, t.sticky] : null))).toEqual([
      ["card", true],
      ["alert", false],
      ["info", false],
    ]);
  });

  test("FR-NOTE-52 toast classes: a view list refuses an unknown class", () => {
    const Icon = () => null;
    const ok = defineNotificationView({ kind: "a", icon: Icon, toastClass: "alert" });
    expect(createNotificationViews([ok]).get("a")?.toastClass).toBe("alert");
    const bad = { kind: "b", icon: Icon, toastClass: "toast" } as unknown as typeof ok;
    expect(() => createNotificationViews([bad])).toThrow(/unknown toast class/);
  });
});

describe("FR-NOTE-50 toast policy: alerts from toast()", () => {
  test("FR-NOTE-50 toast policy: a toast() joins as an alert (its duration, else 6 s; infinite = until closed), keeps its timer while shown, leaves when gone; between cards and info", () => {
    let s = addNote(initialToasts(0), note(), 0);
    s = addNote(s, card(), 0);
    s = syncAlerts(s, [{ id: "alert:turn" }, { id: 7, ms: 60_000 }, { id: "x", ms: Infinity }], 0);
    expect(classes(s)).toEqual(["card", "alert", "alert"]);
    expect(visibleToasts(s).more).toBe(2); // 5 counted, 3 shown: the info held back first, then an alert
    const alerts = s.toasts.filter((t) => t.kind === "alert");
    expect(alerts.map((t) => [t.key, t.sticky, t.remaining])).toEqual([
      [alertKey("alert:turn"), false, 6000],
      [alertKey(7), false, 60_000],
      [alertKey("x"), true, 0],
    ]);
    // Same list again: the same state (no timer reset).
    s = setHovered(s, false, 5000);
    expect(
      syncAlerts(s, [{ id: "alert:turn" }, { id: 7, ms: 60_000 }, { id: "x", ms: Infinity }], 5000),
    ).toBe(s);
    // 6 s: the default alert ends; the 60 s one and the sticky one stay.
    s = setHovered(s, false, 6000);
    expect(s.toasts.filter((t) => t.kind === "alert").map((t) => t.key)).toEqual([
      alertKey(7),
      alertKey("x"),
    ]);
    // Dismissed elsewhere (gone from the list) → leaves.
    s = syncAlerts(s, [{ id: 7, ms: 60_000 }], 6000);
    expect(s.toasts.filter((t) => t.kind === "alert").map((t) => t.key)).toEqual([alertKey(7)]);
    expect(alertKey("7")).not.toBe(alertKey(7));
  });
});
