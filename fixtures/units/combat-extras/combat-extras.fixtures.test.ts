import { afterAll, describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { closeDb } from "@server/db/client";
import { combatant, effect, encounter, entity, token } from "@server/db/schema";
import { asc } from "drizzle-orm";
import { loadBundle } from "../../index";

const dirs: string[] = [];
afterAll(() => {
  Bun.gc(true);
  for (const d of dirs) {
    try {
      rmSync(d, { recursive: true, force: true });
    } catch {
      // Windows: a closed SQLite handle can linger until GC; a leftover OS temp dir is harmless.
    }
  }
});

describe("combat-extras fixtures (CBTX §13)", () => {
  test("CBTX §13 combat-extras bundle loads from empty: effects, temp HP, reinforcement tokens", async () => {
    const r = await loadBundle("combat-extras");
    dirs.push(r.dir);
    expect(r.manifest.fixtures.slice(-4)).toEqual([
      "combat-1",
      "cbtx-effects",
      "cbtx-temp",
      "cbtx-reinforcement",
    ]);
    const db = r.openDb();
    const ks = db.select().from(combatant).all();
    const k = (id: string | null) => ks.find((c) => c.id === id)?.name;
    const chars = db.select().from(entity).all();
    const ch = (id: string | null) => chars.find((c) => c.id === id)?.name;
    const fx = db
      .select()
      .from(effect)
      .orderBy(asc(effect.seq))
      .all()
      .map((e) => ({
        kind: e.kind as string,
        name: e.label ?? e.condition,
        on: k(e.targetCombatantId) ?? ch(e.targetCharacterId),
        endsRound: e.endsRound,
        anchor: k(e.anchorCombatantId) ?? null,
        linked: e.concentrationId !== null,
        secret: e.secret,
        hidden: e.hidden,
        ended: e.endedAt !== null,
      }));
    expect(fx).toEqual([
      {
        kind: "concentration",
        name: "Bless",
        on: "Mira",
        endsRound: 11,
        anchor: "Mira",
        linked: false,
        secret: false,
        hidden: false,
        ended: false,
      },
      ...["Mira", "Thorn"].map((on) => ({
        kind: "custom",
        name: "Bless",
        on,
        endsRound: 11,
        anchor: "Mira",
        linked: true,
        secret: false,
        hidden: false,
        ended: false,
      })),
      { ...base("condition", "prone", "Goblin") },
      { ...base("condition", "poisoned", "Elite Goblin Warrior"), hidden: true },
      { ...base("custom", "Hex", "Goblin 2"), secret: true },
      { ...base("custom", "Marked", "Thorn") },
    ]);
    expect(chars.find((c) => c.name === "Thorn")?.tempHp).toBe(5);
    expect(ks.find((c) => c.name === "Goblin")?.tempHp).toBe(3);
    const enc = db.select().from(encounter).get();
    expect({ round: enc?.round, turn: k(enc?.turnCombatantId ?? null) }).toEqual({
      round: 1,
      turn: "Wolf",
    });
    const unbound = db
      .select()
      .from(token)
      .all()
      .filter((t) => !ks.some((c) => c.tokenId === t.id) && ["Goblin 3", "Wolf 2"].includes(t.name))
      .map((t) => [t.name, t.col, t.row, t.hidden]);
    expect(unbound).toEqual([
      ["Goblin 3", 14, 8, false],
      ["Wolf 2", 15, 3, true],
    ]);
    closeDb(db);
  }, 30_000);
});

function base(kind: string, name: string, on: string) {
  return {
    kind,
    name,
    on,
    endsRound: null,
    anchor: null,
    linked: false,
    secret: false,
    hidden: false,
    ended: false,
  };
}
