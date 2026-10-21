// FR-DICE-28 kind contract (#171): for every registered log-entry kind, DM-only facts live in
// `dmPayload` alone, so a line built without it (what players get, FR-DICE-15) never shows them;
// manual rolls carry the "physical" badge. FR-DICE-29: no natural marker on initiative lines.
import { describe, expect, test } from "bun:test";
import { lineText } from "./kind-types";
import { getLogKind, logKindNames } from "./kinds";
import { formatEntry } from "./line";
import type { RollPayloadItem } from "./schemas";

const S = "DMONLY";
/** A number no sample payload uses, so it can only come from `dmPayload`. */
const N = 7777;
const dice = [[N, true] as [number, boolean]];

const rollItem = (p: Partial<RollPayloadItem> = {}): RollPayloadItem => ({
  rollId: "r1",
  expression: "1d20+4",
  mode: "normal",
  manual: false,
  dice: [{ faces: 20, value: 12, kept: true }],
  constant: 4,
  total: 16,
  natural: 12,
  label: "Initiative",
  ...p,
});

/**
 * Per kind: a player-safe payload with a manual roll, and a `dmPayload` whose every field is the
 * sentinel. A new kind must add its row here (the registry test below fails otherwise).
 */
const SAMPLES: Record<string, { payload: unknown; dmPayload: unknown | null }> = {
  // FR-MOD-19: a part of an effect players don't receive is named only in `dmPayload`.
  roll: {
    payload: [
      rollItem({
        manual: true,
        total: 13,
        mods: [{ label: null, value: -3, expression: "1d4", rollId: "r2", auto: true }],
        modes: [null],
      }),
    ],
    dmPayload: {
      items: [{ mods: [{ effectId: S, label: S }], modes: [{ effectId: S, label: S }] }],
    },
  },
  "cbt.attack": {
    payload: {
      targetName: "Mira",
      attackName: "Scimitar",
      damageType: "slashing",
      toHit: { dice: 9, constant: 4, total: 13, natural: 9 },
      hit: true,
      damage: 6,
      multiplier: "normal",
      crit: false,
      manual: { toHit: true, damage: true },
    },
    dmPayload: {
      targetAc: N,
      hitComputed: false,
      toHitRolled: N,
      damageRolled: N,
      damageTotal: N,
      applied: N,
      overkill: N,
      overrides: { toHit: true, hit: true, damage: true },
      rolls: {
        toHit: { expression: S, mode: "advantage", dice, constant: N },
        damage: { expression: S, dice, constant: N, crit: true },
      },
    },
  },
  "cbt.hp": {
    payload: { targetName: "Mira", kind: "damage", amount: 5 },
    dmPayload: { applied: N, hpBefore: N, hpAfter: N },
  },
  // FR-CBT-99 (#252): "(secret)" lives in `dmPayload` alone.
  "cbt.side": {
    payload: { targetName: "Goblin 2", side: "ally" },
    dmPayload: { secret: true },
  },
  // FR-CBT-122 (sprint 6): the turn mode lives in `dmPayload` alone.
  "cbt.companion": {
    payload: { action: "follows", name: "Owlbear", ownerName: "Brakka" },
    dmPayload: { turnMode: "in-owner-turn" },
  },
  // Sprint 7 (GEM, feature `gems`): public lines (OQ-GEM-02 A / -10 A); a hidden reroll's
  // target lives in `dmPayload` alone (FR-GEM-13).
  "gem.award": {
    payload: { characterId: "c1", gem: "inspiration", count: 1, held: 2 },
    dmPayload: null,
  },
  "gem.spend": {
    payload: { characterId: "c1", gem: "inspiration", count: 1, target: null },
    dmPayload: { target: { kind: "entry", id: "e1", label: S, from: N } },
  },
};

describe("FR-DICE-28 kind contract", () => {
  test("FR-DICE-28 every registered kind has a contract sample", () => {
    expect(logKindNames().sort()).toEqual(Object.keys(SAMPLES).sort());
  });

  for (const [kind, s] of Object.entries(SAMPLES)) {
    test(`FR-DICE-28 ${kind}: DM-only facts never in the player line; samples parse`, () => {
      const def = getLogKind(kind);
      expect(def?.payload.safeParse(s.payload).success).toBe(true);
      if (s.dmPayload !== null) expect(def?.dmPayload?.safeParse(s.dmPayload).success).toBe(true);
      const player = lineText(
        formatEntry({ kind, actorName: "Goblin", payload: s.payload }).segments,
      );
      expect(player).not.toContain(S);
      expect(player).not.toContain(String(N));
      expect(player).not.toContain("DM ruled");
      expect(player).not.toContain("DM set");
      // The DM's line may use them (here for the kinds that show DM detail).
      formatEntry({ kind, actorName: "Goblin", payload: s.payload, dmPayload: s.dmPayload });
    });
  }

  test("FR-DICE-28 cbt.attack: the DM line shows its DM-only detail; one physical badge for everyone", () => {
    const s = SAMPLES["cbt.attack"] as (typeof SAMPLES)[string];
    const dm = formatEntry({ kind: "cbt.attack", actorName: "Goblin", ...s }).segments;
    expect(lineText(dm)).toContain(`vs AC ${N}`);
    expect(lineText(dm)).toContain("DM ruled hit");
    expect(lineText(dm)).toContain(`DM set; rolled ${N}`);
    const player = formatEntry({ kind: "cbt.attack", actorName: "Goblin", payload: s.payload });
    const badges = player.segments.filter((x) => x.style === "badge").map((x) => x.text);
    // FR-CBT-73 (item 12): both rolls physical → one badge per line.
    expect(badges).toEqual(["physical"]);
  });

  test("FR-DICE-28 / FR-MOD-20 roll: the DM line names every part; players read (DM)", () => {
    const s = SAMPLES.roll as (typeof SAMPLES)[string];
    const dm = lineText(formatEntry({ kind: "roll", actorName: "Goblin", ...s }).segments);
    expect(dm).toContain(`− 3 ${S} (rolled for you)`);
    const player = lineText(
      formatEntry({ kind: "roll", actorName: "Goblin", payload: s.payload }).segments,
    );
    expect(player).toContain("− 3 (DM) (rolled for you)");
  });

  test("FR-DICE-28 a manual roll segment carries the physical badge", () => {
    const segs = formatEntry({
      kind: "roll",
      actorName: "Mira",
      payload: [rollItem({ manual: true })],
    }).segments;
    expect(segs.some((x) => x.style === "badge" && x.text === "physical")).toBe(true);
  });
});

