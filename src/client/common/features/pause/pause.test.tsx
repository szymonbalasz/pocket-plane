// Sprint 8 TT4 (play-shell FR-SHELL-125–129, -134–136; dice-extras FR-DICEX-90; notifications
// FR-NOTE-63): the card (static render over a fake sync store), the countdown, the runtime's
// suppression and resume catch-up, the gate, the registry entries and the DM control's logic.
import { describe, expect, test } from "bun:test";
import type { CampaignPause } from "@shared/campaign-management/table-state";
import { CampaignPaused, CampaignResumed } from "@shared/events/campaign-management";
import { TurnChanged } from "@shared/events/combat-tracker";
import type { NotificationRecord } from "@shared/notifications/schemas";
import { emptyStore, type RecordStore } from "@shared/protocol/store";
import { renderToStaticMarkup } from "react-dom/server";
import { createStore } from "zustand";
import { TooltipProvider } from "../../components/ui/overlays";
import { SyncContext, type SyncState } from "../../sync/store";
import { DICE_LAYER_Z } from "../dice-extras/DiceLayer";
import { classify, NOTIFICATION_TYPE } from "../notifications/logic";
import {
  createToastMemory,
  initialToasts,
  registerToastMemory,
  showCallout,
  syncToasts,
  type ToastMemory,
} from "../notifications/toasts";
import { createAlertController, createTitleMarker } from "../play-shell/alerts";
import type { AudioEngine } from "../play-shell/audio";
import { blockInput } from "../play-shell/input-block";
import { OVERLAY_LAYER_Z } from "../play-shell/OverlayLayer";
import { blockingOverlay, OVERLAYS, overlaysFor } from "../play-shell/overlays";
import { createWindowRegistry } from "../play-shell/registry";
import { ShellProvider } from "../play-shell/ShellContext";
import { createSoundSettingsStorage } from "../play-shell/sound-settings";
import { TOP_BAR_ITEMS, topBarItemsFor, topBarItemWidth } from "../play-shell/top-bar-items";
import { createPauseGate, pauseGate } from "./gate";
import {
  controlLabel,
  countdownText,
  draftKey,
  EMPTY_DRAFT,
  isPausedFor,
  pauseOf,
  readDraft,
  resumeCatchUp,
  writeDraft,
} from "./logic";
import { pausePayload, previewPause } from "./PauseControl";
import { PauseOverlay } from "./PauseOverlay";
import { createPauseRuntime } from "./runtime";

const T0 = Date.parse("2026-10-22T19:00:00.000Z");
const iso = (ms: number) => new Date(ms).toISOString();
const PAUSE: CampaignPause = {
  message: "Pizza break, back soon",
  imageAssetId: "T".repeat(22),
  backAt: iso(T0 + 10 * 60_000),
  startedAt: iso(T0),
};

type Role = "dm" | "player";
function storeOf(
  o: { role?: Role; pause?: CampaignPause | null; campaignId?: string; extra?: object } = {},
): RecordStore {
  const campaignId = o.campaignId ?? "c1";
  const camp = (id: string, pause: CampaignPause | null) => ({
    id,
    name: id,
    dmColor: "#cc3333",
    ...(pause ? { pause } : {}),
  });
  return {
    ...emptyStore(),
    you: { campaignId, role: o.role ?? "player", playerId: o.role === "dm" ? null : "pl-1" },
    records: {
      campaign: { c1: camp("c1", o.pause === undefined ? PAUSE : o.pause), c2: camp("c2", null) },
      ...(o.extra ?? {}),
    },
  };
}

function render(store: RecordStore, state: SyncState["state"] = "live"): string {
  const sync = createStore<SyncState>()(
    () =>
      ({
        state,
        store,
        notLiveSince: null,
        everLive: true,
        connection: { onEvent: () => () => {}, sendIntent: () => Promise.resolve({}) },
      }) as unknown as SyncState,
  );
  const g = globalThis as { document?: unknown; window?: unknown; Image?: unknown };
  g.document = { title: "", hidden: false, documentElement: {} };
  g.window = { innerWidth: 1280, innerHeight: 720 };
  // The image cache loads through `new Image()`; a static render only needs it to exist.
  g.Image = class {
    addEventListener() {}
    set src(_v: string) {}
  };
  try {
    return renderToStaticMarkup(
      <SyncContext.Provider value={sync}>
        <ShellProvider registry={createWindowRegistry("player", [])}>
          <TooltipProvider delayDuration={0} skipDelayDuration={0}>
            <PauseOverlay />
          </TooltipProvider>
        </ShellProvider>
      </SyncContext.Provider>,
    );
  } finally {
    delete g.document;
    delete g.window;
    delete g.Image;
  }
}

