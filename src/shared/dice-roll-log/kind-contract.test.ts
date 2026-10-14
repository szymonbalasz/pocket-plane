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
  roll: { payload: [rollItem({ manual: true })], dmPayload: null },
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

  test("FR-DICE-28 cbt.attack: the DM line shows its DM-only detail; physical badges for everyone", () => {
    const s = SAMPLES["cbt.attack"] as (typeof SAMPLES)[string];
    const dm = formatEntry({ kind: "cbt.attack", actorName: "Goblin", ...s }).segments;
    expect(lineText(dm)).toContain(`vs AC ${N}`);
    expect(lineText(dm)).toContain("DM ruled hit");
    expect(lineText(dm)).toContain(`DM set; rolled ${N}`);
    const player = formatEntry({ kind: "cbt.attack", actorName: "Goblin", payload: s.payload });
    const badges = player.segments.filter((x) => x.style === "badge").map((x) => x.text);
    expect(badges).toEqual(["physical", "physical"]);
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
