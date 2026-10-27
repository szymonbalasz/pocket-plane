// Kit parity K3 (§6.5, FR-KIT-55–60 + the slice's FR-KIT-01/03/04/07 checks): the toast card row,
// its text block, the inline action, the summary row and "+N more" pill, the turn card (player alert
// and the DM's 4-s card). Static renders of the stack over a fake sync store (no layout effect runs,
// so the stack sits at its computed spot) and the pure helpers.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { COMBATANT_TYPE, ENCOUNTER_TYPE } from "@shared/combat-tracker/schemas";
import { TurnChanged } from "@shared/events/combat-tracker";
import type { NotificationRecord } from "@shared/notifications/schemas";
import { emptyStore, type RecordStore } from "@shared/protocol/store";
import { BellIcon } from "lucide-react";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { ToastT } from "sonner";
import { createStore } from "zustand";
import { TooltipProvider } from "../../components/ui/overlays";
import { SyncContext, type SyncState } from "../../sync/store";
import { colorHex } from "../campaign-management/colors";
import { dmTurnCardFor, turnAlertFor } from "../combat-tracker/turn-alert";
import { createWindowRegistry, type ShellClient } from "../play-shell/registry";
import { ShellProvider } from "../play-shell/ShellContext";
import { AlertToast, TURN_ALERT_TOAST_ID } from "./alert-toasts";
import { leadName, NOTIFICATION_TYPE, relativeTime } from "./logic";
import type { NoteClient } from "./note-client";
import { ToastRuntime } from "./ToastRuntime";
import {
  addNote,
  advance,
  clearToasts,
  initialToasts,
  nextExpiry,
  SUMMARY_KEY,
  setTurnCard,
  type ToastMemory,
  type ToastState,
  TURN_CARD_MS,
} from "./toasts";
import { createNotificationViews } from "./views";

// A pending row of kind `test` resolves generically (its action button shows).
const views = createNotificationViews([{ kind: "test", icon: BellIcon, genericResolve: true }]);
const NOW = Date.parse("2026-10-20T10:00:30.000Z");

const request: NotificationRecord = {
  id: "n1",
  campaignId: "c1",
  seq: 1,
  kind: "test",
  audience: "dm",
  audiencePlayerId: null,
  text: "Player 1 wants to add Longsword +1 to Mira's sheet",
  payload: null,
  actionLabel: "Approve",
  actionRole: "dm",
  actionPlayerId: null,
  state: "pending",
  resolution: null,
  closedAt: null,
  closedByRole: null,
  closedByPlayerId: null,
  byRole: "player",
  byPlayerId: "p1",
  createdAt: "2026-10-20T10:00:00.000Z",
  updatedAt: "2026-10-20T10:00:00.000Z",
};
/** A system row: no causer → the kind's icon leads. */
const system: NotificationRecord = {
  ...request,
  id: "n2",
  text: "Session saved",
  actionLabel: null,
  actionRole: null,
  byRole: null,
  byPlayerId: null,
};

const PLAYER = { id: "p1", campaignId: "c1", name: "Player 1", color: "#56b4e9" };

function storeFor(
  client: ShellClient,
  extra: Record<string, unknown> = {},
  rows: readonly NotificationRecord[] = [request, system],
): RecordStore {
  return {
    ...emptyStore(),
    you: { campaignId: "c1", role: client, playerId: client === "dm" ? null : "p1" },
    records: {
      [NOTIFICATION_TYPE]: Object.fromEntries(rows.map((n) => [n.id, n])),
      player: { p1: PLAYER },
      campaign: { c1: { id: "c1", name: "C", dmColor: "#e69f00" } },
      ...extra,
    },
  } as unknown as RecordStore;
}

/** The stack for `client` over `toasts` (a static render: no effects, no sonner store). */
function stackHtml(
  client: ShellClient,
  toasts: ToastState,
  wrap?: (n: ReactElement) => ReactElement,
  rows?: readonly NotificationRecord[],
) {
  const store = storeFor(client, {}, rows);
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
  const memory = createStore<ToastMemory>()(() => ({ campaignId: "c1", toasts }));
  const g = globalThis as { document?: unknown; getComputedStyle?: unknown; window?: unknown };
  g.document = { title: "", hidden: false, documentElement: {} };
  g.window = { innerWidth: 1440, innerHeight: 900 };
  g.getComputedStyle = () => ({ getPropertyValue: () => "" });
  const runtime = <ToastRuntime views={views} note={{} as NoteClient} memory={memory} />;
  try {
    return renderToStaticMarkup(
      <SyncContext.Provider value={sync}>
        <ShellProvider registry={createWindowRegistry(client, [])}>
          <TooltipProvider delayDuration={0} skipDelayDuration={0}>
            {wrap ? wrap(runtime) : runtime}
          </TooltipProvider>
        </ShellProvider>
      </SyncContext.Provider>,
    );
  } finally {
    delete g.document;
    delete g.getComputedStyle;
    delete g.window;
  }
}

