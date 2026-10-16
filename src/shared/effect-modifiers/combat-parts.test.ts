// R7 (FR-MOD-39, -40, -47, -48): card offer text, outcome-line part segments and the popup's
// `settleTriggers` defaults.
import { describe, expect, test } from "bun:test";
import { attackLogKind } from "@shared/combat-tracker/log-kinds";
import { lineText } from "@shared/dice-roll-log/kind-types";
import { linePartSegments, offersSuffix, withOffersText } from "./combat-parts";
import { type SettleRow, type SettleStore, settleTriggers } from "./settle";
import type { MarkEffect } from "./trigger-fire";

const fury = { label: "Divine Fury", value: 6, type: "radiant" };
const sneak = { label: "Sneak Attack", value: 9, type: null };

describe("FR-MOD-48 card text", () => {
  test("FR-MOD-48 offers after the damage, typed (the attack's type when null); none → unchanged; too long → a count", () => {
    expect(offersSuffix([fury], "slashing")).toBe(" (+ 6 radiant Divine Fury on a hit)");
    expect(offersSuffix([fury, sneak], "piercing")).toBe(
      " (+ 6 radiant Divine Fury, + 9 piercing Sneak Attack on a hit)",
    );
    expect(offersSuffix([sneak], null)).toBe(" (+ 9 Sneak Attack on a hit)");
    expect(offersSuffix(undefined, "slashing")).toBe("");
    const base = "Brakka: 17 to hit, 12 slashing";
    expect(withOffersText(base, [fury], "slashing", 280)).toBe(
      "Brakka: 17 to hit, 12 slashing (+ 6 radiant Divine Fury on a hit)",
    );
    const long = Array.from({ length: 4 }, (_, i) => ({ ...fury, label: `${"F".repeat(39)}${i}` }));
    const text = withOffersText(`${"B".repeat(40)}: 17 to hit, 12 slashing`, long, "slashing", 200);
    expect(text).toBe(`${"B".repeat(40)}: 17 to hit, 12 slashing (+ 4 trigger parts on a hit)`);
  });
});

describe("FR-MOD-48 outcome line parts", () => {
  test("FR-MOD-48 typed '+ 6 radiant (Divine Fury)', untyped '+ 9 Martial Advantage', players '(DM)'; own multiplier; DM set / ruled", () => {
    const parts = [
      { label: "Divine Fury", value: 6, type: "radiant" },
      { label: null, value: 9, type: null },
      { label: "Hex", value: 2, type: "necrotic", multiplier: "half" as const },
    ];
    expect(lineText(linePartSegments(parts, null, "slashing"))).toBe(
      " + 6 radiant (Divine Fury) + 9 (DM) + 2 necrotic (Hex) (half)",
    );
    const dm = [
      { label: "Divine Fury", rolled: 6 },
      { label: "Martial Advantage", rolled: 7, set: true as const },
      { label: "Hex", rolled: 4, forced: true as const },
    ];
    expect(lineText(linePartSegments(parts, dm, "slashing"))).toBe(
      " + 6 radiant (Divine Fury) + 9 Martial Advantage (DM set; rolled 7) + 2 necrotic (Hex) (half) (DM ruled)",
    );
    // A part typed as the attack reads untyped.
    expect(lineText(linePartSegments([{ ...fury, type: "slashing" }], null, "slashing"))).toBe(
      " + 6 Divine Fury",
    );
  });

  test("FR-MOD-48 cbt.attack line: weapon damage, then the parts (damage = weapon + parts); players and DM", () => {
    const payload = {
      targetName: "Goblin",
      attackName: "Greataxe",
      damageType: "slashing",
      toHit: { dice: 15, constant: 7, total: 22, natural: 15 },
      hit: true,
      damage: 20,
      multiplier: "normal" as const,
      crit: false,
      parts: [{ label: "Divine Fury", value: 6, type: "radiant" as const }],
    };
    const line = (dmPayload?: unknown) =>
      lineText(attackLogKind.formatLine({ actorName: "Brakka", payload, dmPayload }));
    expect(line()).toBe(
      "Brakka attacks Goblin: 15 + 7 = 22 — hit! 14 slashing damage + 6 radiant (Divine Fury)",
    );
    const players = line();
    const nonPublic = lineText(
      attackLogKind.formatLine({
        actorName: "Elite",
        payload: { ...payload, parts: [{ label: null, value: 9, type: null }], damage: 23 },
      }),
    );
    expect(nonPublic).toContain("14 slashing damage + 9 (DM)");
    expect(players).not.toContain("(DM)");
  });
});

