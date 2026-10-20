// Sprint 6 CP2 (CBT §13.3): the flows the companion turn UI sends, scanned per player: Start with
// pets (FR-CBT-109), turn-mode changes and back (FR-CBT-106 / -111, walkthrough S3), Goblin 2
// made Mira's then turned hostile (S5), and the snapshots a reconnect gets (S6). Each player's
// frames and snapshots carry another's companion only as the band view (FR-CBT-116, ADR-0056).
import { describe, expect, test } from "bun:test";
import { COMBATANT_TYPE } from "@shared/combat-tracker/schemas";
import type { Viewer } from "../../ws/records";
import { cpSetup } from "./cp-testing";

/** Fields only the owner (or the DM) may receive on a companion combatant. */
const OWNER_ONLY = ["card", "hpCurrent", "hpMax", "tempHp", "pet"];
const DM_ONLY = ["ownerHidden", "concentrationEffectId"];

describe("FR-CBT-109 / -111 leak scan per player (CP2 flows)", () => {
  test("FR-CBT-109 leak scan per player: Start with pets, a mode change and back, turn hostile; frames and reconnect snapshots", () => {
    const t = cpSetup({ start: false });
    const n = t.events.length;
    // S1: Start with both pets; initiatives; round 1.
    t.start();
    t.step("next");
    const ob = t.combatantNamed("Owlbear");
    const drake = t.combatantNamed("Drake");
    // S3: Owlbear → own initiative, then back after Mira; the pet's stored mode is unchanged.
    const petMode = () => (t.entityRow(t.owlbear) as { turnMode?: unknown }).turnMode;
    const stored = petMode();
    t.setCompanion({ combatantId: ob.id, owner: t.owner(t.miraId, "own") });
    expect(t.combatantRow(ob.id).turnMode).toBe("own");
    t.setCompanion({ combatantId: ob.id, owner: t.owner(t.miraId, "after-owner") });
    expect(t.combatantRow(ob.id).turnMode).toBe("after-owner");
    expect(petMode()).toBe(stored);
    // S5: Goblin 2 → Mira, then turn hostile: owner gone, an open enemy.
    const g2 = t.id("Goblin 2");
    t.setCompanion({ combatantId: g2, owner: t.owner(t.miraId) });
    t.setCompanion({ combatantId: g2, owner: null, side: "enemy" });
    expect(t.combatantRow(g2)).toMatchObject({
      ownerCharacterId: null,
      ownerPlayerId: null,
      card: null,
      side: "enemy",
      publicSide: "enemy",
    });

    /** Every combatant record a viewer got: from the frames since `n`, then its snapshot. */
    const records = (v: Viewer) => {
      const frames = t.events
        .slice(n)
        .flatMap((e) => t.wire(e.event.changes, v))
        .filter((w) => typeof w !== "string" && w.type === COMBATANT_TYPE && w.op === "upsert")
        .map((w) => (w as { data: Record<string, unknown> }).data);
      return [...frames, ...(t.snap(v, COMBATANT_TYPE) as Record<string, unknown>[])];
    };
    const cases = [
      { v: t.p1V, me: t.h.p1.id, own: ob.id, other: drake.id, leaks: ["2d4+2", '"Bite"'] },
      { v: t.p2V, me: t.h.p2.id, own: drake.id, other: ob.id, leaks: ["2d8+5", "1d10+5", "Claws"] },
    ];
    for (const { v, me, own, other, leaks } of cases) {
      const got = records(v);
      expect(got.length).toBeGreaterThan(0);
      for (const r of got) {
        for (const k of DM_ONLY)
          expect({ id: r.id, k, has: k in r }).toEqual({ id: r.id, k, has: false });
        // Another player's companion (and any non-companion monster): no owner-only field.
        if (r.kind === "monster" && r.ownerPlayerId !== me) {
          for (const k of OWNER_ONLY) {
            expect({ id: r.id, k, has: k in r }).toEqual({ id: r.id, k, has: false });
          }
        }
      }
      // The own companion: numbers and card; another's: owner ids, mode and band.
      const mine = got.filter((r) => r.id === own).at(-1);
      expect(mine).toMatchObject({ ownerPlayerId: me });
      expect(mine && "card" in mine && "hpCurrent" in mine).toBe(true);
      const theirs = got.filter((r) => r.id === other).at(-1);
      expect(theirs && "band" in theirs && "turnMode" in theirs).toBe(true);
      // Goblin 2 after turn hostile: a plain enemy, no owner fields, for both players.
      const g = got.filter((r) => r.id === g2).at(-1) as Record<string, unknown>;
      expect(g).toMatchObject({ side: "enemy" });
      expect("ownerPlayerId" in g || "card" in g).toBe(false);
      const text = t.framesSince(n, v) + JSON.stringify(t.h.snapshot(v));
      for (const leak of [...leaks, ...DM_ONLY]) {
        expect({ leak, found: text.includes(leak) }).toEqual({ leak, found: false });
      }
    }
  });
});