describe("pause card (FR-SHELL-125, -126)", () => {
  test("FR-SHELL-125 pause card: opaque full-viewport card with Paused, message, image, countdown, mute; Reconnecting… while not live", () => {
    const html = render(storeOf());
    expect(html).toContain('data-testid="ui-pause"');
    expect(html).toContain('data-state="paused"');
    expect(html).toContain("bg-background"); // opaque, not a scrim
    expect(html).toContain("inset-0");
    expect(html).toContain(">Paused</h2>");
    expect(html).toContain('data-testid="ui-pause-message"');
    expect(html).toContain("Pizza break, back soon");
    expect(html).toContain(`data-testid="ui-pause-image" data-record-id="${PAUSE.imageAssetId}"`);
    expect(html).toContain('data-testid="ui-pause-countdown"');
    expect(html).toContain('data-testid="ui-pause-mute"');
    expect(html).not.toContain("ui-pause-reconnecting");
    const off = render(storeOf(), "reconnecting");
    expect(off).toContain('data-state="reconnecting"');
    expect(off).toContain("Reconnecting…");
    // No message / image / back-in: only "Paused" and the mute toggle.
    const bare = render(
      storeOf({ pause: { message: null, imageAssetId: null, backAt: null, startedAt: iso(T0) } }),
    );
    expect(bare).toContain(">Paused</h2>");
    for (const id of ["ui-pause-message", "ui-pause-image", "ui-pause-countdown"]) {
      expect(bare).not.toContain(`"${id}"`);
    }
    // Running, or the DM: nothing.
    expect(render(storeOf({ pause: null }))).toBe("");
    expect(render(storeOf({ role: "dm" }))).toBe("");
  });

  test("FR-SHELL-126 countdown: Back in m:ss from backAt on the client clock, ≤ 0 → Back soon, none without backAt", () => {
    const backAt = iso(T0 + 10 * 60_000);
    expect(countdownText(backAt, T0)).toBe("Back in 10:00");
    expect(countdownText(backAt, T0 + 1)).toBe("Back in 10:00");
    expect(countdownText(backAt, T0 + 60_000 * 9 + 55_500)).toBe("Back in 0:05");
    expect(countdownText(backAt, T0 + 10 * 60_000)).toBe("Back soon");
    expect(countdownText(backAt, T0 + 11 * 60_000)).toBe("Back soon");
    expect(countdownText(null, T0)).toBeNull();
  });
});

