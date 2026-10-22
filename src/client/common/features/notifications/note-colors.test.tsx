// FR-NOTE-39–41 (NOTE §13 unit, sprint 5 K4): static render of the toast stack and the history
// window over a fake sync store. Rows carry K0's `byRole` / `byPlayerId` stamp as `notify` writes
// it (DM → dm / null, player → player / id, system and pre-sprint-5 rows → null / null).
import { describe, expect, test } from "bun:test";
import { type PaletteKey, PLAYER_COLORS } from "@shared/campaign-management/colors";
import type { NotificationRecord } from "@shared/notifications/schemas";
import { emptyStore, type RecordStore } from "@shared/protocol/store";
import { renderToStaticMarkup } from "react-dom/server";
import { createStore } from "zustand";
import { TooltipProvider } from "../../components/ui/overlays";
import { SyncContext, type SyncState } from "../../sync/store";
import { createWindowRegistry } from "../play-shell/registry";
import { ShellProvider } from "../play-shell/ShellContext";
import { HistoryBody } from "./HistoryWindow";
import { byAttr, causerOf, closerOf, NOTIFICATION_TYPE } from "./logic";
import type { NoteClient } from "./note-client";
import { ToastRuntime } from "./ToastRuntime";
import { initialToasts, type ToastMemory, type ToastMemoryStore } from "./toasts";
import { createNotificationViews } from "./views";

const P1 = "pl-1";
const P2 = "pl-2";

const row = (o: Partial<NotificationRecord> & { id: string }): NotificationRecord => ({
  campaignId: "c1",
  seq: 1,
  kind: "test",
  audience: "dm",
  audiencePlayerId: null,
  text: `Note ${o.id}`,
  payload: null,
  actionLabel: null,
  actionRole: null,
  actionPlayerId: null,
  state: "info",
  resolution: null,
  closedAt: null,
  closedByRole: null,
  closedByPlayerId: null,
  byRole: "dm",
  byPlayerId: null,
  createdAt: "2026-10-19T10:00:00.000Z",
  updatedAt: "2026-10-19T10:00:00.000Z",
  ...o,
});

/** player-1's test send: a pending card to the DM (like a damage card, FR-NOTE-22). */
const p1Card = row({
  id: "n1",
  seq: 1,
  byRole: "player",
  byPlayerId: P1,
  state: "pending",
  actionLabel: "Apply",
  actionRole: "dm",
});
/** The DM's info to Player 2. */
const dmInfo = row({ id: "n2", seq: 2, audience: "player", audiencePlayerId: P2 });
/** A pre-sprint-5 row (no stamp) and a system-actor row: null / null. */
const oldRow = row({ id: "n3", seq: 3, byRole: null, byPlayerId: null });
/** Caused by a player whose `player` row is gone. */
const ghost = row({ id: "n4", seq: 4, byRole: "player", byPlayerId: "pl-gone" });
/** Resolved rows: by player-1, by the DM, by a rule ("Closed"). */
const byP1 = row({
  id: "n5",
  seq: 5,
  state: "resolved",
  actionLabel: "Done",
  closedByRole: "player",
  closedByPlayerId: P1,
  closedAt: "2026-10-19T10:01:00.000Z",
});
const byDm = row({ ...byP1, id: "n6", seq: 6, closedByRole: "dm", closedByPlayerId: null });
const closed = row({ ...byP1, id: "n7", seq: 7, closedByRole: null, closedByPlayerId: null });

const ALL = [p1Card, dmInfo, oldRow, ghost, byP1, byDm, closed];

function storeOf(
  rows: NotificationRecord[],
  colors: { p1?: PaletteKey; dm?: PaletteKey } = {},
): RecordStore {
  const byId = <T extends { id: string }>(xs: T[]) => Object.fromEntries(xs.map((r) => [r.id, r]));
  return {
    ...emptyStore(),
    you: { campaignId: "c1", role: "dm", playerId: null },
    records: {
      [NOTIFICATION_TYPE]: byId(rows),
      campaign: byId([{ id: "c1", name: "Fixture Campaign", dmColor: colors.dm ?? "amber" }]),
      player: byId([
        { id: P1, campaignId: "c1", name: "Player 1", color: colors.p1 ?? "jade" },
        { id: P2, campaignId: "c1", name: "Player 2", color: "blue" },
      ]),
    },
  } as unknown as RecordStore;
}

const views = createNotificationViews([]);