const withNotes = (...ns: NotificationRecord[]) =>
  ns.reduce((s, n) => addNote(s, n, 0), initialToasts(0));
/** The `<div …data-testid="note-toast"…>…</div>` of row `id` (up to the next card). */
const toastOf = (html: string, id: string) => {
  const at = html.indexOf(`data-testid="note-toast" data-slot="toast-card" data-record-id="${id}"`);
  const next = html.indexOf('data-testid="note-toast"', at + 1);
  return html.slice(at, next < 0 ? undefined : next);
};

function alertT(o: Partial<ToastT> = {}): ToastT {
  return { id: "a1", title: "Saved", testId: "ui-alert-toast", ...o } as ToastT;
}
const alertHtml = (t: ToastT) =>
  renderToStaticMarkup(
    <TooltipProvider delayDuration={0} skipDelayDuration={0}>
      <AlertToast t={t} onClose={() => {}} />
    </TooltipProvider>,
  );

describe("FR-KIT-55 card row", () => {
  test("FR-KIT-55 card row: medallion (the causing player's initial on their colour) · text block · actions · close; the stripe stays the left edge", () => {
    const card = toastOf(stackHtml("dm", withNotes(request)), "n1");
    const order = [
      'data-testid="note-stripe"',
      'data-testid="kit-medallion"',
      'data-testid="note-text"',
      'data-testid="note-toast-action"',
      'data-testid="note-toast-close"',
    ].map((id) => card.indexOf(id));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(card).toMatch(/data-slot="kit-medallion" data-size="md"[^>]*>P</);
    expect(card).toContain(`background-color:${colorHex("#56b4e9")}`);
    expect(card).not.toContain("note-toast-icon");
  });

  test("FR-KIT-55 card row: no causing player → the kind's icon at the medallion's size; alert toasts lead with their type's icon", () => {
    const card = toastOf(stackHtml("dm", withNotes(system)), "n2");
    expect(card).toContain('data-testid="note-toast-icon"');
    expect(card).toContain("width:28px;height:28px");
    expect(card).not.toContain("kit-medallion");
    const html = alertHtml(alertT({ type: "error", title: "Action failed" }));
    expect(html).toMatch(/^<div role="alert" data-testid="ui-alert-toast" data-slot="toast-card"/);
    expect(html).toContain('data-testid="note-toast-icon"');
    expect(html).toContain("lucide-circle-alert");
    expect(html.indexOf("note-toast-icon")).toBeLessThan(html.indexOf("Action failed"));
    expect(html.indexOf("Action failed")).toBeLessThan(html.indexOf("ui-toast-close"));
  });
});

describe("FR-KIT-56 text block", () => {
  test("FR-KIT-56 text block: line 1 the text with the causing player's name in bold when it starts it; line 2 the relative time", () => {
    const card = toastOf(stackHtml("dm", withNotes(request)), "n1");
    expect(card).toContain(
      '<div data-testid="note-text"><b class="font-medium">Player 1</b> wants to add Longsword +1 to Mira&#x27;s sheet</div>',
    );
    expect(card).toMatch(
      /<time data-testid="note-time" datetime="2026-10-20T10:00:00.000Z"[^>]*>[^<]+<\/time>/i,
    );
    expect(card.indexOf("note-text")).toBeLessThan(card.indexOf("note-time"));
  });

  test("FR-KIT-56 text block: relative time and the bold lead (pure)", () => {
    const at = "2026-10-20T10:00:00.000Z";
    const t0 = Date.parse(at);
    expect(relativeTime(at, t0 + 30_000)).toBe("just now");
    expect(relativeTime(at, t0 - 5_000)).toBe("just now");
    expect(relativeTime(at, t0 + 2 * 60_000 + 5_000)).toBe("2 min ago");
    expect(relativeTime(at, t0 + 3 * 3_600_000)).toBe("3 h ago");
    expect(relativeTime(at, t0 + 2 * 86_400_000)).toBe("2 d ago");
    expect(relativeTime("nope", NOW)).toBe("just now");
    expect(leadName("Mira rolled", "Mira")).toEqual({ lead: "Mira", rest: " rolled" });
    expect(leadName("Miranda rolled", "Mira")).toEqual({ lead: null, rest: "Miranda rolled" });
    expect(leadName("Mira: hit", "Mira")).toEqual({ lead: "Mira", rest: ": hit" });
    expect(leadName("Bram asks Mira", "Mira").lead).toBeNull();
    expect(leadName("Mira", null).lead).toBeNull();
  });
});