describe("registration (FR-SHELL-128, -129, -135)", () => {
  test("FR-SHELL-128 input blocked: the players' pause entry blocks input exactly while paused (WF1's blocksInput)", () => {
    const entry = overlaysFor("player", OVERLAYS).find((o) => o.id === "pause");
    expect(entry?.id).toBe("pause");
    // SP1's palette (FR-SHELL-181) is the DM's only entry: it never blocks input.
    expect(overlaysFor("dm", OVERLAYS).map((o) => [o.id, o.blocksInput])).toEqual([
      ["palette", undefined],
    ]);
    expect(blockingOverlay(overlaysFor("player"), storeOf())?.id).toBe("pause");
    expect(blockingOverlay(overlaysFor("player"), storeOf({ pause: null }))).toBeNull();
    // The DM's store never blocks (the DM is never paused).
    expect(entry?.blocksInput?.(storeOf({ role: "dm" }))).toBe(false);
  });

  test("FR-SHELL-135 layers: alert flash < pause card < dice layer, via the overlay layer's slot", () => {
    const entry = overlaysFor("player").find((o) => o.id === "pause");
    expect(entry?.layer).toBe(10);
    // The palette (FR-SHELL-181) draws below the pause card.
    expect(overlaysFor("player").map((o) => o.id)).toEqual(["palette", "pause"]);
    // The flash is z-100 (AlertLayer); the toast stack sits below the overlay layer too.
    expect(OVERLAY_LAYER_Z).toBeGreaterThan(100);
    expect(OVERLAY_LAYER_Z + (entry?.layer ?? 0)).toBeLessThan(DICE_LAYER_Z);
  });

  test("FR-SHELL-129 DM pause control: top-bar item (DM only, fixed slot), label, widths, payload, preview, draft", () => {
    // The slot: 40 px at every width, an icon button like search (kit-parity K10).
    const items = topBarItemsFor("dm", TOP_BAR_ITEMS);
    // SP1's search button (FR-SHELL-195) sits after it, next to the identity chip.
    expect(items.map((t) => t.id)).toEqual(["pause", "palette"]);
    const [item] = items;
    expect(
      [1600, 1280, 1279].map((w) => (item ? topBarItemWidth(item, { w, h: 720 }) : 0)),
    ).toEqual([40, 40, 40]);
    expect(topBarItemsFor("player", TOP_BAR_ITEMS).map((t) => t.id)).toEqual(["palette"]);
    // "Pause"; paused "Paused · m:ss"; no back-in "Paused".
    expect(controlLabel(null, T0)).toBe("Pause");
    expect(controlLabel(PAUSE, T0 + 30_000)).toBe("Paused · 9:30");
    expect(controlLabel(PAUSE, T0 + 11 * 60_000)).toBe("Paused · 0:00");
    expect(controlLabel({ ...PAUSE, backAt: null }, T0)).toBe("Paused");
    // Update keeps the countdown (`keep` leaves backInMin out); a choice or none is sent.
    const f = { message: "Back soon", imageAssetId: null, backIn: "keep" as const };
    expect(pausePayload(f)).toEqual({ message: "Back soon", imageAssetId: null });
    expect(pausePayload({ ...f, backIn: 5 })).toEqual({
      message: "Back soon",
      imageAssetId: null,
      backInMin: 5,
    });
    expect(pausePayload({ ...f, backIn: null })).toMatchObject({ backInMin: null });
    // Preview = the form as the card.
    expect(previewPause({ ...f, message: "  " }, PAUSE, T0)).toEqual({
      ...PAUSE,
      message: null,
      imageAssetId: null,
    });
    expect(previewPause({ ...f, backIn: 15 }, PAUSE, T0).backAt).toBe(iso(T0 + 15 * 60_000));
    // Draft: `pp.pause.v1.<campaignId>`; junk or blocked storage → empty.
    const mem = new Map<string, string>();
    const storage = {
      getItem: (k: string) => mem.get(k) ?? null,
      setItem: (k: string, v: string) => void mem.set(k, v),
    };
    writeDraft(storage, "c1", { message: "Snacks", imageAssetId: null, backInMin: 10 });
    expect([...mem.keys()]).toEqual([draftKey("c1")]);
    expect(draftKey("c1")).toBe("pp.pause.v1.c1");
    expect(readDraft(storage, "c1")).toEqual({
      message: "Snacks",
      imageAssetId: null,
      backInMin: 10,
    });
    expect(readDraft(storage, "c2")).toEqual(EMPTY_DRAFT);
    mem.set(draftKey("c3"), "{not json");
    expect(readDraft(storage, "c3")).toEqual(EMPTY_DRAFT);
    mem.set(draftKey("c4"), JSON.stringify({ message: 7, backInMin: 7 }));
    expect(readDraft(storage, "c4")).toEqual(EMPTY_DRAFT);
    expect(readDraft(null, "c1")).toEqual(EMPTY_DRAFT);
  });
});

const TURN_STORE_EXTRA = {
  encounter: { e1: { id: "e1", status: "started", round: 1, playerTurnCombatantId: "cb-mira" } },
  combatant: {
    "cb-mira": { id: "cb-mira", encounterId: "e1", kind: "pc", name: "Mira", entityId: "ch-mira" },
  },
  entity: { "ch-mira": { id: "ch-mira", name: "Mira", ownerPlayerId: "pl-1" } },
};

