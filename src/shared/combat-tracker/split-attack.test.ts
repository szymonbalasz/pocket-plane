// FR-CBT-73 (N7, report item 12): outcome lines of partial cards and one "physical" badge per
// line. Pure: `formatLine` for players (no `dmPayload`) and the DM.
import { describe, expect, test } from "bun:test";
import { lineText } from "@shared/dice-roll-log/kind-types";
import { type AttackLogDmPayload, type AttackLogPayload, attackLogKind } from "./log-kinds";

const base: AttackLogPayload = {
  targetName: "Goblin",
  attackName: "Light crossbow",
  damageType: "piercing",
  toHit: { dice: 12, constant: 4, total: 16, natural: 12 },
  hit: true,
  damage: 6,
  multiplier: "normal",
  crit: false,
  manual: { toHit: false, damage: false },
};
const dm: AttackLogDmPayload = {
  targetAc: 15,
  hitComputed: true,
  toHitRolled: 16,
  damageRolled: 6,
  damageTotal: 6,
  applied: 6,
  overkill: 0,
  overrides: { toHit: false, hit: false, damage: false },
  rolls: { damage: { expression: "1d8+2", dice: [[4, true]], constant: 2, crit: false } },
};
const line = (payload: AttackLogPayload, dmPayload?: AttackLogDmPayload) =>
  lineText(attackLogKind.formatLine({ actorName: "Mira", payload, dmPayload }));
const badges = (payload: AttackLogPayload) =>
  attackLogKind
    .formatLine({ actorName: "Mira", payload })
    .filter((s) => s.style === "badge")
    .map((s) => s.text);

describe("FR-CBT-73 formatLine", () => {
  test("FR-CBT-73 to-hit-only applied as a miss: no damage part", () => {
    expect(line({ ...base, hit: false, damage: 0 })).toBe(
      "Mira attacks Goblin: 12 + 4 = 16 — miss",
    );
  });

  test("FR-CBT-73 damage-only: 'Mira → Goblin', ± half; the DM's dice breakdown", () => {
    const p = { ...base, toHit: null };
    expect(line(p)).toBe("Mira → Goblin: 6 piercing damage (Light crossbow)");
    expect(line({ ...p, damage: 3, multiplier: "half" })).toBe(
      "Mira → Goblin: 3 piercing damage (half) (Light crossbow)",
    );
    const dmOnly = { ...dm, toHitRolled: null, hitComputed: null };
    expect(line(p, dmOnly)).toBe(
      "Mira → Goblin: 6 piercing damage (Light crossbow) (1d8+2: 4 + 2)",
    );
    // A DM-typed total on a card without a damage roll.
    expect(
      line(p, { ...dmOnly, damageRolled: null, overrides: { ...dm.overrides, damage: true } }),
    ).toBe("Mira → Goblin: 6 piercing damage (Light crossbow) (DM set) (1d8+2: 4 + 2)");
  });

  test("FR-CBT-73 item 12: both rolls manual → one badge at the end; one manual → after that roll", () => {
    const both = { ...base, manual: { toHit: true, damage: true } };
    expect(badges(both)).toEqual(["physical"]);
    expect(line(both)).toBe("Mira attacks Goblin: 12 + 4 = 16 — hit! 6 piercing damage (physical)");
    expect(line({ ...base, manual: { toHit: true, damage: false } })).toBe(
      "Mira attacks Goblin: 12 + 4 = 16 (physical) — hit! 6 piercing damage",
    );
    expect(line({ ...base, manual: { toHit: false, damage: true } })).toBe(
      "Mira attacks Goblin: 12 + 4 = 16 — hit! 6 piercing damage (physical)",
    );
    // Both manual but a miss: the damage isn't shown, so the to-hit keeps its badge.
    expect(line({ ...both, hit: false })).toBe(
      "Mira attacks Goblin: 12 + 4 = 16 (physical) — miss",
    );
  });

  test("FR-CBT-73 old rows (no manual, both rolls) render as before", () => {
    const { manual: _, ...old } = base;
    expect(line(old as AttackLogPayload)).toBe(
      "Mira attacks Goblin: 12 + 4 = 16 — hit! 6 piercing damage",
    );
  });
});
