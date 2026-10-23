// The Recap window client (RECAP §13 client tests): live refresh (FR-RECAP-06), the quiet conflict
// retry (FR-RECAP-05), states and sections per role (FR-RECAP-17, -22, -27), Copy as Markdown
// (FR-RECAP-19), the share open (FR-RECAP-21) and the Share dialog (FR-RECAP-24). The data is an
// ack as the server sends it; the view renders it as is.
import { describe, expect, test } from "bun:test";
import { GAME_LOG_ENTRY_TYPE } from "@shared/dice-roll-log/schemas";
import { NotificationCreated } from "@shared/events/notifications";
import { LOOT_ENTRY_TYPE } from "@shared/party-loot/schemas";
import type { EventFrame, You } from "@shared/protocol/frames";
import { emptyStore } from "@shared/protocol/store";
import { DmRecap, PlayerRecap, SESSION_RECAP_KIND } from "@shared/session-recap/schemas";
import type { SessionsResult } from "@shared/stats/schemas";
import { TooltipProvider } from "@ui/components/ui/overlays";
import { SyncContext, type SyncState } from "@ui/sync/store";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createStore } from "zustand";
import { createPauseGate } from "../pause/gate";
import type { QueryStatus, Timers } from "../stats/refresh";
import {
  CONFLICT_RETRY_MS,
  RECAP_REFRESH_MS,
  RECAP_WINDOW_KIND,
  type Recap,
  recapMarkdown,
  refreshes,
  shareOpenOf,
} from "./logic";
import { createRecapViews, openRecap } from "./open";
import { createRecapQuery, type QueryState } from "./query";
import { RecapBody } from "./RecapWindow";
import { onRecapFrame } from "./runtime";
import { EMPTY_DRAFT, ShareForm, shareInput } from "./ShareDialog";
import { DM_RECAP, EMPTY_PLAYER_RECAP, PLAYER_RECAP } from "./test-acks";

const DM: You = { campaignId: "c1", role: "dm", playerId: null };

function wrap(node: ReactNode) {
  const store = createStore<SyncState>()(
    () =>
      ({
        state: "live",
        store: {
          ...emptyStore(),
          you: DM,
          records: {
            player: { p1: { id: "p1", color: "#e11d48" }, p2: { id: "p2", color: "#2563eb" } },
          },
        },
        lazy: { generation: 1 },
        connection: { sendIntent: () => new Promise(() => {}), onEvent: () => () => {} },
      }) as unknown as SyncState,
  );
  return renderToStaticMarkup(
    <SyncContext.Provider value={store}>
      <TooltipProvider delayDuration={0} skipDelayDuration={0}>
        {node}
      </TooltipProvider>
    </SyncContext.Provider>,
  );
}

const LIST: SessionsResult = {
  sessions: [{ fromN: 1, toN: 46, from: DM_RECAP.from, to: DM_RECAP.to, fights: 1 }],
};

function body(
  role: "dm" | "player",
  recap: Recap | null | undefined,
  o: { status?: QueryStatus; live?: boolean } = {},
) {
  return wrap(
    <RecapBody
      role={role}
      list={{ status: "ok", result: LIST }}
      recap={{
        status: o.status ?? "ok",
        result: recap === undefined ? null : { recap },
      }}
      live={o.live ?? true}
      onPick={() => {}}
      onShare={() => {}}
      onCopy={() => {}}
      retry={() => {}}
      now={new Date("2026-10-23T23:50:00Z")}
    />,
  );
}

const count = (html: string, id: string) => html.split(`data-testid="${id}"`).length - 1;

function fakeTimers() {
  let now = 0;
  let next = 1;
  const due = new Map<number, { at: number; fn: () => void }>();
  const timers: Timers = {
    setTimeout: (fn, ms) => {
      const id = next++;
      due.set(id, { at: now + ms, fn });
      return id;
    },
    clearTimeout: (h) => void due.delete(h as number),
  };
  const advance = (ms: number) => {
    now += ms;
    for (const [id, t] of [...due].sort((a, b) => a[1].at - b[1].at)) {
      if (t.at > now) continue;
      due.delete(id);
      t.fn();
    }
  };
  return { timers, advance };
}

function harness() {
  const t = fakeTimers();
  const sent: { resolve(r: string): void; reject(e: unknown): void }[] = [];
  const states: QueryState<{ n?: number }, string>[] = [];
  const q = createRecapQuery<{ n?: number }, string>({
    send: () =>
      new Promise<string>((resolve, reject) => {
        sent.push({ resolve, reject });
      }),
    onChange: (s) => states.push(s),
    timers: t.timers,
  });
  const last = () => states.at(-1) as QueryState<{ n?: number }, string>;
  const flush = () => new Promise((r) => setTimeout(r, 0));
  return { q, t, sent, last, flush };
}

const frame = (changes: EventFrame["changes"], name = "X"): EventFrame =>
  ({ type: "event", seq: 1, cause: { name }, changes }) as unknown as EventFrame;