function render(store: RecordStore, part: "toasts" | "history"): string {
  const sync = createStore<SyncState>()(
    () =>
      ({
        state: "live",
        store,
        notLiveSince: null,
        everLive: true,
        connection: { onEvent: () => () => {}, sendIntent: () => Promise.resolve({}) },
      }) as unknown as SyncState,
  );
  // A static render reads a store's initial state: the stack starts with a toast for each of the
  // first three rows (the visible maximum: the card, the DM's info, the unstamped row).
  const rows = (
    Object.values(store.records[NOTIFICATION_TYPE] ?? {}) as NotificationRecord[]
  ).slice(0, 3);
  const memory = createStore<ToastMemory>()(() => ({
    campaignId: "c1",
    toasts: {
      ...initialToasts(0),
      toasts: rows.map((n) => ({
        key: n.id,
        kind: "note" as const,
        notificationId: n.id,
        sticky: true,
        remaining: 0,
      })),
    },
  }));
  const note = {} as NoteClient;
  // The shell's title marker takes `document` at render; a stub is enough for a static render
  // (no theme vars: `colorHex` falls back to the palette).
  const g = globalThis as { document?: unknown; getComputedStyle?: unknown; window?: unknown };
  g.document = { title: "", hidden: false, documentElement: {} };
  g.window = { innerWidth: 1440, innerHeight: 900 };
  g.getComputedStyle = () => ({ getPropertyValue: () => "" });
  try {
    return renderMarkup(sync, memory, note, part);
  } finally {
    delete g.document;
    delete g.getComputedStyle;
    delete g.window;
  }
}

function renderMarkup(
  sync: Parameters<typeof SyncContext.Provider>[0]["value"],
  memory: ToastMemoryStore,
  note: NoteClient,
  part: "toasts" | "history",
): string {
  return renderToStaticMarkup(
    <SyncContext.Provider value={sync}>
      <ShellProvider registry={createWindowRegistry("dm", [])}>
        <TooltipProvider delayDuration={0} skipDelayDuration={0}>
          {part === "toasts" ? (
            <ToastRuntime views={views} note={note} memory={memory} />
          ) : (
            <HistoryBody views={views} note={note} />
          )}
        </TooltipProvider>
      </ShellProvider>
    </SyncContext.Provider>,
  );
}

/** Each toast / row's opening tag and its inner HTML, by record id. */
function boxes(html: string, testId: "note-toast" | "note-history-row") {
  const out = new Map<string, { tag: string; body: string }>();
  const el = testId === "note-toast" ? "div" : "li";
  const re = new RegExp(`<${el} [^>]*data-testid="${testId}"[^>]*>`, "g");
  const starts = [...html.matchAll(re)];
  starts.forEach((m, i) => {
    const id = /data-record-id="([^"]+)"/.exec(m[0])?.[1] ?? "";
    const end = starts[i + 1]?.index ?? html.length;
    out.set(id, { tag: m[0], body: html.slice((m.index ?? 0) + m[0].length, end) });
  });
  return out;
}
const attr = (tag: string, name: string) => new RegExp(` ${name}="([^"]*)"`).exec(tag)?.[1];
const stripeOf = (body: string) =>
  /<span aria-hidden="true" data-testid="note-stripe"[^>]*style="background-color:([^"]+)"/.exec(
    body,
  )?.[1] ?? null;

describe("FR-NOTE-39 accent stripe", () => {
  test("FR-NOTE-39 accent stripe: toast and row in the causer's colour; null stamp none; pending border kept", () => {
    const store = storeOf(ALL);
    for (const part of ["toasts", "history"] as const) {
      const b = boxes(render(store, part), part === "toasts" ? "note-toast" : "note-history-row");
      expect(b.size).toBe(part === "toasts" ? 3 : ALL.length);
      const card = b.get("n1");
      expect(attr(card?.tag ?? "", "data-by")).toBe(P1);
      expect(attr(card?.tag ?? "", "data-color")).toBe("jade");
      expect(stripeOf(card?.body ?? "")).toBe(PLAYER_COLORS.jade);
      const info = b.get("n2");
      expect(attr(info?.tag ?? "", "data-by")).toBe("dm");
      expect(attr(info?.tag ?? "", "data-color")).toBe("amber");
      expect(stripeOf(info?.body ?? "")).toBe(PLAYER_COLORS.amber);
      const old = b.get("n3");
      expect(attr(old?.tag ?? "", "data-by")).toBeUndefined();
      expect(attr(old?.tag ?? "", "data-color")).toBeUndefined();
      expect(old?.body).not.toContain("note-stripe");
      // The stripe sits inside the box (relative parent), 3 px wide.
      expect(card?.tag).toContain("relative");
      expect(card?.body).toContain("w-[3px]");
      if (part === "history") expect(card?.tag).toContain("border-primary");
    }
  });

  test("FR-NOTE-39 accent stripe: stamp → person (pure)", () => {
    expect(causerOf(p1Card)).toEqual({ role: "player", playerId: P1 });
    expect(causerOf(dmInfo)).toEqual({ role: "dm", playerId: null });
    expect(causerOf(oldRow)).toBeNull();
    expect([p1Card, dmInfo, oldRow].map(byAttr)).toEqual([P1, "dm", undefined]);
  });
});

