// The landing (FR-DICEX-49, §6.1 table D): `holding` against the real throw and popup stores on a
// fake clock, fed as the runtime feeds it (`onRollFrame`, then `hold(heldOnArrival(…))`).
import { describe, expect, test } from "bun:test";
import type { GameLogEntryView } from "@shared/dice-roll-log/schemas";
import type { EventFrame, You } from "@shared/protocol/frames";
import { emptyStore, type RecordStore } from "@shared/protocol/store";
import { planThrow, popupHost } from "./display";
import { onRollFrame } from "./frame-handler";
import { createLanding, heldOnArrival, LANDING_MAX_MS, manualOnly } from "./landing";
import { createRollPopups } from "./popups";
import { DEFAULT_SETTINGS, type DiceSettings, type DisplaySetting, is3dDisplay } from "./settings";
import { createDiceExtrasStore } from "./store";
import { newRollEntries } from "./throw-source";
import { FLAT_IN_MS, SETTLE_MAX_MS } from "./timing";

function fakeTimers() {
  const timers = new Map<number, { at: number; fn: () => void }>();
  let id = 0;
  let now = 0;
  return {
    now: () => now,
    setTimeout(fn: () => void, ms: number) {
      timers.set(++id, { at: now + ms, fn });
      return id;
    },
    clearTimeout: (h: unknown) => void timers.delete(h as number),
    advance(ms: number) {
      const end = now + ms;
      for (;;) {
        const next = [...timers].sort((a, b) => a[1].at - b[1].at)[0];
        if (!next || next[1].at > end) break;
        timers.delete(next[0]);
        now = next[1].at;
        next[1].fn();
      }
      now = end;
    },
  };
}

const item = (o: Record<string, unknown> = {}) => ({
  rollId: "r1",
  expression: "2d6",
  mode: "normal",
  manual: false,
  dice: [
    { faces: 6, value: 3, kept: true },
    { faces: 6, value: 5, kept: true },
  ],
  constant: 0,
  total: 8,
  natural: null,
  label: null,
  ...o,
});

const entry = (id: string, o: Partial<GameLogEntryView> = {}, items = [item()]) =>
  ({
    id,
    n: 10,
    kind: "roll",
    category: "other",
    public: true,
    rollerRole: "player",
    rollerPlayerId: "p2",
    actorName: "Player 2",
    payload: items,
    ...o,
  }) as unknown as GameLogEntryView;

const PLAYER: You = { campaignId: "c1", role: "player", playerId: "p1" } as You;
const DM: You = { campaignId: "c1", role: "dm", playerId: null } as You;

interface Opts {
  you?: You;
  settings?: Partial<DiceSettings>;
  display?: DisplaySetting;
  tabHidden?: boolean;
  /** The 3D chunk is in (else a 3D throw waits; `resolve` ends the wait). */
  chunk?: boolean;
}

function setup() {
  const t = fakeTimers();
  const throws = createDiceExtrasStore(t);
  const popups = createRollPopups(throws, () => true, t);
  const landing = createLanding(throws, popups, t);
  let waits: ((ready: boolean) => void)[] = [];
  /** One live frame, as `DiceExtrasRuntime` handles it. */
  const frame = (entries: GameLogEntryView[], o: Opts = {}) => {
    const settings = { ...DEFAULT_SETTINGS, ...o.settings };
    const display = o.display ?? settings.display;
    const tabHidden = o.tabHidden ?? false;
    const store: RecordStore = { ...emptyStore(), you: o.you ?? PLAYER };
    const input = { settings, display, tabHidden };
    onRollFrame(entries, store, input, {
      ownRolled: () => {},
      popup: (all, big) => {
        if (!popupHost(settings)) return;
        popups.add({
          entries: all,
          looks: {},
          big: big && big.plan.draw === "3d" ? { id: big.t.id, entryIds: big.t.entryIds } : null,
          threeD: is3dDisplay(display) && !tabHidden,
        });
      },
      play: (th, plan) => {
        if (plan.draw === "flat" || o.chunk !== false) return throws.play(th, plan);
        landing.wait(th.entryIds);
        waits.push((ready) => {
          if (ready) throws.play(th, plan);
          else if (!popupHost(settings)) throws.play(th, { ...plan, arena: "zone", draw: "flat" });
          landing.unwait(th.entryIds);
        });
      },
    });
    landing.hold(heldOnArrival(entries, display, tabHidden));
  };
  const resolve = (ready: boolean) => {
    const w = waits;
    waits = [];
    for (const f of w) f(ready);
  };
  const seq = () => throws.api.getState().current?.seq ?? -1;
  return { t, throws, popups, landing, frame, resolve, seq };
}