const prompt = (o: Partial<NotificationRecord> = {}): NotificationRecord => ({
  id: "n1",
  campaignId: "c1",
  seq: 1,
  kind: "roll-request",
  audience: "player",
  audiencePlayerId: "pl-1",
  text: "Perception",
  payload: null,
  actionLabel: "Roll",
  actionRole: "player",
  actionPlayerId: "pl-1",
  state: "pending",
  resolution: null,
  closedAt: null,
  closedByRole: null,
  closedByPlayerId: null,
  byRole: "dm",
  byPlayerId: null,
  createdAt: iso(T0 + 60_000),
  updatedAt: iso(T0 + 60_000),
  ...o,
});

function runtime() {
  const log: string[] = [];
  const gate = createPauseGate();
  const rt = createPauseRuntime({
    gate,
    suppress: (on) => log.push(`suppress:${on}`),
    alert: (a) => log.push(`alert:${a.id}:${a.detail}`),
    alertSound: (k) => log.push(`sound:${k}`),
  });
  /** A live frame: the store first, then the frame's handlers (as the connection does). */
  const live = (cause: string, store: RecordStore) => {
    rt.onStore(store);
    rt.onFrame({ cause: { name: cause } }, store);
  };
  return { log, gate, rt, live };
}

describe("suppression and catch-up (FR-SHELL-127, -136; FR-DICEX-90; FR-NOTE-63)", () => {
  test("FR-SHELL-127 suppressed while paused: live pause → quiet + the pause sound; update → nothing; resume with turn, request and resume → only the turn", () => {
    const { log, gate, rt, live } = runtime();
    rt.onStore(storeOf({ pause: null }));
    live(CampaignPaused.type, storeOf());
    expect(log).toEqual(["suppress:true", "sound:pause"]);
    expect(gate.paused()).toBe(true);
    // An update of the card (startedAt kept): no sound, no change.
    live(CampaignPaused.type, storeOf({ pause: { ...PAUSE, message: "Ten more minutes" } }));
    // Other frames meanwhile (a turn, a prompt) change nothing here: the alerts are quiet.
    live(TurnChanged.type, storeOf({ extra: TURN_STORE_EXTRA }));
    expect(log).toEqual(["suppress:true", "sound:pause"]);
    // Resume: it is Mira's turn and a prompt waits → the turn alert alone (flash + turn sound).
    const after = storeOf({
      pause: null,
      extra: { ...TURN_STORE_EXTRA, notification: { n1: prompt() } },
    });
    live(CampaignResumed.type, after);
    expect(log.slice(2)).toEqual(["suppress:false", "alert:cbt.turn:Mira"]);
    expect(gate.paused()).toBe(false);
    expect(resumeCatchUp(after, PAUSE.startedAt)).toMatchObject({ sound: "turn" });
  });

  test("FR-DICEX-90 request while paused: the prompt waits silent; at resume one request sound", () => {
    const { log, live, rt } = runtime();
    rt.onStore(storeOf({ pause: null }));
    live(CampaignPaused.type, storeOf());
    live("NotificationCreated", storeOf({ extra: { notification: { n1: prompt() } } }));
    live(CampaignResumed.type, storeOf({ pause: null, extra: { notification: { n1: prompt() } } }));
    expect(log).toEqual(["suppress:true", "sound:pause", "suppress:false", "sound:request"]);
  });

  test("FR-NOTE-63 prompt while paused: only a prompt that arrived during the pause and still waits brings the request sound", () => {
    const since = PAUSE.startedAt;
    const at = (n: NotificationRecord) =>
      resumeCatchUp(storeOf({ pause: null, extra: { notification: { n1: n } } }), since).sound;
    expect(at(prompt())).toBe("request");
    expect(at(prompt({ createdAt: iso(T0 - 60_000) }))).toBe("resume"); // before the pause
    expect(at(prompt({ state: "resolved" }))).toBe("resume"); // answered / closed meanwhile
    expect(at(prompt({ actionPlayerId: "pl-2" }))).toBe("resume"); // someone else's
    expect(at(prompt({ kind: "test" }))).toBe("resume");
    expect(resumeCatchUp(storeOf({ pause: null }), since)).toEqual({ turn: null, sound: "resume" });
  });

  test("FR-SHELL-136 pause survives: a snapshot already paused (reload, reconnect, restart) closes the gate with no sound; a snapshot resume opens it silently; a campaign switch shows the new campaign's state", () => {
    const { log, gate, rt } = runtime();
    rt.onStore(storeOf());
    expect([gate.paused(), log]).toEqual([true, ["suppress:true"]]);
    // A reconnect snapshot, still paused: nothing new.
    rt.onStore(storeOf());
    rt.onFrame({ cause: { name: "presence" } }, storeOf());
    expect(log).toEqual(["suppress:true"]);
    // Resumed while offline: the next snapshot opens the gate, plays nothing (no live frame).
    rt.onStore(storeOf({ pause: null }));
    expect([gate.paused(), log]).toEqual([false, ["suppress:true", "suppress:false"]]);
    // Campaign switch: `you.campaignId` picks the row.
    expect(pauseOf(storeOf({ campaignId: "c2" }))).toBeNull();
    expect(pauseOf(storeOf({ campaignId: "c1" }))).toEqual(PAUSE);
    expect(isPausedFor(storeOf({ campaignId: "c2" }))).toBe(false);
  });

  test("FR-SHELL-127 deferred opens: run at once while running; while paused once at resume, in order, the same key replaced", () => {
    const gate = createPauseGate();
    const ran: string[] = [];
    gate.deferUntilResume("stats.summary", () => ran.push("now"));
    gate.set(true);
    gate.deferUntilResume("stats.summary", () => ran.push("summary-1"));
    gate.deferUntilResume("map.reveal", () => ran.push("reveal"));
    gate.deferUntilResume("stats.summary", () => ran.push("summary-2"));
    expect(ran).toEqual(["now"]);
    gate.set(false);
    expect(ran).toEqual(["now", "reveal", "summary-2"]);
    gate.set(false);
    expect(ran).toHaveLength(3);
  });
});

