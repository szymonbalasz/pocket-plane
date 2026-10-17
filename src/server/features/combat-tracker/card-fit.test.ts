// FR-CBT-81 (sprint 4; FR-MOD-37 fit order, FR-NOTE-21 text cap): the damage card with weapon
// parts stays within the kind's 4 KB payload and 280-char text; weapon parts never drop.
import { describe, expect, test } from "bun:test";
import { CARD_MODS_MAX, DamageCardPayload } from "@shared/combat-tracker/schemas";
import { jsonBytes, TEXT_MAX } from "@shared/notifications/schemas";
import { DAMAGE_CARD_PAYLOAD_MAX_BYTES, damageCardText, fitCardPayload } from "./card-kind";

const cjk = (n: number) => "火".repeat(n);
const id = (p: string) => `${p}-0000-0000-0000-000000000000`.slice(0, 36);
const dice = (n: number) => Array.from({ length: n }, () => [12, true] as [number, boolean]);

/** MOD §12's worst card with 40-char names everywhere, no offers (already dropped). */
function worst(name: (n: number) => string, offers = 0): DamageCardPayload {
  const mod = {
    label: name(40),
    value: -48,
    expression: "4d12",
    auto: true as const,
    rollId: id("r"),
  };
  const extra = (i: number) => ({
    type: "lightning" as const,
    rollId: id(`x${i}`),
    dice: dice(12),
    constant: 10,
    total: 154,
    manual: true,
  });
  return DamageCardPayload.parse({
    encounterId: id("e"),
    attackerId: id("a"),
    attackerName: name(40),
    attackName: name(40),
    damageType: "bludgeoning",
    mode: "advantage",
    crit: true,
    toHit: {
      rollId: id("h"),
      dice: [
        [20, true],
        [1, false],
      ],
      constant: 30,
      total: 99,
      manual: true,
      natural: 20,
      mods: Array(CARD_MODS_MAX).fill(mod),
    },
    damage: {
      rollId: id("d"),
      dice: dice(50),
      constant: 30,
      total: 999,
      manual: true,
      mods: Array(CARD_MODS_MAX).fill(mod),
      ...(offers
        ? {
            triggers: Array.from({ length: offers }, (_, i) => ({
              triggerId: id(`t${i}`),
              label: name(40),
              value: 999,
              expression: "20d12+20",
              rollId: id(`o${i}`),
              type: "radiant",
            })),
          }
        : {}),
      extra: [extra(1), extra(2)],
    },
    attackId: id("att"),
  });
}

describe("FR-CBT-81 card fit", () => {
  test("FR-CBT-81 4 KB: multi-byte names cut mod labels to 12 chars, then names to 20; extra parts kept", () => {
    const p = worst(cjk);
    expect(jsonBytes(p)).toBeGreaterThan(DAMAGE_CARD_PAYLOAD_MAX_BYTES);
    const fit = fitCardPayload(p);
    expect(jsonBytes(fit)).toBeLessThanOrEqual(DAMAGE_CARD_PAYLOAD_MAX_BYTES);
    expect(fit.damage?.extra).toEqual(p.damage?.extra);
    expect(fit.damage?.mods?.[0]?.label).toBe(`${cjk(12)}…`);
    expect(DamageCardPayload.safeParse(fit).success).toBe(true);
    // A card that fits is left alone.
    const small = {
      ...p,
      toHit: null,
      damage: { ...(p.damage as NonNullable<typeof p.damage>), mods: undefined },
    };
    const ascii = worst((n) => "a".repeat(n));
    expect(fitCardPayload(ascii).attackerName).toBe(ascii.attackerName);
    expect(fitCardPayload(small as DamageCardPayload)).toBe(small as DamageCardPayload);
  });

  test("FR-CBT-81 max-length text (40-char names, 2 parts, 4 offers) ≤ 280: offers collapse first, then '…'", () => {
    const p = worst((n) => "W".repeat(n), 4);
    const text = damageCardText(p);
    expect(text.length).toBeLessThanOrEqual(TEXT_MAX);
    expect(text).toContain(
      "+ 154 lightning + 154 lightning (critical) (+ 4 trigger parts on a hit)",
    );
    const long = worst((n) => "W".repeat(n), 4);
    const longer = { ...long, attackerName: "N".repeat(270) };
    const cut = damageCardText(longer);
    expect(cut).toHaveLength(TEXT_MAX);
    expect(cut.endsWith("…")).toBe(true);
  });
});
