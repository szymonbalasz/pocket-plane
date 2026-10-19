// Polish pass (sprint 1, #178), in-process: FR-CBT-57 card text; FR-CBT-59 / -61 End dismisses
// the encounter's pending cards in its transaction (crash before / after commit).
import { describe, expect, test } from "bun:test";
import {
  type AttackResult,
  DAMAGE_CARD_KIND,
  ENCOUNTER_TYPE,
  type EncounterRecord,
} from "@shared/combat-tracker/schemas";
import type { NotificationRecord } from "@shared/notifications/schemas";
import { asc, eq, sql } from "drizzle-orm";
import { armCrashHook } from "../../commands/crash";
import { encounter, notification } from "../../db/schema";
import { attackCommand } from "./attack";
import { applyCard } from "./hp";
import { endCommand, startCommand } from "./lifecycle";
import { combatSetup, damageRollIdOf } from "./testing";

function started() {
  const t = combatSetup();
  const enc = t.createAmbush();
  t.run(startCommand.name, { encounterId: enc.id, sceneId: t.sceneId });
  const id = (name: string) => t.byName(enc.id)[name]?.id as string;
  const card = (cardId: string) =>
    t.s.db.select().from(notification).where(eq(notification.id, cardId)).get() as
      | NotificationRecord
      | undefined;
  const attack = (name: string, toHit: number, damage: number, actor = t.h.dm) =>
    t.run<AttackResult>(
      attackCommand.name,
      { attackerId: id(name), manual: [{ diceTotal: toHit }, { diceTotal: damage }] },
      actor,
    );
  return { ...t, enc, id, card, attack };
}

describe("FR-CBT-57 card text", () => {
  test("FR-CBT-57 card text: d20 1 → '(natural 1)'; d20 20 → '(natural 20)' + '(critical)'; else unchanged", () => {
    const t = started();
    expect(t.card(t.attack("Mira", 1, 4, t.p1).cardId)?.text).toBe(
      "Mira: 5 to hit (natural 1), 6 piercing",
    );
    // Crit: damage dice doubled (2d6 for Shortsword 1d6+2), manual total checked against it.
    expect(t.card(t.attack("Mira", 20, 7, t.p1).cardId)?.text).toBe(
      "Mira: 24 to hit (natural 20), 9 piercing (critical)",
    );
    expect(t.card(t.attack("Mira", 9, 4, t.p1).cardId)?.text).toBe("Mira: 13 to hit, 6 piercing");
  });
});

