// Sprint 10, H1 (BL-103, sim-13 glitch 7): Thorn's 30 on the 13 HP Elite Goblin Warrior 2 is a
// callout with overkill 17. The DM's Biggest overkill reads "17" (the amount); a player's is the
// callout line's damage and reads "30 damage" (Stats → Session and the recap Awards share the
// text), never a bare number under "Biggest overkill"; the player's award carries no amount.
import { describe, expect, test } from "bun:test";
import { type StatsFact, type StatsSide, sessionAwards } from "@shared/stats/rules";
import { awardValueText } from "./logic";

const side = (name: string, kind: "pc" | "monster"): StatsSide => ({
  id: name,
  name,
  kind,
  entityId: kind === "pc" ? `ch-${name}` : `def-${name}`,
  ownerCharacterId: null,
  hidden: false,
  ownerHidden: false,
  active: true,
});
const THORN = side("Thorn", "pc");
const ELITE = side("Elite Goblin Warrior 2", "monster");
const hit: StatsFact = {
  encounterId: "e1",
  n: 1,
  kind: "damage",
  raw: 30,
  applied: 13,
  overkill: 17,
  hpBefore: 13,
  hpAfter: 0,
  absorbed: 0,
  attacker: THORN,
  attackerName: "Thorn",
  target: ELITE,
  targetName: ELITE.name,
};
const overkillOf = (role: "dm" | "player") => {
  const out = sessionAwards({
    role,
    facts: [hit],
    rolls: [],
    characters: new Map([["ch-Thorn", { id: "ch-Thorn", name: "Thorn", playerId: "p2" }]]),
    fightLabel: () => "Fight 1",
  });
  return out.find((a) => a.key === "biggest-overkill");
};

describe("BL-103 FR-STATS-12 Biggest overkill per role", () => {
  test("FR-STATS-12 the DM's card reads the overkill amount (unchanged)", () => {
    const a = overkillOf("dm");
    expect(a?.value).toBe(17);
    expect(a && awardValueText(a, "dm")).toBe("17");
  });

  test("FR-STATS-12 FR-STATS-22 a player's card reads the callout line's damage, never an overkill amount", () => {
    const a = overkillOf("player");
    expect(a?.value).toBe(30);
    expect(a && awardValueText(a, "player")).toBe("30 damage");
    expect(JSON.stringify(a)).not.toContain("17");
    // Recap Awards use the same text (RecapWindow card, Copy as Markdown per role).
    expect(a && awardValueText({ ...a, key: "biggest-hit" }, "player")).toBe("30 damage");
  });
});