describe("FR-MOD-39 settleTriggers", () => {
  const rows: SettleRow[] = [
    { targetId: "gob", hit: false, hp: { current: 7, max: 7 } },
    { targetId: "gob2", hit: true, hp: { current: 7, max: 7 } },
    { targetId: "wolf", hit: true, hp: { current: 5, max: 11 } },
  ];
  const fx = (target: string, presetKey: string, source: string): MarkEffect => ({
    targetCombatantId: target,
    targetCharacterId: null,
    sourceCombatantId: source,
    presetKey,
    endedAt: null,
  });
  const store = (effects: MarkEffect[] = []): SettleStore => ({
    effects,
    campaignPresets: [{ id: "p-ff", name: "Favored Foe" }],
  });
  const card = (triggers: object[]) => ({
    attackerId: "thorn",
    damage: { triggers: triggers as { triggerId: string }[] },
  });

  test("FR-MOD-39 first Hit row in list order; untick; no Hit row → unticked, no target", () => {
    expect(settleTriggers(card([{ triggerId: "df" }]), rows, store())).toEqual([
      { triggerId: "df", targetId: "gob2", ticked: true, hint: null, ask: null },
    ]);
    const ask = { triggerId: "ma", ask: "an ally within 5 ft", untick: true };
    expect(settleTriggers(card([ask]), rows, store())[0]).toEqual({
      triggerId: "ma",
      targetId: "gob2",
      ticked: false,
      hint: "ask",
      ask: "an ally within 5 ft",
    });
    const misses = rows.map((r) => ({ ...r, hit: false }));
    expect(settleTriggers(card([{ triggerId: "df" }]), misses, store())[0]).toMatchObject({
      targetId: null,
      ticked: false,
      hint: null,
    });
    expect(settleTriggers({ attackerId: "x", damage: null }, rows, store())).toEqual([]);
  });

  test("FR-MOD-39 target facts: hurt; marked by the attacker (own source vs another's), built-in key or a campaign mark by name", () => {
    expect(settleTriggers(card([{ triggerId: "cs", hurt: true }]), rows, store())[0]).toMatchObject(
      { targetId: "wolf", ticked: true },
    );
    const hm = { triggerId: "hm", marked: "hunters-mark" };
    expect(
      settleTriggers(card([hm]), rows, store([fx("wolf", "hunters-mark", "thorn")]))[0],
    ).toMatchObject({ targetId: "wolf", ticked: true });
    // Another's mark doesn't count; no Hit row passes → hint "none".
    expect(
      settleTriggers(card([hm]), rows, store([fx("wolf", "hunters-mark", "mira")]))[0],
    ).toMatchObject({ targetId: null, ticked: false, hint: "none" });
    const ff = { triggerId: "ff", marked: "Favored Foe" };
    expect(settleTriggers(card([ff]), rows, store([fx("gob2", "p-ff", "thorn")]))[0]).toMatchObject(
      { targetId: "gob2", ticked: true },
    );
    // An ended mark doesn't count.
    const ended = { ...fx("gob2", "p-ff", "thorn"), endedAt: "2026-10-16T00:00:00Z" };
    expect(settleTriggers(card([ff]), rows, store([ended]))[0]?.targetId).toBeNull();
  });
});
