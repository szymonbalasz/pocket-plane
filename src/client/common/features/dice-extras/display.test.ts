// FR-DICEX-32 / -38 / -43 (and -09, -17 as amended): where one frame's dice show, per display
// mode and setting. Pure: `planThrow` over real-shaped entries.
import { describe, expect, test } from "bun:test";
import type { GameLogEntryView } from "@shared/dice-roll-log/schemas";
import { emptyStore } from "@shared/protocol/store";
import { pendingInZone, planThrow, ROLL_POPUPS } from "./display";
import { onRollFrame } from "./frame-handler";
import { DEFAULT_SETTINGS, type DiceSettings, type DisplaySetting } from "./settings";
import { isSlow } from "./Throw3D";

const entry = (o: Partial<GameLogEntryView> = {}) =>
  ({
    id: "e1",
    n: 5,
    kind: "roll",
    public: true,
    rollerRole: "player",
    rollerPlayerId: "p1",
    actorName: "Mira",
    payload: [
      {
        expression: "1d20",
        manual: false,
        dice: [{ faces: 20, value: 14, kept: true }],
        constant: 0,
        total: 14,
        label: null,
      },
    ],
    ...o,
  }) as unknown as GameLogEntryView;

const p1 = { campaignId: "c1", role: "player", playerId: "p1" } as const;
const p2 = { campaignId: "c1", role: "player", playerId: "p2" } as const;
const dm = { campaignId: "c1", role: "dm", playerId: null } as const;
const plan = (
  display: DisplaySetting,
  settings: Partial<DiceSettings> = {},
  entries = [entry()],
  you: typeof p1 | typeof p2 | typeof dm = p2,
) =>
  planThrow(entries, you, {
    settings: { ...DEFAULT_SETTINGS, ...settings },
    display,
    tabHidden: false,
  });

describe("FR-DICEX-32 display modes", () => {
  test("FR-DICEX-32 display modes: the §7 table row by row (public roll)", () => {
    expect(ROLL_POPUPS).toBe(true); // D7: the popup hosts the dice
    // screen (default): 3D over the whole screen, no caption, hand-off timing.
    expect(plan("screen")?.plan).toEqual({
      arena: "screen",
      draw: "3d",
      caption: false,
      handoff: true,
    });
    // zone ("Tray throw"): 3D in the zone; its caption only while popups are off.
    expect(plan("zone")?.plan).toEqual({
      arena: "zone",
      draw: "3d",
      caption: false,
      handoff: true,
    });
    expect(plan("zone", { popup: false })?.plan).toEqual({
      arena: "zone",
      draw: "3d",
      caption: true,
      handoff: false,
    });
    // flat: no 3D; die-shape chips in the popup, and in the zone only while popups are off.
    expect(plan("flat")).toBeNull();
    expect(plan("flat", { popup: false })?.plan).toMatchObject({
      arena: "zone",
      draw: "flat",
      caption: true,
    });
    // off: nothing animates.
    expect(plan("off")).toBeNull();
    // The screen layer never shows a caption, popups or not.
    expect(plan("screen", { popup: false })?.plan.caption).toBe(false);
  });

  test("FR-DICEX-32 every mode throws the same dice on the same faces", () => {
    const dice = (d: DisplaySetting, popup = true) =>
      plan(d, { popup })?.t.dice.map((x) => [x.key, x.faces, x.value, x.kept]) ?? null;
    expect(dice("screen")).toEqual([["e1:0", 20, 14, true]]);
    expect(dice("zone")).toEqual(dice("screen"));
    expect(dice("flat", false)).toEqual(dice("screen"));
  });

  test("FR-DICEX-32 a hidden tab animates nothing (DICEX §11)", () => {
    const input = { settings: DEFAULT_SETTINGS, display: "screen" as const, tabHidden: true };
    expect(planThrow([entry()], p2, input)).toBeNull();
  });
});

describe("FR-DICEX-38 DM-only", () => {
  const hidden = entry({
    id: "h1",
    n: 6,
    public: false,
    rollerRole: "dm",
    rollerPlayerId: null,
    actorName: "DM",
  });
  test("FR-DICEX-38 DM-only: a public: false entry never throws on the screen layer or in the zone", () => {
    for (const d of ["screen", "zone", "flat"] as const) {
      expect(plan(d, {}, [hidden], dm)).toBeNull();
    }
  });

  test("FR-DICEX-38 DM-only: a mixed DM frame throws its public dice only, seeded like the players'", () => {
    const pub = entry({ id: "e2", n: 7, rollerRole: "dm", rollerPlayerId: null, actorName: "DM" });
    const onDm = plan("screen", {}, [hidden, pub], dm);
    const onPlayer = plan("screen", {}, [pub], p1);
    expect(onDm?.t.entryIds).toEqual(["e2"]);
    expect(onDm?.t.hidden).toBe(false);
    expect(onDm?.t.seedId).toBe(onPlayer?.t.seedId);
    expect(onDm?.t.dice).toEqual(onPlayer?.t.dice ?? []);
  });
});