describe("FR-CBT-59 FR-CBT-61 End dismisses pending cards", () => {
  /** Started ambush with the Elite's card + Mira's card pending, a kind without an end rule
   *  carrying the same `encounterId`, and a leftover card of another encounter. */
  function withCards() {
    const t = started();
    const elite = t.attack("Elite Goblin Warrior", 19, 5).cardId;
    const mira = t.attack("Mira", 9, 4, t.p1).cardId;
    const insertCopy = (from: string, patch: Partial<NotificationRecord>) => {
      const row = t.card(from) as NotificationRecord;
      const id = `copy-${patch.kind ?? "card"}-${row.id}`;
      t.s.db
        .insert(notification)
        .values({
          ...row,
          ...patch,
          id,
          seq: sql`(select coalesce(max(seq), 0) + 1 from notification)`,
        })
        .run();
      return id;
    };
    // `test` has no end rule (a `cbtx-concentration`-like card): never dismissed by End.
    const keep = insertCopy(elite, { kind: "test", payload: { encounterId: t.enc.id } });
    // A pre-polish leftover card of an encounter ended earlier: untouched.
    const old = insertCopy(elite, {
      payload: { ...(t.card(elite)?.payload as object), encounterId: "enc-ended-earlier" },
    });
    const state = (id: string) => t.card(id)?.state;
    const encStatus = () =>
      t.s.db.select().from(encounter).where(eq(encounter.id, t.enc.id)).get()?.status;
    return { ...t, elite, mira, keep, old, state, encStatus };
  }

  test("FR-CBT-59 End dismisses pending cards: opted-in kinds of this encounter only", () => {
    const t = withCards();
    t.run(endCommand.name, { encounterId: t.enc.id });
    expect([t.elite, t.mira, t.keep, t.old].map(t.state)).toEqual([
      "dismissed",
      "dismissed",
      "pending",
      "pending",
    ]);
    // Closed by the DM's End (FR-NOTE-07 fields).
    expect(t.card(t.mira)).toMatchObject({ closedByRole: "dm", closedByPlayerId: null });
    expect(t.card(t.mira)?.closedAt).toBeString();
    // Applying a card after End → conflict (FR-CBT-10).
    const e = t.err(() =>
      t.run(applyCard.name, {
        cardId: t.mira,
        toHitTotal: 13,
        damageTotal: 6,
        damageRollId: damageRollIdOf(t.card(t.mira)),
        targets: [{ targetId: t.id("Goblin"), hit: true, multiplier: "normal" }],
      }),
    );
    expect(e).toMatchObject({ code: "conflict", message: "Encounter has ended" });
  });

  test("FR-CBT-61 event order: EncounterEnded, then NotificationDismissed × 2 in seq order", () => {
    const t = withCards();
    const n = t.events.length;
    t.run(endCommand.name, { encounterId: t.enc.id });
    const evs = t.events.slice(n).map((e) => e.event);
    expect(
      evs.map((e) => [e.type, (e.payload as { notificationId?: string }).notificationId]),
    ).toEqual([
      ["EncounterEnded", undefined],
      ["NotificationDismissed", t.elite],
      ["NotificationDismissed", t.mira],
    ]);
    expect(evs[0]?.changes.some((c) => c.type === ENCOUNTER_TYPE)).toBe(true);
    expect(evs[2]?.changes[0]?.after).toMatchObject({
      kind: DAMAGE_CARD_KIND,
      state: "dismissed",
      audience: "player",
    });
    // Seq order = creation order.
    const seqs = t.s.db
      .select({ id: notification.id })
      .from(notification)
      .orderBy(asc(notification.seq))
      .all()
      .map((r) => r.id);
    expect(seqs.indexOf(t.elite)).toBeLessThan(seqs.indexOf(t.mira));
  });

  test("FR-CBT-59 crash: hard kill before commit → still started, cards pending; after commit → ended, dismissals intact", () => {
    class Killed extends Error {}
    const kill = () => {
      throw new Killed();
    };
    const t = withCards();
    try {
      armCrashHook({ point: "before-commit", target: endCommand.name }, kill);
      // Inside the transaction the kill surfaces as `internal`; nothing commits.
      expect(() => t.run(endCommand.name, { encounterId: t.enc.id })).toThrow();
      expect(t.encStatus()).toBe("started");
      expect([t.elite, t.mira].map(t.state)).toEqual(["pending", "pending"]);
      armCrashHook({ point: "after-commit", target: endCommand.name }, kill);
      const n = t.events.length;
      expect(() => t.run(endCommand.name, { encounterId: t.enc.id })).toThrow(Killed);
      // Committed: ended and dismissed together; no listener ran before the kill.
      expect(t.encStatus()).toBe("ended");
      expect([t.elite, t.mira, t.keep].map(t.state)).toEqual(["dismissed", "dismissed", "pending"]);
      expect(t.events.length).toBe(n);
    } finally {
      armCrashHook(null);
    }
  });

  test("FR-CBT-59 nothing pending → End emits EncounterEnded only", () => {
    const t = started();
    const n = t.events.length;
    t.run(endCommand.name, { encounterId: t.enc.id });
    expect(t.events.slice(n).map((e) => e.event.type)).toEqual(["EncounterEnded"]);
    const enc = t.s.db.select().from(encounter).get() as EncounterRecord | undefined;
    expect(enc?.status).toBe("ended");
  });
});