describe("FR-KIT-57 inline action", () => {
  test("FR-KIT-57 inline action: the action sits right of the text in one wrapping group (below only when too narrow); the close is outside it, last", () => {
    const card = toastOf(stackHtml("dm", withNotes(request)), "n1");
    expect(card).toMatch(
      /<div class="flex min-w-0 flex-1 flex-wrap items-center[^"]*"><div data-slot="toast-text"[^>]*>.*<\/div><div data-slot="toast-actions" class="ml-auto flex shrink-0[^"]*"><button[^>]*data-testid="note-toast-action"/,
    );
    expect(card).toMatch(
      /data-testid="note-toast-close"[^>]*><svg[\s\S]*?<\/svg><\/button><\/div>(<\/section>)?$/,
    );
    // The text block keeps a basis, so a short text and the action share the line.
    expect(card).toContain('data-slot="toast-text" class="min-w-0 flex-[1_1_9rem]');
    const alert = alertHtml(
      alertT({ title: "Undo?", action: { label: "Undo", onClick: () => {} } as ToastT["action"] }),
    );
    expect(alert).toMatch(
      /data-slot="toast-actions"[^>]*><button[^>]*data-testid="ui-toast-action"/,
    );
  });
});

describe("FR-KIT-58 summary row", () => {
  const summary = (count: number): ToastState => ({
    ...initialToasts(0),
    toasts: [{ kind: "summary", key: SUMMARY_KEY, count, sticky: true, remaining: 0 }],
  });

  test("FR-KIT-58 summary row: the same card row (icon · text · Open · close); '+N more' is a centred pill", () => {
    const html = stackHtml("dm", summary(2));
    expect(html).toMatch(
      /data-testid="note-toast-pending-summary" data-slot="toast-card"[^>]*><span aria-hidden="true" data-testid="note-toast-icon"[\s\S]*2 pending actions[\s\S]*data-testid="note-toast-open"[\s\S]*data-testid="note-toast-close"/,
    );
    // Four info rows beside a card: the oldest info folds into "+N more" under the stack.
    const many = [1, 2, 3, 4].map((i) => ({ ...system, id: `i${i}`, state: "resolved" as const }));
    const s = withNotes(request, ...many);
    const g = stackHtml("dm", s, undefined, [request, ...many]);
    expect(g).toMatch(
      /data-testid="note-toast-more" data-in-summary="false" class="[^"]*rounded-full[^"]*self-center/,
    );
  });
});

