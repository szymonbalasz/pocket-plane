// Roll popups (FR-DICEX-09, -38–41): the store's stack, timers and PiP parts against the real
// throw store (fake timers), and the pure row / PiP / clip / placement logic.
import { describe, expect, test } from "bun:test";
import { type DiceThrow, throwDice } from "@shared/dice-extras/throw";
import type { GameLogEntryView } from "@shared/dice-roll-log/schemas";
import { dmStackAt, pipClip, pipDiePx, popupRows } from "./popup-logic";
import { createRollPopups, pipModeOf, pipPlan, type RollPopup } from "./popups";
import { createDiceExtrasStore } from "./store";
import { FLAT_IN_MS, POPUP_CLOSE_MS, POPUP_MS, POPUP_ROLLING_MAX_MS } from "./timing";

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
  expression: "1d20+5",
  mode: "normal",
  manual: false,
  dice: [{ faces: 20, value: 14, kept: true }],
  constant: 5,
  total: 19,
  natural: null,
  label: "Athletics",
  ...o,
});

const entry = (o: Partial<GameLogEntryView> = {}, items = [item()]) =>
  ({
    id: "e1",
    n: 5,
    kind: "roll",
    category: "skill",
    public: true,
    rollerRole: "player",
    rollerPlayerId: "p1",
    actorName: "Mira",
    payload: items,
    ...o,
  }) as unknown as GameLogEntryView;

const hiddenDm = (id: string, n: number, name = "DM") =>
  entry({ id, n, public: false, rollerRole: "dm", rollerPlayerId: null, actorName: name });

function setup() {
  const t = fakeTimers();
  const throws = createDiceExtrasStore(t);
  let ready = true;
  const popups = createRollPopups(throws, () => ready, t);
  const state = () => popups.api.getState().popups;
  const one = (id = "e1") => state().find((p) => p.id === id) as RollPopup;
  return {
    t,
    throws,
    popups,
    state,
    one,
    setReady: (v: boolean) => {
      ready = v;
    },
  };
}

/** The big throw of `entries` as the runtime plans it (its id and entries). */
const bigOf = (entries: GameLogEntryView[]) => {
  const t = throwDice(entries) as DiceThrow;
  return { t, big: { id: t.id, entryIds: t.entryIds } };
};
const screen = { arena: "screen", draw: "3d", caption: false, handoff: true } as const;

describe("FR-DICEX-39 roll popup", () => {
  test("FR-DICEX-39 a live frame → one popup, 'Rolling…' until its dice rest, then 6 s; the oldest of 4 closes (≤ 3)", () => {
    const { t, popups, state, one } = setup();
    popups.add({ entries: [entry()], looks: {}, big: null, threeD: false });
    expect(one().state).toBe("rolling");
    t.advance(FLAT_IN_MS); // chips fade in, then rest
    expect(one().state).toBe("rest");
    t.advance(POPUP_MS - 1);
    expect(one().state).toBe("rest");
    t.advance(1);
    expect(one().state).toBe("closing");
    t.advance(POPUP_CLOSE_MS);
    expect(state()).toEqual([]);

    // FR-DICEX-39 stacking: 5 rolls in 2 s → ≤ 3 popups, oldest closed first.
    for (const n of [1, 2, 3, 4, 5]) {
      popups.add({ entries: [entry({ id: `b${n}`, n })], looks: {}, big: null, threeD: false });
      t.advance(400);
    }
    expect(state().map((p) => p.id)).toEqual(["b3", "b4", "b5"]);
  });

  test("FR-DICEX-39 hover / focus pauses the 6 s timer; leaving resumes what was left", () => {
    const { t, popups, one } = setup();
    popups.add({ entries: [entry()], looks: {}, big: null, threeD: false });
    t.advance(FLAT_IN_MS + 4000);
    popups.hover("e1", true);
    t.advance(60_000);
    expect(one().state).toBe("rest");
    popups.hover("e1", false);
    t.advance(1999);
    expect(one().state).toBe("rest");
    t.advance(1);
    expect(one().state).toBe("closing");
  });

  test("FR-DICEX-39 a popup whose dice nothing reports on (its view never mounted) rests by the rolling cap, then closes", () => {
    const { t, popups, one } = setup();
    popups.add({ entries: [entry()], looks: {}, big: null, threeD: true });
    t.advance(POPUP_ROLLING_MAX_MS - 1);
    expect(one().state).toBe("rolling");
    t.advance(1);
    expect(one().state).toBe("rest");
    t.advance(POPUP_MS);
    expect(one().state).toBe("closing");
  });

  test("FR-DICEX-39 ✕ closes at once; a frame without `roll` entries opens nothing", () => {
    const { popups, state, one } = setup();
    popups.add({ entries: [entry()], looks: {}, big: null, threeD: false });
    popups.close("e1");
    expect(one().state).toBe("closing");
    expect(
      popups.add({
        entries: [entry({ id: "x", kind: "note" })],
        looks: {},
        big: null,
        threeD: false,
      }),
    ).toBeNull();
    expect(state()).toHaveLength(1);
  });
});