describe("FR-DICE-29 no natural marker on initiative", () => {
  const line = (natural: number, category?: "initiative" | "attack" | "saving-throw") =>
    lineText(
      formatEntry({
        kind: "roll",
        actorName: "Mira",
        category,
        payload: [
          rollItem({
            dice: [{ faces: 20, value: natural, kept: true }],
            constant: 2,
            total: natural + 2,
            natural,
            manual: true,
          }),
        ],
      }).segments,
    );

  test("FR-DICE-29 initiative nat 1 / nat 20 → no marker; attack and save keep it", () => {
    expect(line(1, "initiative")).toBe("Mira — Initiative: 1 + 2 = 3 (physical)");
    expect(line(20, "initiative")).toBe("Mira — Initiative: 20 + 2 = 22 (physical)");
    expect(line(1, "attack")).toContain("— natural 1");
    expect(line(20, "saving-throw")).toContain("— natural 20!");
    // Unknown category (legacy callers): the marker as before.
    expect(line(1)).toContain("— natural 1");
  });
});

/** FR-DICE-78: one space between tokens; none after "(", before ")", doubled, leading or trailing. */
const strays = (t: string) =>
  [/\( /, / \)/, / {2}/, /^\s/, /\s$/].filter((r) => r.test(t)).map(String);

describe("FR-DICE-78 no stray spaces", () => {
  test("FR-DICE-78 no stray spaces: every registered kind's line, DM's and players'", () => {
    for (const [kind, s] of Object.entries(SAMPLES)) {
      const player = formatEntry({ kind, actorName: "Goblin", payload: s.payload }).segments;
      const dm = formatEntry({ kind, actorName: "Goblin", ...s }).segments;
      expect([kind, strays(lineText(player))]).toEqual([kind, []]);
      expect([kind, strays(lineText(dm))]).toEqual([kind, []]);
    }
  });

  test("FR-DICE-78 no stray spaces: sim-9's line (offered 3d6 5 + 2 + 1 last, BL-48) and adv, dis, dropped, offered, manual, modifier-only", () => {
    const line = (items: RollPayloadItem[], dmPayload?: unknown) =>
      lineText(
        formatEntry({ kind: "roll", actorName: "Thorn", payload: items, dmPayload }).segments,
      );
    // Root cause check: the built text was never "1 )": the offered run closes on the last die.
    const sim9 = line([
      rollItem({
        expression: "1d4+3",
        dice: [{ faces: 4, value: 1, kept: true }],
        constant: 3,
        total: 4,
        natural: null,
        label: "Dagger damage (piercing)",
        offered: [
          {
            label: "Sneak Attack",
            value: 8,
            expression: "3d6",
            rollId: "r9",
            type: "piercing",
            dice: [5, 2, 1],
          },
        ],
      }),
    ]);
    expect(sim9).toBe(
      "Thorn — Dagger damage (piercing): 1 + 3 = 4 (+ 8 piercing Sneak Attack (3d6: 5 + 2 + 1) on a hit)",
    );
    const d20 = (value: number, kept: boolean) => ({ faces: 20, value, kept });
    const cases = [
      // adv / dis: the dropped die after the kept one.
      rollItem({
        expression: "2d20kh1+4",
        mode: "advantage",
        dice: [d20(15, true), d20(7, false)],
      }),
      rollItem({
        expression: "2d20kl1+4",
        mode: "disadvantage",
        modes: ["Bane"],
        dice: [d20(3, true), d20(18, false)],
      }),
      // a subtracted group, its last die before ")"; a zero constant.
      rollItem({
        expression: "1d20-3d4",
        dice: [
          d20(12, true),
          { faces: 4, value: 2, kept: true },
          { faces: 4, value: 2, kept: true },
          { faces: 4, value: 1, kept: true },
        ],
        constant: 0,
        total: 7,
      }),
      // manual (physical badge) with an auto part.
      rollItem({
        manual: true,
        mods: [{ label: "Bless", value: 3, expression: "1d4", rollId: "r2", auto: true }],
      }),
      // modifier-only: no dice, the constant alone, then a part.
      rollItem({
        expression: "+5",
        dice: [],
        constant: 5,
        total: 7,
        natural: null,
        mods: [{ label: "Guidance", value: 2, expression: "1d4", rollId: "r3", dice: [2] }],
      }),
    ];
    for (const c of cases) expect([c.expression, strays(line([c]))]).toEqual([c.expression, []]);
  });
});
