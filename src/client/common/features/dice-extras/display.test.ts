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
  test("FR-DICEX-32 display modes: the §7 table row by row (public roll; popups not built yet)", () => {
    expect(ROLL_POPUPS).toBe(false); // D7 turns the popup on
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
    // flat: no 3D; chips in the zone (no popup hosts them before D7).
    expect(plan("flat")?.plan).toMatchObject({ arena: "zone", draw: "flat" });
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
    const dice = (d: DisplaySetting) =>
      plan(d)?.t.dice.map((x) => [x.key, x.faces, x.value, x.kept]) ?? null;
    expect(dice("screen")).toEqual([["e1:0", 20, 14, true]]);
    expect(dice("zone")).toEqual(dice("screen"));
    expect(dice("flat")).toEqual(dice("screen"));
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
      expect(plan(d, { others: false }, [entry()], p1)?.t.entryIds).toEqual(["e1"]);
    }
    // A frame with own + another's entries throws the own dice only.
    const mixed = [entry(), entry({ id: "e9", n: 9, rollerPlayerId: "p2" })];
    expect(plan("screen", { others: false }, mixed, p2)?.t.entryIds).toEqual(["e9"]);
  });
});

describe("FR-DICEX-09 pending (amended)", () => {
  test("FR-DICEX-09 pending: in the zone for zone / flat; never on the screen layer; off → none", () => {
    expect(pendingInZone(DEFAULT_SETTINGS, "zone")).toBe(true);
    expect(pendingInZone(DEFAULT_SETTINGS, "flat")).toBe(true);
    expect(pendingInZone(DEFAULT_SETTINGS, "screen")).toBe(false);
    expect(pendingInZone(DEFAULT_SETTINGS, "off")).toBe(false);
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