describe("FR-DICEX-41 PiP", () => {
  test("FR-DICEX-41 PiP plan: big throw → handoff; none big + 3D → play; no 3D → chips; mixed → both", () => {
    expect(pipPlan(["a"], ["a"], true)).toEqual({ mode: "handoff", handoff: ["a"], play: [] });
    expect(pipPlan(["a"], null, true)).toEqual({ mode: "play", handoff: [], play: ["a"] });
    expect(pipPlan(["a"], ["a"], false)).toEqual({ mode: "chips", handoff: [], play: [] });
    expect(pipPlan(["h", "a"], ["a"], true)).toEqual({
      mode: "play",
      handoff: ["a"],
      play: ["h"],
    });
  });

  test("FR-DICEX-41 PiP same dice: the popup's dice keys, values and count = the throw's in handoff, play and chips", () => {
    const { popups, one } = setup();
    const entries = [
      entry({}, [item({ dice: [{ faces: 6, value: 2, kept: true }], expression: "3d6" })]),
    ];
    const thrown = throwDice(entries) as DiceThrow;
    const dice = (p: RollPopup) => p.t.dice.map((d) => [d.key, d.faces, d.value]);
    for (const [mode, big, threeD] of [
      ["handoff", bigOf(entries).big, true],
      ["play", null, true],
      ["chips", null, false],
    ] as const) {
      popups.add({ entries, looks: {}, big, threeD });
      expect([mode, pipModeOf(one())]).toEqual([mode, mode]);
      expect(dice(one())).toEqual(thrown.dice.map((d) => [d.key, d.faces, d.value]));
      popups.close("e1");
    }
  });

  test("FR-DICEX-35 FR-DICEX-41 handoff: the popup rests when its big throw rests; the still lands in the PiP", () => {
    const { t, throws, popups, one } = setup();
    const entries = [entry()];
    const { t: big, big: ref } = bigOf(entries);
    popups.add({ entries, looks: {}, big: ref, threeD: true });
    throws.play(big, screen);
    expect(one().state).toBe("rolling");
    t.advance(1200);
    throws.rested(throws.api.getState().current?.seq ?? -1);
    expect(one().state).toBe("rest");
    const canvas = {} as HTMLCanvasElement;
    popups.still("e1", "handoff", canvas);
    expect(one().stills.handoff).toBe(canvas);
  });

  test("FR-DICEX-18 interrupt: a new throw snaps the running one to rest, so its popup gets its dice at once", () => {
    const { throws, popups, one } = setup();
    const a = [entry({ id: "a", n: 1 })];
    const b = [entry({ id: "b", n: 2 })];
    popups.add({ entries: a, looks: {}, big: bigOf(a).big, threeD: true });
    throws.play(bigOf(a).t, screen);
    popups.add({ entries: b, looks: {}, big: bigOf(b).big, threeD: true });
    throws.play(bigOf(b).t, screen);
    expect(one("a").state).toBe("rest");
    expect(one("b").state).toBe("rolling");
  });

  test("FR-DICEX-41 a big throw that ends while moving (no zone room, WebGL lost) → its dice play in miniature, else chips", () => {
    for (const ready of [true, false]) {
      const { throws, popups, one, setReady } = setup();
      setReady(ready);
      const entries = [entry()];
      popups.add({ entries, looks: {}, big: bigOf(entries).big, threeD: true });
      throws.play(bigOf(entries).t, screen);
      throws.flat(throws.api.getState().current?.seq ?? -1); // popups on: the run ends
      expect(throws.api.getState().current).toBeNull();
      expect(pipModeOf(one())).toBe(ready ? "play" : "chips");
    }
  });

  test("FR-DICEX-41 miniature: rests on the renderer's report; a failed one falls back to chips", () => {
    const { t, popups, one } = setup();
    popups.add({ entries: [entry()], looks: {}, big: null, threeD: true });
    expect(pipModeOf(one())).toBe("play");
    popups.rested("e1", "play");
    expect(one().state).toBe("rest");
    popups.add({ entries: [entry({ id: "e2", n: 6 })], looks: {}, big: null, threeD: true });
    popups.fallback("e2", "play", "chips");
    expect(pipModeOf(one("e2"))).toBe("chips");
    t.advance(FLAT_IN_MS);
    expect(one("e2").state).toBe("rest");
  });

  test("FR-DICEX-41 concurrency + clip: the scissor follows the PiP inside its card and the viewport, never under a dialog", () => {
    const vp = { x: 0, y: 0, w: 1280, h: 800 };
    const card = { x: 984, y: 400, w: 280, h: 160 };
    const pip = { x: 992, y: 440, w: 180, h: 96 };
    expect(pipClip(pip, [card, vp], [])).toEqual(pip);
    // The stack shifted up by a new toast: the clip moves with the PiP's rect.
    expect(pipClip({ ...pip, y: 300 }, [{ ...card, y: 260 }, vp], [])).toEqual({ ...pip, y: 300 });
    // A dialog over the PiP's right half → only the left part draws; over all of it → nothing.
    const dialog = { x: 1080, y: 0, w: 200, h: 800 };
    expect(pipClip(pip, [card, vp], [dialog])).toEqual({ x: 992, y: 440, w: 88, h: 96 });
    expect(pipClip(pip, [card, vp], [{ x: 900, y: 300, w: 400, h: 400 }])).toBeNull();
    // Half off the card (it scrolled / is closing): clipped to the card.
    expect(pipClip({ ...pip, y: 520 }, [card, vp], [])).toEqual({ ...pip, y: 520, h: 40 });
    // Dice fit the PiP: 1 die big, 20 dice small, never below 18 px.
    expect(pipDiePx(pip, 1)).toBe(40);
    expect(pipDiePx(pip, 20)).toBeLessThan(40);
    expect(pipDiePx({ w: 60, h: 40 }, 20)).toBe(18);
  });
});

