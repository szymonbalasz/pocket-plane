// FR-NOTE-17/18: window def, launcher badge = unread, baseline, mark seen while open + visible.
import { expect, test } from "bun:test";
import type { NotificationRecord } from "@shared/notifications/schemas";
import type { RecordStore } from "@shared/protocol/store";
import { badgeText } from "../play-shell/badges";
import { createNoteClient } from "./note-client";
import { createSeenStore } from "./seen";
import { testNotificationView } from "./test-view";
import { createNotificationViews } from "./views";
import { notificationsWindow } from "./window";

const row = (seq: number, p: Partial<NotificationRecord> = {}) =>
  ({
    id: `n${seq}`,
    seq,
    audience: "all",
    audiencePlayerId: null,
    actionRole: null,
    actionPlayerId: null,
    state: "info",
    ...p,
  }) as NotificationRecord;
const store = (rows: NotificationRecord[]): RecordStore => ({
  you: { campaignId: "c1", role: "player", playerId: "p1" },
  seq: 0,
  records: { notification: Object.fromEntries(rows.map((r) => [r.id, r])) },
});

function client(visible = true) {
  const data = new Map<string, string>();
  let refreshed = 0;
  const seen = createSeenStore(() => ({
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
  }));
  const note = createNoteClient({
    seen: () => seen,
    isVisible: () => visible,
    refresh: () => {
      refreshed += 1;
    },
  });
  return { note, data, refreshes: () => refreshed };
}

test("FR-NOTE-18 baseline = highest seq of the first snapshot; later rows are unread; open + visible marks seen", () => {
  const c = client();
  const first = store([row(1), row(2)]);
  expect(c.note.unread(first)).toBe(0); // no entry: nothing unread
  c.note.baseline(first);
  expect(c.data.get("pp.note.seen.v1.c1.p1")).toBe("2");
  c.note.baseline(store([row(1), row(2), row(3)])); // entry exists: unchanged
  const later = store([row(1), row(2), row(3), row(4, { audience: "dm" })]);
  expect(c.note.unread(later)).toBe(1);
  c.note.markSeen(later); // closed: no effect
  expect(c.note.unread(later)).toBe(1);
  c.note.setHistoryOpen(true, later);
  expect(c.note.unread(later)).toBe(0);
  expect(c.refreshes()).toBeGreaterThanOrEqual(2);
});

test("FR-NOTE-18 hidden tab: open window doesn't mark seen", () => {
  const c = client(false);
  c.note.baseline(store([row(1)]));
  c.note.setHistoryOpen(true, store([row(1), row(2)]));
  expect(c.note.unread(store([row(1), row(2)]))).toBe(1);
});

test("FR-NOTE-17 note.history: both clients, closed by default, 360×480 min 280×240, bell + badge, companion", () => {
  const c = client();
  const def = notificationsWindow(createNotificationViews([testNotificationView]), c.note);
  expect(def).toMatchObject({
    kind: "note.history",
    title: "Notifications",
    clients: ["dm", "player"],
    defaultSize: { w: 360, h: 480 },
    minSize: { w: 280, h: 240 },
    defaultPosition: { anchor: "bottom-right" },
  });
  expect(def.defaultOpen).toBeFalsy();
  expect(def.companion).toBeFunction();
  c.note.baseline(store([row(1)]));
  expect(def.badge?.(store([row(1), row(2), row(3)]))).toBe(2);
  expect(() => createNotificationViews([testNotificationView, testNotificationView])).toThrow(
    /twice/,
  );
});

test("OQ-NOTE-13 launcher badge text: none for ≤ 0, 99+ cap, a throwing badge shows nothing", () => {
  expect(badgeText(undefined)).toBeNull();
  expect(badgeText(() => 0)).toBeNull();
  expect(badgeText(() => 3)).toBe("3");
  expect(badgeText(() => 150)).toBe("99+");
  const warn = console.warn;
  console.warn = () => {};
  expect(
    badgeText(() => {
      throw new Error("x");
    }),
  ).toBeNull();
  console.warn = warn;
});
