// Sprint 7 track ST1 (stats facts on combat lines): FR-CBT-136 From on direct Damage / heal,
// FR-CBT-137 the overkill callout on outcome lines. CBT's ambush (Mira, Thorn; Goblin, Goblin 2
// visible; Wolf, Elite hidden).
import { describe, expect, test } from "bun:test";
import { AttackLogPayload, HpLogPayload } from "@shared/combat-tracker/log-kinds";
import {
  CBT_INTENTS,
  DamageCardPayload,
  type HpChangesResult,
  partRollIdsOf,
} from "@shared/combat-tracker/schemas";
import { lineText } from "@shared/dice-roll-log/kind-types";
import { getLogKind } from "@shared/dice-roll-log/kinds";
import { GAME_LOG_ENTRY_TYPE, type GameLogEntryRecord } from "@shared/dice-roll-log/schemas";
import { eq } from "drizzle-orm";
import { gameLogEntry, hpChange, notification } from "../../db/schema";
import { statsSetup } from "../stats/testing";
import { startCommand } from "./lifecycle";

const entryOf = (t: ReturnType<typeof statsSetup>, id: string) =>
  t.s.db.select().from(gameLogEntry).where(eq(gameLogEntry.id, id)).get() as GameLogEntryRecord;
const rowOf = (t: ReturnType<typeof statsSetup>, id: string) =>
  t.s.db.select().from(hpChange).where(eq(hpChange.id, id)).get();
const text = (e: GameLogEntryRecord, dm: boolean) =>
  lineText(
    getLogKind(e.kind)?.formatLine({
      actorName: e.actorName,
      payload: e.payload,
      dmPayload: dm ? e.dmPayload : undefined,
      category: e.category,
    } as never) ?? [],
  );
/** Every `game-log-entry` change since event `n` as a viewer receives it, as JSON. */
const wireSince = (t: ReturnType<typeof statsSetup>, n: number, playerId: string) =>
  JSON.stringify(
    t.events
      .slice(n)
      .flatMap((e) =>
        e.event.changes
          .filter((c) => c.type === GAME_LOG_ENTRY_TYPE)
          .flatMap((c) => t.s.records.filterChange(c, t.h.viewer("player", playerId)) ?? []),
      ),
  );

describe("FR-CBT-136 heal from a source", () => {
  test("FR-CBT-136 heal from a source: sourceId → attackerId / name, the line; self-heal; bad sources", () => {
    const t = statsSetup();
    t.hp("Mira", "damage", 9);
    const id = t.hp("Mira", "heal", 8, { from: "Thorn" });
    const row = rowOf(t, id);
    expect(row).toMatchObject({ attackerId: t.id("Thorn"), attackerName: "Thorn", raw: 8 });
    const e = entryOf(t, row?.entryId as string);
    expect(e.actorName).toBe("Thorn");
    expect(HpLogPayload.parse(e.payload)).toMatchObject({ sourced: true, kind: "heal" });
    expect(text(e, false)).toBe("Thorn → Mira, heal 8");
    // Self-heal is allowed.
    const self = t.hp("Mira", "heal", 1, { from: "Mira" });
    expect(rowOf(t, self)?.attackerName).toBe("Mira");
    // No source → "DM" as before.
    const dm = rowOf(t, t.hp("Mira", "damage", 1));
    expect(dm?.attackerId).toBeNull();
    expect(text(entryOf(t, dm?.entryId as string), false)).toBe("DM — Mira takes 1 damage");
    // Unknown or removed source → not_found.
    const bad = (sourceId: string) =>
      t.err(() =>
        t.run(CBT_INTENTS.applyHp, {
          combatantId: t.id("Mira"),
          kind: "heal",
          amount: 1,
          sourceId,
        }),
      ).code;
    expect(bad("nope")).toBe("not_found");
    t.run(CBT_INTENTS.setRemoved, { combatantId: t.id("Thorn"), removed: true });
    expect(bad(t.id("Thorn"))).toBe("not_found");
  });

  test("FR-CBT-136 hidden source → the line is non-public; damage line reads 'Elite → Thorn, 4 damage'", () => {
    const t = statsSetup();
    const n = t.events.length;
    const id = t.hp("Thorn", "damage", 4, { from: "Elite Goblin Warrior", public: true });
    const e = entryOf(t, rowOf(t, id)?.entryId as string);
    expect(e.public).toBe(false);
    expect(text(e, true)).toBe("Elite Goblin Warrior → Thorn, 4 damage");
    expect(wireSince(t, n, t.h.p1.id)).toBe("[]");
  });

  test("FR-CBT-136 an ended encounter's combatant is not a source", () => {
    const t = statsSetup();
    const goblin = t.byName(t.enc.id).Goblin?.id as string;
    t.run(CBT_INTENTS.end, { encounterId: t.enc.id });
    const next = t.createAmbush();
    t.run(startCommand.name, { encounterId: next.id, sceneId: t.sceneId });
    const mira = t.byName(next.id).Mira?.id as string;
    const err = t.err(() =>
      t.run(CBT_INTENTS.applyHp, { combatantId: mira, kind: "heal", amount: 1, sourceId: goblin }),
    );
    expect(err.code).toBe("not_found");
  });
});