describe("the shell's alerts under the card (FR-SHELL-127, -134)", () => {
  /** The real controller over a stub engine: every key plays (`played`) unless `none`. */
  function controller() {
    const toasts: string[] = [];
    const engine = {
      unlocked: true,
      unlock() {},
      play: (key: string) => ({ sound: key, outcome: "played" as const }),
      setPicks() {},
      preview: async () => null,
    } as unknown as AudioEngine;
    const c = createAlertController({
      audio: engine,
      storage: createSoundSettingsStorage(
        () => {
          throw new Error("no storage in tests");
        },
        () => {},
      ),
      toast: (a) => toasts.push(a.id),
      title: createTitleMarker({ hidden: false, title: "" }),
    });
    return { c, toasts, last: () => c.store.getState().lastSound };
  }

  test("FR-SHELL-134 alert API: setSuppressed quiets alert() (no flash, Toast, sound) and every sound but pause; off restores both", () => {
    const { c, toasts, last } = controller();
    c.setSuppressed(true);
    c.alert({ id: "cbt.turn", title: "Your turn", detail: "Mira", sound: "turn" });
    c.alertSound("request");
    c.alertSound("resume");
    expect([c.store.getState().flash, toasts, last()]).toEqual([null, [], ""]);
    c.alertSound("pause");
    expect(last()).toBe("pause:played:1");
    c.setSuppressed(false);
    c.alert({ id: "cbt.turn", title: "Your turn", detail: "Mira", sound: "turn" });
    expect([c.store.getState().flash?.id, toasts, last()]).toEqual([
      "cbt.turn",
      ["cbt.turn"],
      "turn:played:2",
    ]);
  });

  test("FR-SHELL-127 suppressed while paused: through the real controller, resume with turn, request and resume all picked plays only turn (+ its flash)", () => {
    const { c, last } = controller();
    const gate = createPauseGate();
    const rt = createPauseRuntime({
      gate,
      suppress: (on) => c.setSuppressed(on),
      alert: (a) => c.alert(a),
      alertSound: (k) => c.alertSound(k),
    });
    const live = (cause: string, store: RecordStore) => {
      rt.onStore(store);
      rt.onFrame({ cause: { name: cause } }, store);
    };
    rt.onStore(storeOf({ pause: null }));
    live(CampaignPaused.type, storeOf());
    expect(last()).toBe("pause:played:1");
    // While paused: a turn alert and a prompt's sound do nothing.
    c.alert({ id: "cbt.turn", title: "Your turn", detail: "Mira", sound: "turn" });
    c.alertSound("request");
    expect([last(), c.store.getState().flash]).toEqual(["pause:played:1", null]);
    live(
      CampaignResumed.type,
      storeOf({ pause: null, extra: { ...TURN_STORE_EXTRA, notification: { n1: prompt() } } }),
    );
    expect([last(), c.store.getState().soundCount]).toEqual(["turn:played:2", 2]);
    expect(c.store.getState().flash?.id).toBe("cbt.turn");
  });
});

