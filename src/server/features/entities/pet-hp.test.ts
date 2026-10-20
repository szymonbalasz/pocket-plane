// Sprint 6 CP1 (FR-ENT-36): `pet.adjustHp` in-process: owner and DM out of a fight, clamp, no
// event when unchanged, guards, the `entity` upsert per viewer (FR-ENT-37) and the event log.
import { describe, expect, test } from "bun:test";
import { PET_ADJUST_HP, PET_HP_IN_FIGHT } from "@shared/entities/pet-hp";
import { ENTITY_TYPE, RedactedPet } from "@shared/entities/schemas";
import { PetHpAdjusted } from "@shared/events/entities";
import { eq } from "drizzle-orm";
import { eventLog } from "../../db/schema";
import { cpSetup } from "../combat-tracker/cp-testing";

const setup = () => {
  const t = cpSetup({ start: false });
  const adjust = (delta: number, actor = t.p1, petId = t.owlbear) =>
    t.run<{ before: number; after: number }>(PET_ADJUST_HP, { petId, delta }, actor);
  return { ...t, adjust };
};

describe("FR-ENT-36 pet HP outside a fight", () => {
  test("FR-ENT-36 pet HP: owner −14 → 45; one PetHpAdjusted; the DM heals; clamps; unchanged → no event", () => {
    const t = setup();
    const n = t.events.length;
    expect(t.adjust(-14)).toEqual({ before: 59, after: 45 });
    expect(t.entityRow(t.owlbear)).toMatchObject({ hpCurrent: 45 });
    const evs = t.events.slice(n).map((e) => e.event);
    expect(evs.map((e) => e.type)).toEqual([PetHpAdjusted.type]);
    expect(evs[0]?.payload).toEqual({ petId: t.owlbear, before: 59, after: 45 });
    expect(evs[0]?.changes.map((c) => [c.type, c.id])).toEqual([[ENTITY_TYPE, t.owlbear]]);
    // Logged, not undoable.
    const logged = t.s.db
      .select()
      .from(eventLog)
      .where(eq(eventLog.type, PetHpAdjusted.type))
      .all();
    expect(logged).toHaveLength(1);
    // The DM heals past max → clamped to 59; down to 0; again → unchanged, no event.
    expect(t.adjust(30, t.h.dm)).toEqual({ before: 45, after: 59 });
    const m = t.events.length;
    expect(t.adjust(5)).toEqual({ before: 59, after: 59 });
    expect(t.events.length).toBe(m);
    expect(t.adjust(-999)).toEqual({ before: 59, after: 0 });
    expect(t.adjust(-1, t.h.dm)).toEqual({ before: 0, after: 0 });
    expect(t.events.length).toBe(m + 1);
  });

  test("FR-ENT-36 guards: another player → forbidden; not a pet / unknown → not_found; bad delta → invalid; in a fight → conflict", () => {
    const t = setup();
    expect(t.err(() => t.adjust(-1, t.p2)).code).toBe("forbidden");
    // Thorn's drake: player-1 doesn't own it.
    expect(t.err(() => t.adjust(-1, t.p1, t.drake)).code).toBe("forbidden");
    // A plain custom monster and an unknown id: not a pet.
    expect(t.err(() => t.adjust(-1, t.h.dm, t.base)).code).toBe("not_found");
    expect(t.err(() => t.adjust(-1, t.h.dm, "nope")).code).toBe("not_found");
    expect(t.err(() => t.adjust(-1, t.p1, t.base)).code).toBe("not_found");
    for (const delta of [0, 1000, -1000, 1.5]) {
      expect(t.err(() => t.adjust(delta)).code).toBe("invalid");
    }
    // Joins a fight: its HP lives on the combatant (FR-CBT-113).
    t.start([t.owlbear]);
    const e = t.err(() => t.adjust(-1));
    expect([e.code, e.message]).toEqual(["conflict", PET_HP_IN_FIGHT]);
    expect(t.err(() => t.adjust(5, t.h.dm)).code).toBe("conflict");
    // The drake isn't in the fight: still adjustable.
    expect(t.adjust(-3, t.p2, t.drake)).toEqual({ before: 11, after: 8 });
    // End writes the combatant's HP back; adjustable again.
    t.endEncounter();
    expect(t.adjust(-4).after).toBe(55);
  });

  test("FR-ENT-36 FR-ENT-37 per viewer: owner full row, other player the redacted row with its new band, DM full", () => {
    const t = setup();
    const n = t.events.length;
    t.adjust(-30); // 29 / 59: bloodied
    const changes = t.lastEvent()?.changes ?? [];
    const [own] = t.wire(changes, t.p1V);
    expect(own).toMatchObject({ op: "upsert", data: { id: t.owlbear, hpCurrent: 29 } });
    const [other] = t.wire(changes, t.p2V);
    expect(other).toMatchObject({ op: "upsert" });
    const rec = (other as { data: unknown }).data;
    expect(RedactedPet.parse(rec)).toMatchObject({ band: "bloodied", name: "Owlbear" });
    const [dm] = t.wire(changes, t.dmV);
    expect(dm).toMatchObject({ data: { hpCurrent: 29, petPresent: true } });
    // Leak scan of player-2's frames: no numbers, stats or mode.
    const frames = t.framesSince(n, t.p2V);
    for (const leak of ["hpCurrent", "statBlock", "turnMode", "derivedFromId", '"29"', ":29"]) {
      expect(frames).not.toContain(leak);
    }
    // A pet that isn't present: player-2 gets nothing for its HP change.
    t.run("map.setTokenHidden", { tokenId: t.petTokens.owlbear, hidden: true });
    const m = t.events.length;
    t.adjust(10);
    expect(t.framesSince(m, t.p2V)).not.toContain(t.owlbear);
    expect(t.framesSince(m, t.p1V)).toContain(t.owlbear);
  });
});