describe("FR-KIT-59 turn card", () => {
  test("FR-KIT-59 turn card: the player's turn alert Toast renders as the turn card (text between two gems, no close) inside `ui-alert-toast`", () => {
    const html = alertHtml(alertT({ id: TURN_ALERT_TOAST_ID, title: "Your turn — Mira" }));
    expect(html).toMatch(
      /^<div data-testid="ui-alert-toast" data-class="alert" data-type="default" class="contents"><div role="status" data-testid="cbt-turn-card" data-slot="turn-card"/,
    );
    expect(html.split('data-slot="turn-card-gem"').length - 1).toBe(2);
    expect(html).toContain("Your turn — Mira");
    expect(html).not.toContain("close");
    // Any other alert keeps the card row.
    expect(alertHtml(alertT())).toContain('data-slot="toast-card"');
  });

  test("FR-KIT-59 turn card (DM, OQ-KIT-03 A): 'Mira's turn' first in the DM stack for 4 s, paused like the stack; a new one replaces it; a campaign switch clears it", () => {
    let s = setTurnCard(withNotes(request), "Mira's turn", 1000, 1);
    expect(nextExpiry(s)).toBe(TURN_CARD_MS);
    const html = stackHtml("dm", s);
    const turn = html.indexOf('data-testid="cbt-turn-card"');
    expect(turn).toBeGreaterThan(html.indexOf('data-testid="note-toasts"'));
    expect(turn).toBeLessThan(html.indexOf('data-testid="note-toast"'));
    expect(html).toContain("Mira&#x27;s turn");
    s = advance(s, 1000 + TURN_CARD_MS - 1);
    expect(s.turn?.remaining).toBe(1);
    s = setTurnCard(s, "Goblin's turn", 1000 + TURN_CARD_MS - 1, 2);
    expect(s.turn).toEqual({ text: "Goblin's turn", seq: 2, remaining: TURN_CARD_MS });
    expect(advance(s, 1000 + 2 * TURN_CARD_MS).turn).toBeNull();
    expect(clearToasts(setTurnCard(s, "x", 0, 3), 0).turn).toBeNull();
  });

  test("FR-KIT-59 turn card (DM): derived from a live TurnChanged frame (the turn's combatant, hidden ones too); never for players or other causes", () => {
    const records = {
      [COMBATANT_TYPE]: {
        m: { id: "m", encounterId: "e1", name: "Mira", kind: "pc", entityId: "mira" },
        g: { id: "g", encounterId: "e1", name: "Goblin 2", kind: "monster", hidden: true },
      },
    };
    const frame = (turnCombatantId: string | null, name: string = TurnChanged.type) => ({
      cause: { name },
      changes: [
        { type: ENCOUNTER_TYPE, op: "upsert", id: "e1", data: { id: "e1", turnCombatantId } },
      ],
    });
    const dm = storeFor("dm", records);
    expect(dmTurnCardFor(frame("m") as never, dm)).toBe("Mira's turn");
    expect(dmTurnCardFor(frame("g") as never, dm)).toBe("Goblin 2's turn");
    expect(dmTurnCardFor(frame(null) as never, dm)).toBeNull();
    expect(dmTurnCardFor(frame("m", "EncounterStarted") as never, dm)).toBeNull();
    expect(dmTurnCardFor(frame("m") as never, storeFor("player", records))).toBeNull();
    // The player's own alert is unchanged (and the DM gets none).
    expect(turnAlertFor(frame("m") as never, dm)).toBeNull();
  });
});

describe("FR-KIT-60 stack unchanged", () => {
  test("FR-KIT-60 stack unchanged: 320 wide, placements and the fold as before", () => {
    const dm = stackHtml("dm", withNotes(request));
    expect(dm).toMatch(
      /data-testid="note-toasts" data-placement="top-center"[^>]*class="[^"]*w-80/,
    );
    const player = stackHtml(
      "player",
      withNotes({ ...request, audience: "player", audiencePlayerId: "p1", actionRole: null }),
    );
    expect(player).toMatch(
      /data-placement="bottom-right"[^>]*class="[^"]*w-80 gap-2 flex-col-reverse/,
    );
  });
});

describe("FR-KIT-01 / -04 / -07 (notices)", () => {
  test("FR-KIT-01 same DOM per theme: the stack renders the same markup under Simple Dark and Gilt & Stone; no theme read", () => {
    const s = setTurnCard(withNotes(request, system), "Mira's turn", 0, 1);
    const [a, b] = (["default", "gilt"] as const).map((t) =>
      stackHtml("dm", s, (n) => <div data-theme={t}>{n}</div>).replace(t, "·"),
    );
    expect(a).toBe(b ?? "");
    for (const f of ["ToastRuntime.tsx", "alert-toasts.tsx", "parts.tsx"]) {
      expect(readFileSync(join(import.meta.dir, f), "utf8")).not.toMatch(/data-theme|gilt/);
    }
  });

  test("FR-KIT-07 slots present: toast-card, toast-text, toast-actions, turn-card", () => {
    const html = stackHtml("dm", setTurnCard(withNotes(request), "Mira's turn", 0, 1));
    for (const slot of [
      "toast-card",
      "toast-text",
      "toast-actions",
      "turn-card",
      "kit-medallion",
    ]) {
      expect(html).toContain(`data-slot="${slot}"`);
    }
  });

  test("FR-KIT-04 player toasts show no new fields: the medallion reads only the player record the client holds", () => {
    const own = {
      ...request,
      audience: "player" as const,
      audiencePlayerId: "p1",
      actionRole: null,
    };
    const html = stackHtml("player", withNotes(own));
    expect(html).toContain('data-slot="kit-medallion" data-size="md"');
    // An unknown causer (a player record the client doesn't hold) → the icon, no name.
    const stranger = { ...own, byPlayerId: "p9", text: "Somebody did a thing" };
    const other = stackHtml("player", withNotes(stranger), undefined, [stranger]);
    expect(other).toContain("note-toast-icon");
    expect(other).not.toContain("kit-medallion");
  });
});