describe("FR-CBT-137 overkill callout", () => {
  test("FR-CBT-137 overkill callout on the line: at the threshold, one below, temp HP, players' frames", () => {
    const t = statsSetup();
    const n = t.events.length;
    // Goblin 7 HP: 17 = 7 + 10 → callout; Goblin 2: 16 → overkill 9, none.
    const at = entryOf(
      t,
      rowOf(t, t.hp("Goblin", "damage", 17, { from: "Thorn" }))?.entryId as string,
    );
    const below = entryOf(
      t,
      rowOf(t, t.hp("Goblin 2", "damage", 16, { from: "Thorn" }))?.entryId as string,
    );
    expect(at.payload).toMatchObject({ callout: "overkill" });
    expect(at.dmPayload).toMatchObject({ overkill: 10, hpBefore: 7 });
    expect((below.payload as { callout?: string }).callout).toBeUndefined();
    expect((below.dmPayload as { overkill?: number }).overkill).toBeUndefined();
    const wire = wireSince(t, n, t.h.p1.id);
    expect(wire).toContain('"callout":"overkill"');
    expect(wire).not.toContain('overkill":10');
    expect(wire).not.toContain("hpBefore");
    // PCs too (OQ-CBT-90 A): Mira 12 HP takes 30 → overkill 18 ≥ 12.
    const pc = entryOf(
      t,
      rowOf(t, t.hp("Mira", "damage", 30, { from: "Goblin" }))?.entryId as string,
    );
    expect(pc.payload).toMatchObject({ callout: "overkill" });
    // Hidden target → no player line (so no toast).
    const before = t.events.length;
    t.hp("Wolf", "damage", 40, { from: "Thorn" });
    expect(wireSince(t, before, t.h.p1.id)).toBe("[]");
  });

  test("FR-CBT-137 temp HP absorbed counts in 'needed'; undo marks the line undone", () => {
    const t = statsSetup();
    t.run("cbtx.setTempHp", { target: { combatantId: t.id("Goblin") }, value: 5 });
    // 7 HP + 5 temp = 12 needed, so the bar is 12: 23 → overkill 11 (none), 24 → 12 (callout).
    const none = rowOf(t, t.hp("Goblin", "damage", 23, { from: "Thorn" }));
    expect(entryOf(t, none?.entryId as string).payload).not.toHaveProperty("callout");
    t.undo(none?.id as string);
    const hit = rowOf(t, t.hp("Goblin", "damage", 24, { from: "Thorn" }));
    const e = entryOf(t, hit?.entryId as string);
    expect(e.payload).toMatchObject({ callout: "overkill" });
    expect(text(e, true)).toBe(
      "Thorn → Goblin, 24 damage (5 absorbed by temp HP) — Overkill! (+12 over 12 HP)",
    );
    t.undo(hit?.id as string);
    expect(entryOf(t, hit?.entryId as string).undone).toBe(true);
  });

  test("FR-CBT-137 on cbt.attack lines: a card apply stamps the callout; the amount stays DM-only", () => {
    const t = statsSetup();
    const { cardId } = t.run<{ cardId: string }>(
      CBT_INTENTS.attack,
      { attackerId: t.id("Thorn"), manual: [{ diceTotal: 18 }, { diceTotal: 4 }] },
      t.p2,
    );
    const card = t.s.db.select().from(notification).where(eq(notification.id, cardId)).get();
    const p = DamageCardPayload.parse(card?.payload);
    const n = t.events.length;
    const { hpChangeIds } = t.run<HpChangesResult>(CBT_INTENTS.applyCard, {
      cardId,
      toHitTotal: p.toHit?.total,
      damageTotal: 30,
      damageRollId: p.damage?.rollId,
      partRollIds: partRollIdsOf(p),
      targets: [{ targetId: t.id("Goblin"), hit: true, multiplier: "normal" }],
    });
    const e = entryOf(t, rowOf(t, hpChangeIds[0] as string)?.entryId as string);
    expect(AttackLogPayload.parse(e.payload).callout).toBe("overkill");
    expect(text(e, false)).toContain("30 piercing damage");
    expect(text(e, false)).toEndWith(" — Overkill!");
    expect(text(e, true)).toContain("— Overkill! (+23 over 7 HP)");
    const wire = wireSince(t, n, t.h.p2.id);
    expect(wire).toContain('"callout":"overkill"');
    expect(wire).not.toContain("over 7");
    expect(wire).not.toContain('"overkill":23');
  });

  test("FR-CBT-137 old line without the field parses", () => {
    expect(HpLogPayload.safeParse({ targetName: "Mira", kind: "damage", amount: 3 }).success).toBe(
      true,
    );
    expect(
      AttackLogPayload.safeParse({
        targetName: "Goblin",
        damageType: "slashing",
        toHit: null,
        hit: true,
        damage: 6,
        multiplier: "normal",
        crit: false,
      }).success,
    ).toBe(true);
  });
});