describe("FR-DICEX-38 DM-only", () => {
  test("FR-DICEX-38 DM-only: a public: false entry → PiP play (no big throw) + eye-off rows", () => {
    const { popups, one } = setup();
    popups.add({ entries: [hiddenDm("h1", 6)], looks: {}, big: null, threeD: true });
    const p = one("h1");
    expect(pipModeOf(p)).toBe("play");
    expect(p.hidden).toBe(true);
    expect(popupRows(p.entries).map((r) => r.hidden)).toEqual([true]);
  });

  test("FR-DICEX-38 mixed frame on the DM: rows for both entries; PiP = public hand-off + DM-only miniature; data-dice = all; players' public only", () => {
    const pub = entry({ id: "p1e", n: 7 }, [item({ rollId: "r2", total: 12 })]);
    const hid = hiddenDm("h1", 6);
    const dm = setup();
    dm.popups.add({ entries: [hid, pub], looks: {}, big: bigOf([pub]).big, threeD: true });
    const p = dm.one("h1");
    expect(popupRows(p.entries).map((r) => [r.entryId, r.hidden])).toEqual([
      ["h1", true],
      ["p1e", false],
    ]);
    expect(p.parts.handoff?.ids).toEqual(["p1e"]);
    expect(p.parts.play?.ids).toEqual(["h1"]);
    expect(pipModeOf(p)).toBe("play");
    const player = setup();
    player.popups.add({ entries: [pub], looks: {}, big: bigOf([pub]).big, threeD: true });
    expect(p.t.dice.length).toBe(2);
    expect(player.one("p1e").t.dice.length).toBe(1);
    // FR-DICEX-15: both tumble the public dice from the public entry's seed.
    expect(p.t.seedId).toBe(player.one("p1e").t.seedId);
  });
});