describe("FR-NOTE-40 names", () => {
  test("FR-NOTE-40 names: 'Resolved by ‹name›' in the closer's colour; 'Closed' unchanged", () => {
    const b = boxes(render(storeOf(ALL), "history"), "note-history-row");
    const nameTag = (id: string) =>
      /<span data-testid="note-history-closed-by"[^>]*>([^<]*)<\/span>/.exec(b.get(id)?.body ?? "");
    const p1 = nameTag("n5");
    expect(p1?.[1]).toBe("Player 1");
    expect(attr(p1?.[0] ?? "", "data-color")).toBe("jade");
    expect(p1?.[0]).toContain(`style="color:${PLAYER_COLORS.jade}"`);
    const dm = nameTag("n6");
    expect(dm?.[1]).toBe("DM");
    expect(attr(dm?.[0] ?? "", "data-color")).toBe("amber");
    // Badge text unchanged ("Resolved by Player 1"), on an outline badge (the window surface).
    const badge = (id: string) =>
      /<span[^>]*data-testid="note-history-state"[^>]*>([\s\S]*?)<\/span><\/span>|<span[^>]*data-testid="note-history-state"[^>]*>([^<]*)<\/span>/.exec(
        b.get(id)?.body ?? "",
      );
    expect(badge("n5")?.[0].replace(/<[^>]+>/g, "")).toBe("Resolved by Player 1");
    expect(badge("n5")?.[0]).not.toContain("bg-secondary");
    // "Closed" (a rule closed it): no name span, secondary as before.
    expect(nameTag("n7")).toBeNull();
    expect(badge("n7")?.[0]).toContain(">Closed<");
    expect(badge("n7")?.[0]).toContain("bg-secondary");
    expect(closerOf(closed)).toBeNull();
    expect(closerOf(p1Card)).toBeNull();
  });
});

describe("FR-NOTE-41 old rows", () => {
  test("FR-NOTE-41 old rows: null stamp → no stripe; unknown player → none; a player upsert restripes", () => {
    let b = boxes(render(storeOf(ALL), "history"), "note-history-row");
    expect(b.get("n3")?.body).not.toContain("note-stripe");
    // Unknown player: `data-by` names them, no colour, no stripe (no role accent).
    expect(attr(b.get("n4")?.tag ?? "", "data-by")).toBe("pl-gone");
    expect(attr(b.get("n4")?.tag ?? "", "data-color")).toBeUndefined();
    expect(b.get("n4")?.body).not.toContain("note-stripe");
    // player-1 picks rose, the DM yellow: derived at render (the live re-render is e2e K7).
    const next = storeOf(ALL, { p1: "rose", dm: "yellow" });
    for (const part of ["toasts", "history"] as const) {
      b = boxes(render(next, part), part === "toasts" ? "note-toast" : "note-history-row");
      expect(stripeOf(b.get("n1")?.body ?? "")).toBe(PLAYER_COLORS.rose);
      expect(stripeOf(b.get("n2")?.body ?? "")).toBe(PLAYER_COLORS.yellow);
    }
  });
});

describe("FR-SHELL-100 note.history compact rows (walkthrough N1)", () => {
  test("FR-SHELL-100 note.history useful size: the DM's audience and state badges are as tall as the time text (rows match the players', pending + 3 at 360 × 412)", () => {
    const html = render(storeOf(ALL), "history");
    const badges = [
      ...html.matchAll(/<span [^>]*data-testid="note-history-(audience|state)"[^>]*>/g),
    ];
    expect(badges.length).toBeGreaterThan(0);
    for (const [tag] of badges) {
      expect(tag).toContain("py-0");
      expect(tag).toContain("leading-[14px]");
    }
  });
});