describe("FR-DICEX-43 others off", () => {
  test("FR-DICEX-43 others off: another's roll → no screen / zone throw; own roll unaffected", () => {
    for (const d of ["screen", "zone", "flat"] as const) {
      expect(plan(d, { others: false }, [entry()], p2)).toBeNull();
      // flat with popups on: the own popup's chips, nothing in the zone.
      const own = plan(d, { others: false }, [entry()], p1);
      expect(own?.t.entryIds ?? null).toEqual(d === "flat" ? null : ["e1"]);
    }
    // A frame with own + another's entries throws the own dice only.
    const mixed = [entry(), entry({ id: "e9", n: 9, rollerPlayerId: "p2" })];
    expect(plan("screen", { others: false }, mixed, p2)?.t.entryIds).toEqual(["e9"]);
  });
});

describe("FR-DICEX-09 pending (amended)", () => {
  test("FR-DICEX-09 pending + popups on: never in the zone (the own popup's row); popups off → the zone for zone / flat", () => {
    for (const d of ["screen", "zone", "flat", "off"] as const) {
      expect(pendingInZone(DEFAULT_SETTINGS, d)).toBe(false);
    }
    const off = { ...DEFAULT_SETTINGS, popup: false };
    expect(pendingInZone(off, "zone")).toBe(true);
    expect(pendingInZone(off, "flat")).toBe(true);
    expect(pendingInZone(off, "screen")).toBe(false);
    expect(pendingInZone(off, "off")).toBe(false);
  });

  test("FR-DICEX-09 an own entry ends the pending; the frame plays its plan", () => {
    const calls: string[] = [];
    const store = { ...emptyStore(), you: p1 };
    onRollFrame(
      [entry()],
      store as never,
      { settings: DEFAULT_SETTINGS, display: "screen", tabHidden: false },
      {
        ownRolled: (own) => calls.push(`own:${own.map((e) => e.id).join()}`),
        play: (t, p) => calls.push(`play:${t.id}:${p.arena}`),
      },
    );
    expect(calls).toEqual(["own:e1", "play:e1:screen"]);
  });
});

describe("FR-DICEX-44 slow devices", () => {
  test("FR-DICEX-44 slow devices: a screen / zone throw with median frame 40 ms is slow (→ flat + Toast)", () => {
    expect(isSlow(40)).toBe(true);
    expect(isSlow(33)).toBe(false);
    expect(isSlow(16.7)).toBe(false);
    expect(isSlow(null)).toBe(false); // too few frames to judge
  });
});

describe("BL-105 FR-DICEX-83 FR-DICEX-84 own hidden answer", () => {
  // Mira's (p1's) answer to a hidden request: `public: false`, audience p1, rolled by p1.
  const answer = entry({ id: "a1", n: 7, public: false });
  test("FR-DICEX-84 the roller's own hidden answer follows their display (screen / zone / flat), like a sheet roll", () => {
    expect(plan("screen", {}, [answer], p1)?.plan).toEqual(plan("screen", {}, [entry()], p1)?.plan);
    expect(plan("zone", {}, [answer], p1)?.plan.arena).toBe("zone");
    expect(plan("flat", {}, [answer], p1)).toBeNull(); // chips in the popup, as any flat roll
    expect(plan("flat", { popup: false }, [answer], p1)?.plan.draw).toBe("flat");
    expect(plan("off", {}, [answer], p1)).toBeNull();
  });
  test("FR-DICEX-38 still: the DM never throws a public: false entry big, a DM roll-for-missing answer included", () => {
    const missing = entry({
      id: "m1",
      n: 8,
      public: false,
      rollerRole: "dm",
      rollerPlayerId: null,
    });
    for (const e of [answer, missing]) expect(plan("screen", {}, [e], dm)).toBeNull();
    // The player it was rolled for gets it in the popup only (not their own roll).
    expect(plan("screen", {}, [missing], p1)).toBeNull();
  });
});
