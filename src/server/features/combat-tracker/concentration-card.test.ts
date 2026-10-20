// Sprint 6 CP3 (CBT §13.3): FR-CBT-120 linked concentration ends → the DM's card
// `cbt-summon-concentration` (Dismiss / Turn hostile / Keep), resolving itself once its summons
// are gone; End dismisses it. Players get nothing of it.
import { describe, expect, test } from "bun:test";
import { COMBATANT_TYPE } from "@shared/combat-tracker/schemas";
import { SUMMON_CARD_KIND } from "@shared/combat-tracker/summon-card-kind";
import { CompanionDismissed } from "@shared/events/combat-tracker";
import { NOTIFICATION_TYPE } from "../notifications/helpers";
import { summonSetup } from "./summon-testing";

/** Thorn concentrates on Conjure Elemental with `count` linked Fire Elementals (`own`, init 9). */
function linkedSetup(count = 1) {
  const t = summonSetup();
  const conc = t.concentrate();
  const ids = t.summon({
    ownerCharacterId: t.thornId,
    turnMode: "own",
    linkConcentration: true,
    count,
  });
  return { ...t, conc, ids };
}

describe("FR-CBT-120 concentration lost card", () => {
  test("FR-CBT-120 concentration lost card: ending Thorn's concentration → one DM card naming the summons, links cleared, nothing for players", () => {
    const t = linkedSetup(2);
    expect(t.ids.map((id) => t.combatantRow(id).concentrationEffectId)).toEqual([t.conc, t.conc]);
    const n = t.events.length;
    t.endEffect(t.conc);
    const [card] = t.cards();
    expect(t.cards()).toHaveLength(1);
    expect(card).toMatchObject({
      kind: SUMMON_CARD_KIND,
      audience: "dm",
      state: "pending",
      actionRole: "dm",
      actionLabel: "Dismiss summons",
      text: "Thorn lost concentration (Conjure Elemental): Fire Elemental, Fire Elemental 2",
      payload: {
        encounterId: t.enc.id,
        ownerCharacterId: t.thornId,
        effectId: t.conc,
        combatantIds: t.ids,
      },
    });
    expect(t.ids.map((id) => t.combatantRow(id).concentrationEffectId)).toEqual([null, null]);
    // The card and the cleared links ride on the effect event; players: neither (the hub drops
    // the identical redacted upsert, FR-SYNC-17 / -19).
    const evs = t.events.slice(n).map((e) => e.event);
    const changes = evs.flatMap((e) => e.changes);
    expect(changes.filter((c) => c.type === NOTIFICATION_TYPE)).toHaveLength(1);
    expect(changes.filter((c) => c.type === COMBATANT_TYPE && t.ids.includes(c.id))).toHaveLength(
      2,
    );
    for (const v of [t.p1V, t.p2V]) {
      const wire = evs.flatMap((e) => t.wire(e.changes, v));
      expect(wire.filter((w) => w.type === COMBATANT_TYPE && t.ids.includes(w.id))).toEqual([]);
      expect(wire.filter((w) => w.type === NOTIFICATION_TYPE)).toEqual([]);
      expect(t.framesSince(n, v)).not.toContain(card?.id as string);
    }
    // DM snapshot: the card pending.
    expect(
      (t.snap(t.dmV, NOTIFICATION_TYPE) as { id: string }[]).some((x) => x.id === card?.id),
    ).toBe(true);
  });

  test("FR-CBT-120 card Dismiss action dismisses every linked summon in one transaction, outcome dismissed", () => {
    const t = linkedSetup(2);
    t.endEffect(t.conc);
    const card = t.cards()[0];
    const tokens = t.ids.map((id) => t.combatantRow(id).tokenId);
    const n = t.events.length;
    t.dismiss({ notificationId: card?.id as string });
    expect(t.ids.map((id) => t.combatantRow(id).active)).toEqual([false, false]);
    for (const tok of tokens) expect(() => t.tokenRow(tok as string)).toThrow();
    expect(t.events.slice(n).filter((e) => e.event.type === CompanionDismissed.type)).toHaveLength(
      2,
    );
    expect(t.cards()[0]).toMatchObject({ state: "resolved", resolution: { outcome: "dismissed" } });
    // A player can't send the card form; a second click → conflict (no longer pending).
    expect(t.err(() => t.dismiss({ notificationId: card?.id as string }, t.p2)).code).toBe(
      "forbidden",
    );
    expect(t.err(() => t.dismiss({ notificationId: card?.id as string })).code).toBe("conflict");
  });

  test("FR-CBT-120 Turn hostile from the card: enemy, owner cleared, player-2 loses the card fields; the card resolves hostile", () => {
    const t = linkedSetup(1);
    const fe = t.ids[0] as string;
    t.endEffect(t.conc);
    const n = t.events.length;
    t.setCompanion({ combatantId: fe, owner: null, side: "enemy" });
    expect(t.combatantRow(fe)).toMatchObject({
      side: "enemy",
      publicSide: "enemy",
      ownerCharacterId: null,
      card: null,
      turnMode: null,
    });
    // player-2 (the old owner): an upsert without `card` / HP numbers.
    const p2 = t.playerCombatant(t.p2V, fe) as Record<string, unknown>;
    expect(p2).toMatchObject({ side: "enemy" });
    expect(p2.card).toBeUndefined();
    expect(p2.hpCurrent).toBeUndefined();
    expect(t.framesSince(n, t.p2V)).not.toContain('"card"');
    expect(t.cards()[0]).toMatchObject({ state: "resolved", resolution: { outcome: "hostile" } });
  });

  test("FR-CBT-120 the notification's Dismiss keeps them; End dismisses a pending card", () => {
    const t = linkedSetup(1);
    const fe = t.ids[0] as string;
    t.endEffect(t.conc);
    t.run("note.dismiss", { id: t.cards()[0]?.id });
    expect(t.cards()[0]?.state).toBe("dismissed");
    expect(t.combatantRow(fe)).toMatchObject({ active: true, ownerCharacterId: t.thornId });
    // A second concentration + link, ended: a new card, then End closes it.
    const conc2 = t.concentrate(t.thornId, "Conjure Elemental");
    const [fe2] = t.summon({ ownerCharacterId: t.thornId, linkConcentration: true });
    t.endEffect(conc2);
    const second = t.cards()[1];
    expect(second?.state).toBe("pending");
    expect(second?.payload).toMatchObject({ combatantIds: [fe2 as string] });
    t.endEncounter();
    expect(t.cards()[1]?.state).toBe("dismissed");
  });

  test("FR-CBT-120 the owner dismisses the summon first → the card resolves itself (gone) in that transaction", () => {
    const t = linkedSetup(1);
    const fe = t.ids[0] as string;
    t.endEffect(t.conc);
    const n = t.events.length;
    t.dismiss({ combatantId: fe }, t.p2);
    const types = t.events.slice(n).map((e) => e.event.type);
    expect(types).toEqual([CompanionDismissed.type, "NotificationResolved"]);
    expect(t.cards()[0]).toMatchObject({ state: "resolved", resolution: { outcome: "gone" } });
    // The DM's action never meets `invalid`: the card is no longer pending.
    expect(t.err(() => t.dismiss({ notificationId: t.cards()[0]?.id as string })).code).toBe(
      "conflict",
    );
  });

  test("FR-CBT-120 a replaced concentration ends the link too; an unlinked summon makes no card", () => {
    const t = summonSetup();
    t.concentrate();
    t.summon({ ownerCharacterId: t.thornId });
    const conc = t.concentrate(t.thornId, "Bless");
    expect(t.cards()).toEqual([]);
    const [fe] = t.summon({ ownerCharacterId: t.thornId, linkConcentration: true });
    // A new concentration replaces Bless (FR-CBTX-09): the link ends → a card.
    t.concentrate(t.thornId, "Conjure Elemental");
    expect(t.cards()).toHaveLength(1);
    expect(t.cards()[0]?.payload).toMatchObject({ effectId: conc });
    expect(t.combatantRow(fe as string).concentrationEffectId).toBeNull();
  });
});
