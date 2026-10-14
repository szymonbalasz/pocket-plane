// CBTX rule hooks in combat's commands, in-process: FR-CBTX-06 expiry on Next, FR-CBTX-07 Prev
// restores (taken slot → notRestored), FR-CBTX-12 End, FR-CBTX-13 hidden copies (Start, Add,
// reveal), FR-CBTX-25 dead PCs skip, FR-CBTX-01 a throwing hook rolls the command back.
import { describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { notification } from "../../db/schema";
import { combatRuleHooksOf } from "../combat-tracker/rule-hooks";
import { setDeathSaves } from "./play-state";
import { cbtxSetup } from "./testing";

function blessed() {
  const t = cbtxSetup();
  const conc = t.concentrate({ characterId: t.miraId }, "Bless", 10);
  const links = t.add({
    targets: [{ combatantId: t.id("Mira") }, { combatantId: t.id("Thorn") }],
    kind: "custom",
    label: "Bless",
    durationRounds: 10,
    sourceCombatantId: t.id("Mira"),
    linkConcentration: true,
  }).effectIds;
  return { ...t, conc, links };
}

describe("FR-CBTX-06 FR-CBTX-07 durations", () => {
  test("FR-CBTX-06 Next to Mira in round 11 ends Bless ×2 + concentration (expired), no notification; Prev restores; Next again", () => {
    const t = blessed();
    const all = [t.conc, ...t.links];
    t.nextTo("Wolf", 11);
    expect(all.map((x) => t.fx(x).endedAt)).toEqual([null, null, null]);
    const notes = t.s.db.select().from(notification).all().length;
    const n = t.events.length;
    t.step("next");
    expect(t.turnName()).toBe("Mira");
    expect(t.typesSince(n)).toEqual(["TurnChanged"]);
    const changed = t.events.at(-1)?.event.changes.filter((c) => c.type === "effect") ?? [];
    expect(changed.map((c) => (c.after as { endedReason: string }).endedReason)).toEqual([
      "expired",
      "expired",
      "expired",
    ]);
    expect(all.map((x) => t.fx(x).endedRound)).toEqual([11, 11, 11]);
    expect(t.s.db.select().from(notification).all().length).toBe(notes);
    // Prev restores exactly what that Next expired.
    expect(t.step("prev")).toEqual({ notRestored: [] });
    expect(all.map((x) => t.fx(x).endedAt)).toEqual([null, null, null]);
    t.step("next");
    expect(all.map((x) => t.fx(x).endedReason)).toEqual(["expired", "expired", "expired"]);
  });

  test("FR-CBTX-07 condition slot: Next expires Frightened, DM re-adds it, Prev → old row stays ended, notRestored", () => {
    const t = cbtxSetup();
    const [old] = t.add({
      targets: [{ combatantId: t.id("Goblin") }],
      kind: "condition",
      condition: "frightened",
      durationRounds: 1,
    }).effectIds as [string];
    expect(t.fx(old)).toMatchObject({ endsRound: 2, anchorCombatantId: t.id("Wolf") });
    t.nextTo("Wolf", 2);
    expect(t.fx(old).endedReason).toBe("expired");
    const [again] = t.add({
      targets: [{ combatantId: t.id("Goblin") }],
      kind: "condition",
      condition: "frightened",
    }).effectIds as [string];
    expect(t.step("prev")).toEqual({ notRestored: ["Frightened (Goblin)"] });
    expect([t.fx(old).endedReason, t.fx(again).endedAt]).toEqual(["expired", null]);
  });

  test("FR-CBTX-05 anchor removed: the first Next into a round past endsRound ends it", () => {
    const t = cbtxSetup();
    const [hex] = t.add({
      targets: [{ combatantId: t.id("Goblin") }],
      kind: "custom",
      label: "Hex",
      durationRounds: 1,
      sourceCombatantId: t.id("Elite Goblin Warrior"),
    }).effectIds as [string];
    t.run("cbt.setRemoved", { combatantId: t.id("Elite Goblin Warrior"), removed: true });
    t.nextTo("Thorn", 2);
    expect(t.fx(hex).endedAt).toBeNull();
    t.step("next"); // round 3, Wolf
    expect(t.fx(hex)).toMatchObject({ endedReason: "expired", endedRound: 3 });
  });
});

describe("FR-CBTX-12 End", () => {
  test("FR-CBTX-12 End ends monster + timed effects; PC no-duration stays with hidden reset (hidden PC, #141)", () => {
    const t = cbtxSetup();
    t.run("map.setTokenHidden", { tokenId: t.tokens.thorn, hidden: true });
    const [marked] = t.add({
      targets: [{ characterId: t.thornId }],
      kind: "custom",
      label: "Marked",
    }).effectIds as [string];
    const [timed] = t.add({
      targets: [{ characterId: t.thornId }],
      kind: "custom",
      label: "Bane",
      durationRounds: 5,
    }).effectIds as [string];
    const [prone] = t.add({
      targets: [{ combatantId: t.id("Goblin") }],
      kind: "condition",
      condition: "prone",
    }).effectIds as [string];
    expect(t.fx(marked).hidden).toBe(true);
    const n = t.events.length;
    t.endEncounter();
    expect(t.typesSince(n)[0]).toBe("EncounterEnded");
    expect([t.fx(timed).endedReason, t.fx(prone).endedReason]).toEqual([
      "encounter-ended",
      "encounter-ended",
    ]);
    expect(t.fx(marked)).toMatchObject({ endedAt: null, hidden: false });
  });

  test("FR-CBTX-12 pending concentration cards stay pending at End (no end rule)", () => {
    const t = cbtxSetup();
    t.concentrate({ characterId: t.miraId }, "Bless");
    t.attackApply("Goblin", ["Mira"], 3);
    t.endEncounter();
    expect(t.cards().map((c) => c.state)).toEqual(["pending"]);
  });
});

describe("FR-CBTX-13 hidden copies", () => {
  test("FR-CBTX-13 reveal Elite → its effects visible; hide again → hidden", () => {
    const t = cbtxSetup();
    const [poisoned] = t.add({
      targets: [{ combatantId: t.id("Elite Goblin Warrior") }],
      kind: "condition",
      condition: "poisoned",
    }).effectIds as [string];
    expect(t.fx(poisoned).hidden).toBe(true);
    const n = t.events.length;
    t.run("map.setTokenHidden", { tokenId: t.tokens.elite, hidden: false });
    expect(t.fx(poisoned).hidden).toBe(false);
    const ev = t.events[n]?.event;
    expect(ev?.changes.some((c) => c.type === "effect" && c.id === poisoned)).toBe(true);
    t.run("map.setTokenHidden", { tokenId: t.tokens.elite, hidden: true });
    expect(t.fx(poisoned).hidden).toBe(true);
  });

  test("FR-CBTX-13 Start copies a hidden PC token onto the character's effects", () => {
    const t = cbtxSetup();
    t.endEncounter();
    const [marked] = t.add({
      targets: [{ characterId: t.thornId }],
      kind: "custom",
      label: "Marked",
    }).effectIds as [string];
    t.run("map.setTokenHidden", { tokenId: t.tokens.thorn, hidden: true });
    expect(t.fx(marked).hidden).toBe(false);
    const enc2 = t.createAmbush();
    const n = t.events.length;
    t.run("cbt.start", { encounterId: enc2.id, sceneId: t.sceneId });
    expect(t.fx(marked).hidden).toBe(true);
    expect(t.events[n]?.event.changes.some((c) => c.id === marked)).toBe(true);
  });
});

describe("FR-CBTX-25 dead PCs skip turns", () => {
  test("FR-CBTX-25 dead Thorn is skipped; dying keeps the turn", () => {
    const t = cbtxSetup();
    t.hp("Thorn", "damage", 99);
    t.nextTo("Goblin 2", 1);
    t.step("next");
    expect(t.turnName()).toBe("Thorn"); // dying: keeps the turn
    t.step("prev");
    t.run(setDeathSaves.name, { characterId: t.thornId, successes: 0, failures: 3 });
    t.step("next");
    expect(t.turnName()).toBe("Elite Goblin Warrior");
  });
});

describe("FR-CBTX-01 rule hooks roll back", () => {
  test("FR-CBTX-01 a throwing turnChanged / started / ended hook → nothing written", () => {
    const t = cbtxSetup();
    const hooks = combatRuleHooksOf(t.s);
    hooks.register("test.boom", {
      turnChanged: () => {
        throw new Error("boom");
      },
      ended: () => {
        throw new Error("boom");
      },
    });
    try {
      const before = t.encNow();
      const n = t.events.length;
      expect(t.err(() => t.step("next")).code).toBe("internal");
      expect(t.err(() => t.endEncounter()).code).toBe("internal");
      expect(t.encNow()).toEqual(before);
      expect(t.events.length).toBe(n);
    } finally {
      hooks.unregister("test.boom");
    }
    expect(
      t.s.db.select().from(notification).where(eq(notification.kind, "cbtx-concentration")).all(),
    ).toEqual([]);
  });
});