describe("FR-DICEX-40 content", () => {
  test("FR-DICEX-40 content: actor, label else expression, total + adv / natural / physical / offered as the line; initiative has no natural", () => {
    const rows = popupRows([
      entry({}, [
        item({ mode: "advantage", natural: 20, total: 25 }),
        item({ rollId: "r2", label: null, expression: "2d6", manual: true, total: 7 }),
        item({
          rollId: "r3",
          label: "Longsword",
          total: 9,
          offered: [{ rollId: "o1", label: "Divine Fury", value: 4, expression: "1d6" }],
        }),
      ]),
      entry({ id: "i1", n: 6, category: "initiative", actorName: "Goblin" }, [
        item({ natural: 1, label: "Initiative" }),
      ]),
    ]);
    const [a, b] = rows;
    expect(a?.actor).toBe("Mira");
    expect(a?.items.map((i) => [i.label, i.total, i.mode, i.natural, i.physical])).toEqual([
      ["Athletics", 25, "adv", "natural 20!", false],
      ["2d6", 7, null, null, true],
      ["Longsword", 9, null, null, false],
    ]);
    expect(a?.items[2]?.offered).toEqual([{ key: "o1", label: "Divine Fury", value: 4 }]);
    expect(b?.items[0]?.natural).toBeNull();
  });

  test("FR-DICEX-40 a coalesced frame lists one named row per entry (sim-7: no '· N rolls')", () => {
    const rows = popupRows([
      hiddenDm("o1", 3, "Ogre"),
      hiddenDm("o2", 4, "Ogre 2"),
      hiddenDm("o3", 5, "Goblin"),
    ]);
    expect(rows.map((r) => r.actor)).toEqual(["Ogre", "Ogre 2", "Goblin"]);
  });

  test("FR-DICEX-40 payload only: a dmPayload sentinel never reaches a row", () => {
    const rows = popupRows([
      entry({ dmPayload: { items: [{ mods: [{ name: "DMPAYLOAD-SENTINEL" }] }] } }),
    ]);
    expect(JSON.stringify(rows)).not.toContain("DMPAYLOAD-SENTINEL");
  });
});

describe("FR-DICEX-39 placement", () => {
  test("FR-DICEX-39 FR-NOTE-32 DM stack: top-centre; over Initiative → left of it; no room → below it", () => {
    const vp = { w: 1280 };
    const size = { w: 280, h: 160 };
    expect(dmStackAt(vp, 100, size, null)).toEqual({ left: 500, top: 100 });
    // Initiative top-right, clear of the centre → stays centred.
    expect(dmStackAt(vp, 100, size, { x: 900, y: 60, w: 368, h: 400 })).toEqual({
      left: 500,
      top: 100,
    });
    // Initiative over the centre → shifted left with the 12 px gap.
    expect(dmStackAt(vp, 100, size, { x: 600, y: 60, w: 400, h: 300 })).toEqual({
      left: 308,
      top: 100,
    });
    // No room left of it → below it.
    expect(dmStackAt(vp, 100, size, { x: 200, y: 60, w: 900, h: 300 })).toEqual({
      left: 500,
      top: 372,
    });
  });
});