describe("FR-RECAP-06 live refresh", () => {
  test("FR-RECAP-06 newest only: a log or loot upsert re-queries the newest session, never an older one", () => {
    const log = frame([{ type: GAME_LOG_ENTRY_TYPE, id: "e", op: "upsert", data: {} }]);
    const lootUp = frame([{ type: LOOT_ENTRY_TYPE, id: "l", op: "upsert", data: {} }]);
    const other = frame([{ type: "token", id: "t", op: "upsert", data: {} }]);
    expect([refreshes(log, true), refreshes(lootUp, true), refreshes(other, true)]).toEqual([
      true,
      true,
      false,
    ]);
    expect(refreshes(log, false)).toBe(false);
  });

  test("FR-RECAP-06 trailing 2 s; minimised asks nothing, showing again asks once", async () => {
    const h = harness();
    h.q.set({});
    h.sent[0]?.resolve("a");
    await h.flush();
    h.q.poke();
    h.t.advance(RECAP_REFRESH_MS - 1);
    h.q.poke();
    expect(h.sent).toHaveLength(1);
    h.t.advance(1);
    expect(h.sent).toHaveLength(2);
    h.sent[1]?.resolve("b");
    await h.flush();
    h.q.setShown(false);
    h.q.poke();
    h.t.advance(RECAP_REFRESH_MS * 3);
    expect(h.sent).toHaveLength(2);
    h.q.setShown(true);
    expect(h.sent).toHaveLength(3);
  });

  test("FR-RECAP-05 conflict: the last result stays, one quiet retry 1 s later; a second failure shows the error", async () => {
    const h = harness();
    h.q.set({});
    h.sent[0]?.resolve("a");
    await h.flush();
    h.q.snapshot();
    h.sent[1]?.reject({ code: "conflict", message: "Too many recap queries" });
    await h.flush();
    expect(h.last()).toMatchObject({ status: "ok", result: "a" });
    h.t.advance(CONFLICT_RETRY_MS);
    expect(h.sent).toHaveLength(3);
    h.sent[2]?.reject({ code: "conflict", message: "Too many recap queries" });
    await h.flush();
    expect(h.last()).toMatchObject({ status: "error", result: "a" });
  });
});

describe("FR-RECAP-17 states and sections", () => {
  test("FR-RECAP-17 states: loading skeleton, error + Retry, no sessions, nothing happened, offline muted", () => {
    expect(count(body("player", undefined, { status: "loading" }), "recap-loading")).toBe(1);
    const failed = body("player", undefined, { status: "error" });
    expect(failed).toContain("Couldn&#x27;t load the recap");
    expect(count(failed, "recap-retry")).toBe(1);
    expect(body("player", null)).toContain("No sessions yet");
    expect(body("player", EMPTY_PLAYER_RECAP)).toContain("Nothing happened yet this session");
    const offline = body("dm", DM_RECAP, { live: false });
    expect(offline).toContain('data-state="offline"');
    expect(offline).toMatch(/data-testid="recap-share"[^>]*disabled/);
  });

  test("FR-RECAP-22 FR-RECAP-27 DM: every section, Notable rolls 'Hidden from players', hidden marks, Still standing", () => {
    const html = body("dm", DM_RECAP);
    expect(count(html, "recap-window")).toBe(1);
    expect(html).toMatch(/data-record-id="rolls" data-state="hidden-from-players"/);
    expect(html).toContain("Hidden from players");
    expect(count(html, "recap-roll")).toBe(2);
    expect(count(html, "recap-fight")).toBe(1);
    expect(html).toContain('data-record-id="e-camp"');
    expect(count(html, "recap-party-row")).toBe(1);
    expect(count(html, "recap-loot-row")).toBe(3);
    expect(count(html, "recap-standing")).toBe(1);
    expect(html).toContain("Bandit Captain");
    expect(count(html, "recap-share")).toBe(1);
    expect(count(html, "recap-copy")).toBe(1);
    expect(count(html, "recap-note")).toBe(1);
  });

  test("FR-RECAP-22 player: no Notable rolls, the note quoted, no Share, Copy only", () => {
    const html = body("player", PLAYER_RECAP);
    expect(count(html, "recap-roll")).toBe(0);
    expect(html).not.toContain('data-record-id="rolls"');
    expect(html).toContain("Cleared the Bandit Camp; the map points north.");
    expect(count(html, "recap-share")).toBe(0);
    expect(count(html, "recap-copy")).toBe(1);
    expect(html).not.toContain("Bandit Captain");
    expect(html).not.toContain("Hidden from players");
  });

  test("FR-RECAP-08 the client's schemas accept the acks as sent", () => {
    expect(DmRecap.parse(DM_RECAP)).toEqual(DM_RECAP);
    expect(PlayerRecap.parse(PLAYER_RECAP)).toEqual(PLAYER_RECAP);
    expect(PlayerRecap.safeParse(DM_RECAP).success).toBe(false);
  });
});