describe("the block reaches body portals (FR-SHELL-128, -135)", () => {
  test("FR-SHELL-128 input blocked: every other child of the body inert, incl. a portal opened while blocked; release restores each", () => {
    const listeners = { addEventListener() {}, removeEventListener() {} };
    const dialog = { inert: false }; // a Radix portal opened before the pause
    const dice = { inert: true }; // the dice layer: inert already, stays so
    let added: ((s: { inert: boolean }) => void) | null = null;
    let watching = true;
    const release = blockInput({
      overlay: { contains: () => false, focusables: () => [], focus() {} },
      siblings: [dialog, dice],
      watch: (add) => {
        added = add;
        return () => {
          watching = false;
        };
      },
      win: listeners,
      doc: { activeElement: null, ...listeners },
    });
    expect([dialog.inert, dice.inert]).toEqual([true, true]);
    const tooltip = { inert: false }; // a portal opened while blocked
    (added as ((s: { inert: boolean }) => void) | null)?.(tooltip);
    expect(tooltip.inert).toBe(true);
    release();
    expect([dialog.inert, dice.inert, tooltip.inert, watching]).toEqual([
      false,
      true,
      false,
      false,
    ]);
  });
});

describe("the toast stack under the card (FR-NOTE-63, FR-SHELL-127)", () => {
  const withNotes = (pause: CampaignPause | null, notes: NotificationRecord[], seq: number) => ({
    state: "live" as const,
    store: {
      ...storeOf({
        pause,
        extra: { [NOTIFICATION_TYPE]: Object.fromEntries(notes.map((n) => [n.id, n])) },
      }),
      seq,
    },
  });
  const shownAfter = (pause: CampaignPause | null) => {
    const info = prompt({ id: "n-info", kind: "test", state: "info", actionLabel: null });
    const card = prompt({ id: "n-card" });
    const m: ToastMemory = { toasts: initialToasts(0), campaignId: "c1" };
    const prev = withNotes(pause, [], 4);
    const next = withNotes(pause, [info, card], 5);
    const after = syncToasts(m, prev, next, classify(prev, next), 0);
    return after.toasts.toasts.map((t) => (t.kind === "summary" ? "summary" : t.key));
  };

  test("FR-NOTE-63 prompt while paused: the card toast waits under the card; an info toast goes to history only", () => {
    expect(shownAfter(null).sort()).toEqual(["n-card", "n-info"]);
    expect(shownAfter(PAUSE)).toEqual(["n-card"]);
  });

  test("FR-SHELL-127 callouts dropped while paused, not replayed at resume", () => {
    const m = createToastMemory(Date.now());
    const off = registerToastMemory(m);
    try {
      pauseGate.set(true);
      showCallout({ id: "kill", content: "Goblin 2 falls" });
      expect(m.getState().toasts.callout ?? null).toBeNull();
      pauseGate.set(false);
      expect(m.getState().toasts.callout ?? null).toBeNull();
      showCallout({ id: "kill-2", content: "Wolf falls" });
      expect(m.getState().toasts.callout).toMatchObject({ id: "kill-2" });
    } finally {
      pauseGate.set(false);
      off();
    }
  });
});