describe("FR-DICEX-49 total hidden until landed", () => {
  test("FR-DICEX-49 screen: held until the big throw rests (reported, or by the 2.5 s budget), shown at rest", () => {
    const { t, throws, landing, frame, seq } = setup();
    frame([entry("a")]);
    expect(landing.landed("a")).toBe(false);
    t.advance(1400);
    expect(landing.landed("a")).toBe(false);
    throws.rested(seq());
    expect(landing.landed("a")).toBe(true);

    frame([entry("b")]);
    t.advance(SETTLE_MAX_MS - 1);
    expect(landing.landed("b")).toBe(false);
    t.advance(1);
    expect(landing.landed("b")).toBe(true);
  });

  test("FR-DICEX-49 a second throw at 1.2 s: the first lands at its snap, the second stays held", () => {
    const { t, landing, frame } = setup();
    frame([entry("a")]);
    t.advance(1200);
    frame([entry("b", { n: 11 })]);
    expect(landing.landed("a")).toBe(true);
    expect(landing.landed("b")).toBe(false);
  });

  test("FR-DICEX-49 zone: the same as screen (popups on and off)", () => {
    for (const popup of [true, false]) {
      const { throws, landing, frame, seq } = setup();
      frame([entry("a")], { settings: { display: "zone", popup } });
      expect(landing.landed("a")).toBe(false);
      throws.rested(seq());
      expect(landing.landed("a")).toBe(true);
    }
  });

  test("FR-DICEX-49 flat: shown at the end of the 0.3 s chip fade (popup chips, or the zone's flat dice with popups off)", () => {
    for (const popup of [true, false]) {
      const { t, landing, frame } = setup();
      frame([entry("a")], { settings: { display: "flat", popup } });
      t.advance(FLAT_IN_MS - 1);
      expect(landing.landed("a")).toBe(false);
      t.advance(1);
      expect(landing.landed("a")).toBe(true);
    }
  });

  test("FR-DICEX-49 off, tab hidden: shown on arrival (nothing animates)", () => {
    const off = setup();
    off.frame([entry("a")], { settings: { display: "off" } });
    expect(off.landing.landed("a")).toBe(true);
    const hidden = setup();
    hidden.frame([entry("a")], { tabHidden: true });
    expect(hidden.landing.landed("a")).toBe(true);
    expect(heldOnArrival([entry("a")], "off", false)).toEqual([]);
    expect(heldOnArrival([entry("a")], "screen", true)).toEqual([]);
  });

  test("FR-DICEX-49 others off: held until the popup's miniature rests; popups off too → arrival", () => {
    const { popups, landing, frame } = setup();
    frame([entry("a")], { settings: { others: false } });
    expect(popups.api.getState().popups[0]?.parts.play?.state).toBe("moving");
    expect(landing.landed("a")).toBe(false);
    popups.rested("a", "play");
    expect(landing.landed("a")).toBe(true);

    const none = setup();
    none.frame([entry("a")], { settings: { others: false, popup: false } });
    expect(none.landing.landed("a")).toBe(true);
  });

  test("FR-DICEX-49 DM-only on the DM: held until its PiP rests; the public entry of the frame lands with the big throw", () => {
    const { throws, popups, landing, frame, seq } = setup();
    const secret = entry("s", { public: false, rollerRole: "dm", rollerPlayerId: null });
    const open = entry("o", { n: 11, rollerRole: "dm", rollerPlayerId: null });
    frame([secret, open], { you: DM });
    expect([landing.landed("s"), landing.landed("o")]).toEqual([false, false]);
    throws.rested(seq());
    expect([landing.landed("s"), landing.landed("o")]).toEqual([false, true]);
    popups.rested("s", "play");
    expect(landing.landed("s")).toBe(true);
  });

  test("FR-DICEX-49 manual-only entry: shown on arrival; a mixed entry (one item typed in) is held", () => {
    const { landing, frame } = setup();
    const typed = item({ manual: true, dice: [{ faces: 20, value: 17, kept: true }] });
    frame([entry("m", {}, [typed])]);
    expect(landing.landed("m")).toBe(true);
    expect(manualOnly(entry("m", {}, [typed]))).toBe(true);
    expect(manualOnly(entry("x", {}, [typed, item()]))).toBe(false);
    frame([entry("x", { n: 11 }, [typed, item()])]);
    expect(landing.landed("x")).toBe(false);
  });

  test("FR-DICEX-49 chunk wait: held through the wait, then as above (3D at rest; failed → flat 0.3 s)", () => {
    for (const popup of [true, false]) {
      const { t, throws, landing, frame, resolve, seq } = setup();
      frame([entry("a")], { chunk: false, settings: { popup } });
      t.advance(1000);
      expect(landing.landed("a")).toBe(false);
      resolve(true);
      expect(landing.landed("a")).toBe(false);
      throws.rested(seq());
      expect(landing.landed("a")).toBe(true);
    }
    const { t, landing, frame, resolve } = setup();
    frame([entry("a")], { chunk: false, settings: { popup: false } });
    t.advance(1500);
    resolve(false);
    expect(landing.landed("a")).toBe(false);
    t.advance(FLAT_IN_MS);
    expect(landing.landed("a")).toBe(true);
  });

  test("FR-DICEX-49 reduced motion: identical to without (#247): nothing reads it", () => {
    // The plan, the popup and the hold take no motion input at all: the same frame lands the same.
    expect(heldOnArrival.length).toBe(3);
    expect(planThrow.length).toBe(3);
    const { throws, landing, frame, seq } = setup();
    frame([entry("a")]);
    expect(landing.landed("a")).toBe(false);
    throws.rested(seq());
    expect(landing.landed("a")).toBe(true);
  });

  test("FR-DICEX-49 reconnect mid-throw: the resync brings the entry again, it stays held and lands at rest", () => {
    const { throws, landing, frame, seq } = setup();
    const e = entry("a");
    frame([e]);
    // The resync snapshot already holds `a`: as a frame it is no new `roll` entry (no handler).
    const prior: RecordStore = {
      ...emptyStore(),
      records: { "game-log-entry": { a: e } },
    } as RecordStore;
    const resync = { changes: [{ type: "game-log-entry", op: "upsert", id: "a", record: e }] };
    expect(newRollEntries(resync as unknown as EventFrame, prior, prior)).toEqual([]);
    expect(landing.landed("a")).toBe(false);
    throws.rested(seq());
    expect(landing.landed("a")).toBe(true);
  });

  test("FR-DICEX-49 reload → holding empty, every entry shown; snapshot / resync-only / undo / below-floor entries are never held", () => {
    const { landing } = setup();
    expect(landing.api.getState().holding.size).toBe(0);
    for (const id of ["snapshot", "resync", "undone", "floor"])
      expect(landing.landed(id)).toBe(true);
  });

  test("FR-DICEX-49 stuck animation: shown at 6 s; the deadline is arrival + 6 s", () => {
    const { t, popups, landing, frame } = setup();
    t.advance(500);
    frame([entry("a")], { settings: { others: false } });
    expect(landing.api.getState().holding.get("a")).toBe(500 + LANDING_MAX_MS);
    // The miniature never reports; the popup's own cap rests it at the same 6 s.
    popups.mounted("a", () => true);
    popups.pointer("a", true);
    t.advance(LANDING_MAX_MS - 1);
    expect(landing.landed("a")).toBe(false);
    t.advance(1);
    expect(landing.landed("a")).toBe(true);
    expect(LANDING_MAX_MS).toBe(6000);
  });

  test("FR-DICEX-49 a popup closed mid-throw: its big dice still hold the entry until they rest", () => {
    const { throws, popups, landing, frame, seq } = setup();
    frame([entry("a")]);
    popups.close("a");
    expect(landing.landed("a")).toBe(false);
    throws.rested(seq());
    expect(landing.landed("a")).toBe(true);
  });
});
