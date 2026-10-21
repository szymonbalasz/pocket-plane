// FR-CBT-137 (sprint 7, track ST): the overkill callout suffix on `cbt.attack` / `cbt.hp` lines;
// FR-CBT-136: the sourced `cbt.hp` line.
import { describe, expect, test } from "bun:test";
import { lineText } from "@shared/dice-roll-log/kind-types";
import { attackLogKind, hpLogKind } from "./log-kinds";

const attack = {
  targetName: "Goblin 1",
  attackName: "Rapier",
  damageType: "piercing",
  toHit: null,
  hit: true,
  damage: 30,
  multiplier: "normal" as const,
  crit: false,
  callout: "overkill" as const,
};
const attackDm = {
  targetAc: 15,
  hitComputed: null,
  toHitRolled: null,
  damageRolled: 30,
  damageTotal: 30,
  applied: 7,
  overkill: 23,
  overrides: { toHit: false, hit: true, damage: false },
};
const line = (segs: Parameters<typeof lineText>[0]) => lineText(segs);

describe("FR-CBT-137 formatLine suffix", () => {
  test("FR-CBT-137 formatLine suffix: ' — Overkill!' for both; the DM adds ' (+23 over 7 HP)'", () => {
    const base = { actorName: "Thorn", category: "attack" as const };
    expect(line(attackLogKind.formatLine({ ...base, payload: attack }))).toBe(
      "Thorn → Goblin 1: 30 piercing damage (Rapier) — Overkill!",
    );
    expect(line(attackLogKind.formatLine({ ...base, payload: attack, dmPayload: attackDm }))).toBe(
      "Thorn → Goblin 1: 30 piercing damage (Rapier) — Overkill! (+23 over 7 HP)",
    );
    const { callout: _c, ...plain } = attack;
    expect(line(attackLogKind.formatLine({ ...base, payload: plain }))).not.toContain("Overkill");
    const hp = {
      targetName: "Goblin 1",
      kind: "damage" as const,
      amount: 30,
      callout: "overkill" as const,
    };
    const hpDm = { applied: 7, hpBefore: 7, hpAfter: 0, overkill: 23 };
    expect(line(hpLogKind.formatLine({ ...base, actorName: "DM", payload: hp }))).toBe(
      "DM — Goblin 1 takes 30 damage — Overkill!",
    );
    expect(
      line(hpLogKind.formatLine({ ...base, actorName: "DM", payload: hp, dmPayload: hpDm })),
    ).toBe("DM — Goblin 1 takes 30 damage — Overkill! (+23 over 7 HP)");
  });

  test("FR-CBT-136 sourced line: 'Sela → Mira, heal 8' / 'Goblin → Mira, 8 damage'; DM lines unchanged", () => {
    const base = { category: "healing" as const };
    const heal = { targetName: "Mira", kind: "heal" as const, amount: 8, sourced: true as const };
    expect(line(hpLogKind.formatLine({ ...base, actorName: "Sela", payload: heal }))).toBe(
      "Sela → Mira, heal 8",
    );
    const dmg = { targetName: "Mira", kind: "damage" as const, amount: 8, sourced: true as const };
    expect(line(hpLogKind.formatLine({ ...base, actorName: "Goblin", payload: dmg }))).toBe(
      "Goblin → Mira, 8 damage",
    );
    const { sourced: _s, ...dm } = heal;
    expect(line(hpLogKind.formatLine({ ...base, actorName: "DM", payload: dm }))).toBe(
      "DM — Mira heals 8 HP",
    );
  });
});