describe("FR-RECAP-19 Copy as Markdown", () => {
  test("FR-RECAP-19 Markdown per role: heading, sections, note; no hidden name in the player's", () => {
    const dm = recapMarkdown(DM_RECAP, "dm");
    expect(dm.startsWith("## Session recap · Fri 23 Oct\n")).toBe(true);
    expect(dm).toContain("> Cleared the Bandit Camp; the map points north.");
    for (const s of [
      "### Fights",
      "### Party",
      "### Loot",
      "### Notable rolls (hidden from players)",
      "### Awards",
    ]) {
      expect(dm).toContain(s);
    }
    expect(dm).toContain("Thorn finished Bandit Captain (hidden)");
    expect(dm).toContain("Still standing: Bandit 3");
    const p = recapMarkdown(PLAYER_RECAP, "player");
    expect(p).toContain("### Loot");
    expect(p).toContain("- Bandit Camp strongbox: +40 gp +25 sp (Party)");
    expect(p).not.toContain("Notable rolls");
    for (const leak of ["Bandit Captain", "hidden", "Still standing", "overkill"]) {
      expect(p).not.toContain(leak);
    }
  });
});

describe("FR-RECAP-21 share open", () => {
  const created = (payload: unknown, id = "n1") =>
    frame(
      [
        {
          type: "notification",
          id,
          op: "upsert",
          data: { id, kind: SESSION_RECAP_KIND, payload, text: "Session recap: Fri 23 Oct" },
        },
      ],
      NotificationCreated.type,
    );
  const payload = { fromN: 7, toN: 9, from: "a", to: "b", label: "Fri 23 Oct", omit: [] };

  test("FR-RECAP-21 opens by feature on players' clients, once; the DM only toasts", () => {
    expect(shareOpenOf(created(payload))).toMatchObject({ fromN: 7, notificationId: "n1" });
    const opened: number[] = [];
    const seen = new Set<string>();
    const gate = createPauseGate();
    onRecapFrame(created(payload), { role: "player", open: (n) => opened.push(n), seen, gate });
    onRecapFrame(created(payload), { role: "player", open: (n) => opened.push(n), seen, gate });
    onRecapFrame(created(payload, "n2"), { role: "dm", open: (n) => opened.push(n), gate });
    expect(opened).toEqual([7]);
    // `openRecap` stores the session as the viewer's pick and opens `recap.session` by feature.
    const views = createRecapViews();
    const calls: unknown[] = [];
    openRecap(7, {
      you: { campaignId: "c1", role: "player", playerId: "p1" },
      open: (...a) => calls.push(a),
      by: "feature",
      views,
    });
    expect(views.get("c1.p1")).toEqual({ fromN: 7 });
    expect(calls).toEqual([[RECAP_WINDOW_KIND, "main", { by: "feature" }]]);
  });

  test("FR-RECAP-21 deferred while paused: the newest share opens at resume", () => {
    const gate = createPauseGate();
    gate.set(true);
    const opened: number[] = [];
    const seen = new Set<string>();
    onRecapFrame(created(payload, "a"), {
      role: "player",
      open: (n) => opened.push(n),
      seen,
      gate,
    });
    onRecapFrame(created({ ...payload, fromN: 8 }, "b"), {
      role: "player",
      open: (n) => opened.push(n),
      seen,
      gate,
    });
    expect(opened).toEqual([]);
    gate.set(false);
    expect(opened).toEqual([8]);
  });
});

describe("FR-RECAP-24 share dialog", () => {
  test("FR-RECAP-24 share dialog: note with a 280 counter, one checkbox per optional section, Share off unless live", () => {
    expect(shareInput(1, EMPTY_DRAFT)).toEqual({ fromN: 1, omit: [] });
    expect(shareInput(1, { note: " Hi ", shown: ["party", "loot", "awards"] })).toEqual({
      fromN: 1,
      note: " Hi ",
      omit: ["rolls"],
    });
    const html = (live: boolean, error: string | null = null) =>
      wrap(
        <ShareForm
          live={live}
          draft={{ note: "Cleared", shown: ["party", "loot", "awards"] }}
          onDraft={() => {}}
          sending={false}
          error={error}
          onSend={() => {}}
        />,
      );
    const open = html(true);
    expect(count(open, "recap-share-omit")).toBe(4);
    expect(open).toMatch(
      /aria-checked="false"[^>]*data-testid="recap-share-omit" data-value="rolls"/,
    );
    expect(open).toContain("7 / 280");
    expect(open).not.toMatch(/data-testid="recap-share-send"[^>]*disabled/);
    expect(html(false)).toMatch(/data-testid="recap-share-send"[^>]*disabled/);
    // A reject: the message inline, the draft kept (the form is unchanged).
    expect(html(true, "Session not found")).toContain("Session not found");
  });
});
