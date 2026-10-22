// FR-NOTE-60, FR-DICEX-91 (TT2, after WF4): after the first snapshot of a load or reconnect, a
// player's open roll-request prompts re-toast as cards, silently (no cue: a connect starts none),
// and leave the "N pending" summary; other pending kinds keep the summary only; a resolved
// prompt never comes back. The runtime's predicate is the view's `restoreToast`.
import { describe, expect, test } from "bun:test";
import type { NotificationRecord } from "@shared/notifications/schemas";
import type { RecordStore } from "@shared/protocol/store";
import { classify, type SyncView } from "../notifications/logic";
import { initialToasts, syncToasts, type ToastMemory } from "../notifications/toasts";
import { cueTriggers } from "../notifications/token-cue";
import { createNotificationViews } from "../notifications/views";
import { rollRequestDmView, rollRequestPlayerView } from "./PromptViews";
import { pendingPrompts } from "./request-sound";

const P1 = { campaignId: "c1", role: "player" as const, playerId: "p1" };
let seq = 0;
const row = (kind: string, p: Partial<NotificationRecord> = {}): NotificationRecord =>
  ({
    id: `n${++seq}`,
    campaignId: "c1",
    seq,
    kind,
    audience: "player",
    audiencePlayerId: "p1",
    text: "DM: Perception · Mira",
    payload: {},
    actionLabel: "Roll",
    actionRole: "player",
    actionPlayerId: "p1",
    state: "pending",
    resolution: null,
    closedAt: null,
    closedByRole: null,
    closedByPlayerId: null,
    byRole: "dm",
    byPlayerId: null,
    createdAt: "2026-10-22T00:00:00.000Z",
    updatedAt: "2026-10-22T00:00:00.000Z",
    ...p,
  }) as NotificationRecord;
const store = (rows: NotificationRecord[]): RecordStore => ({
  you: P1,
  seq: 1,
  records: { notification: Object.fromEntries(rows.map((r) => [r.id, r])) },
});
const views = createNotificationViews([
  { ...rollRequestPlayerView, toastClass: "card" },
  { kind: "other-card", icon: rollRequestPlayerView.icon, onAction: () => {}, toastClass: "card" },
]);
const restores = (n: NotificationRecord) => views.get(n.kind)?.restoreToast === true;
const connect = (rows: NotificationRecord[], m?: ToastMemory) => {
  const next: SyncView = { state: "live", store: store(rows) };
  const base: ToastMemory = m ?? { toasts: initialToasts(0), campaignId: null };
  return syncToasts(base, null, next, classify(null, next), 0, undefined, undefined, restores);
};
const shown = (m: ToastMemory) =>
  m.toasts.toasts.map((t) =>
    t.kind === "summary" ? `summary:${t.count}` : `${t.key}:${t.kind === "note" ? t.cls : ""}`,
  );

describe("restore toast (FR-NOTE-60, FR-DICEX-91)", () => {
  test("FR-NOTE-60 restore toast: pending roll-request prompts re-toast as cards on a connect, outside the summary", () => {
    const prompt = row("roll-request");
    const other = row("other-card");
    const done = row("roll-request", { state: "resolved", resolution: { outcome: "declined" } });
    const m = connect([prompt, other, done]);
    expect(shown(m)).toEqual([`${prompt.id}:card`, "summary:1"]);
    // Only the player view sets it; the DM's view never restores.
    expect(rollRequestPlayerView.restoreToast).toBe(true);
    expect(rollRequestDmView.restoreToast).toBeUndefined();
  });

  test("FR-DICEX-91 prompt after reload: silent (a connect starts no cue), once (a reconnect keeps the one toast)", () => {
    const prompt = row("roll-request");
    const next: SyncView = { state: "live", store: store([prompt]) };
    expect(cueTriggers(null, next, classify(null, next))).toEqual([]);
    const first = connect([prompt]);
    const again = connect([prompt], first);
    expect(shown(again)).toEqual([`${prompt.id}:card`]);
  });
});

test("FR-DICEX-90 seam: pendingPrompts = this player's pending roll-request rows (the pause catch-up reads it)", () => {
  const mine = row("roll-request");
  const theirs = row("roll-request", { actionPlayerId: "p2", audiencePlayerId: "p2" });
  const done = row("roll-request", { state: "resolved" });
  const other = row("other-card");
  expect(pendingPrompts(store([mine, theirs, done, other])).map((n) => n.id)).toEqual([mine.id]);
  expect(pendingPrompts({ ...store([mine]), you: { ...P1, role: "dm", playerId: null } })).toEqual(
    [],
  );
});
