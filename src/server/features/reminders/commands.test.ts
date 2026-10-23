// REM §13 integration (in-memory): `rem.save` / `rem.delete` rules, caps, player rights, the DM
// fields a player save keeps, links, the copies (owner, link) and removal with the source.
import { describe, expect, test } from "bun:test";
import { REMINDER_TYPE, type ReminderRecord } from "@shared/reminders/schemas";
import { eq } from "drizzle-orm";
import { reminder } from "../../db/schema";
import type { Actor } from "../../events/types";
import { codeOf, errorOf, type RsSeed, seedRs } from "../strongholds/testing";
import { getReminder } from "./rows";

const party = { kind: "party" as const };
const charT = (characterId: string) => ({ kind: "character" as const, characterId });

function save(t: RsSeed, input: Record<string, unknown>, actor: Actor = t.dm): string {
  return (t.run("rem.save", input, { actor }) as { reminderId: string }).reminderId;
}
const row = (t: RsSeed, id: string) => getReminder(t.s.db, t.campaignId, id) as ReminderRecord;
const loadIds = (t: RsSeed, v: ReturnType<RsSeed["viewer"]>) =>
  t
    .load(v, REMINDER_TYPE)
    .map((r) => (r as { id: string }).id)
    .sort();

describe("REM §13 commands", () => {
  test("FR-REM-07 save and no-op", () => {
    const t = seedRs();
    const n = t.events.length;
    const id = save(t, {
      target: party,
      text: "Fresh bread",
      rolls: [{ label: "Bread", expression: "1d4" }],
    });
    const created = row(t, id);
    expect(created).toMatchObject({ characterId: null, dmOnly: false, createdByPlayerId: null });
    expect(t.since(n).map((e) => [e.event.type, e.event.payload])).toEqual([
      ["ReminderSaved", { reminderId: id, created: true }],
    ]);
    // Same values (the kept roll by id) → ack, no write, no event.
    const m = t.events.length;
    const rolls = created.rolls.map((r) => ({ ...r }));
    save(t, { id, target: party, text: "Fresh bread", rolls });
    expect(t.since(m)).toEqual([]);
    expect(row(t, id).updatedAt).toBe(created.updatedAt);
    // An edit keeps the kept roll's id (FR-REM-04), a new roll gets a new one.
    save(t, {
      id,
      target: party,
      text: "Fresh bread!",
      rolls: [...rolls, { label: "More", expression: "1d6" }],
    });
    const edited = row(t, id);
    expect(edited.rolls[0]?.id).toBe(created.rolls[0]?.id as string);
    expect(edited.rolls[1]?.id).not.toBe(created.rolls[0]?.id as string);
    expect(t.since(m).map((e) => e.event.payload)).toEqual([{ reminderId: id, created: false }]);
    // Creation order under a clock that doesn't move: strictly increasing stamps.
    const second = save(t, { target: party, text: "Second" });
    expect(row(t, second).createdAt > created.createdAt).toBe(true);
    expect(codeOf(() => save(t, { id: "nope", target: party, text: "x" }))).toBe("not_found");
    expect(codeOf(() => save(t, { target: charT("nope"), text: "x" }))).toBe("not_found");
    // Another campaign's row → not_found.
    const dmSecond = t.dmSecond;
    expect(codeOf(() => save(t, { id, target: party, text: "x" }, dmSecond))).toBe("not_found");
  });

  test("FR-REM-03 caps: 30 per target, 200 per campaign; a player's message has no number", () => {
    const t = seedRs();
    for (let i = 0; i < 30; i++) save(t, { target: party, text: `r${i}` });
    expect(errorOf(() => save(t, { target: party, text: "x" }))).toEqual({
      code: "conflict",
      message: "Reminder limit reached (30)",
    });
    expect(errorOf(() => save(t, { target: party, text: "x" }, t.p1Actor))).toEqual({
      code: "conflict",
      message: "Reminder limit reached",
    });
    // Another target still has room; moving a row onto the full target is refused.
    const mira = save(t, { target: charT(t.miraId), text: "m" });
    expect(codeOf(() => save(t, { id: mira, target: party, text: "m" }))).toBe("conflict");
    // Campaign cap: fill to 200 (straight rows on unknown characters), then any target refuses.
    const base = row(t, mira);
    const have = t.s.db.select().from(reminder).all().length;
    for (let i = have; i < 200; i++)
      t.s.db
        .insert(reminder)
        .values({ ...base, id: `fill-${i}`, seq: 1000 + i, characterId: `npc-${i}` })
        .run();
    expect(errorOf(() => save(t, { target: charT(t.thornId), text: "x" }))).toEqual({
      code: "conflict",
      message: "Reminder limit reached (200)",
    });
    expect(
      errorOf(() => save(t, { target: charT(t.thornId), text: "x" }, t.p2Actor))?.message,
    ).toBe("Reminder limit reached");
  });

  test("FR-REM-08 player rights", () => {
    const t = seedRs();
    const dmParty = save(t, { target: party, text: "DM's" });
    // Create on the party and an own character; another's → forbidden.
    const p1Party = save(t, { target: party, text: "p1 party" }, t.p1Actor);
    const p1Mira = save(t, { target: charT(t.miraId), text: "p1 mira" }, t.p1Actor);
    expect(codeOf(() => save(t, { target: charT(t.thornId), text: "x" }, t.p1Actor))).toBe(
      "forbidden",
    );
    expect(row(t, p1Party).createdByPlayerId).toBe(t.p1.id);
    // DM fields → forbidden (any of the three keys, even false / null).
    for (const extra of [{ dmOnly: false }, { strongholdId: null }, { facilityId: null }])
      expect(codeOf(() => save(t, { target: party, text: "x", ...extra }, t.p1Actor))).toBe(
        "forbidden",
      );
    // Edit / delete only own-created rows; the DM's are read-only; player-2 may not edit p1's.
    expect(codeOf(() => save(t, { id: dmParty, target: party, text: "x" }, t.p1Actor))).toBe(
      "forbidden",
    );
    expect(codeOf(() => t.run("rem.delete", { id: dmParty }, { actor: t.p1Actor }))).toBe(
      "forbidden",
    );
    expect(codeOf(() => save(t, { id: p1Party, target: party, text: "x" }, t.p2Actor))).toBe(
      "forbidden",
    );
    // A row the player can't see → not_found (never reveals it exists).
    expect(codeOf(() => save(t, { id: p1Mira, target: party, text: "x" }, t.p2Actor))).toBe(
      "not_found",
    );
    expect(codeOf(() => t.run("rem.delete", { id: p1Mira }, { actor: t.p2Actor }))).toBe(
      "not_found",
    );
    // Moving an own row onto another player's character → forbidden.
    expect(
      codeOf(() => save(t, { id: p1Party, target: charT(t.thornId), text: "x" }, t.p1Actor)),
    ).toBe("forbidden");
    save(t, { id: p1Party, target: party, text: "p1 party 2" }, t.p1Actor);
    expect(row(t, p1Party).text).toBe("p1 party 2");
    // The creator loses edit rights when the PC changes owner.
    t.run("char.edit", { creatureId: t.miraId, set: { ownerPlayerId: t.p2.id } }, { actor: t.dm });
    expect(
      codeOf(() => save(t, { id: p1Mira, target: charT(t.miraId), text: "x" }, t.p1Actor)),
    ).toBe("not_found");
    expect(
      codeOf(() => save(t, { id: p1Mira, target: charT(t.miraId), text: "x" }, t.p2Actor)),
    ).toBe("forbidden");
    t.run("rem.delete", { id: p1Party }, { actor: t.p1Actor });
    expect(getReminder(t.s.db, t.campaignId, p1Party)).toBeNull();
    // The DM any.
    t.run("rem.delete", { id: p1Mira }, { actor: t.dm });
    expect(getReminder(t.s.db, t.campaignId, p1Mira)).toBeNull();
  });

  test("FR-REM-07 player save keeps DM fields", () => {
    const t = seedRs();
    const keep = t.hold("Greystone Keep", true);
    const own = save(t, { target: charT(t.thornId), text: "Owe Brenna 20 gp" }, t.p2Actor);
    // The DM links player-2's row to Greystone (and hides it from nobody).
    save(t, { id: own, target: charT(t.thornId), text: "Owe Brenna 20 gp", strongholdId: keep });
    save(t, { id: own, target: charT(t.thornId), text: "Owe Brenna 25 gp" }, t.p2Actor);
    expect(row(t, own)).toMatchObject({
      text: "Owe Brenna 25 gp",
      strongholdId: keep,
      dmOnly: false,
    });
    // The DM hides it: the row leaves player-2; a stale player save → not_found, flag kept.
    save(t, {
      id: own,
      target: charT(t.thornId),
      text: "Owe Brenna 25 gp",
      strongholdId: keep,
      dmOnly: true,
    });
    expect(loadIds(t, t.p2V)).toEqual([]);
    expect(codeOf(() => save(t, { id: own, target: charT(t.thornId), text: "y" }, t.p2Actor))).toBe(
      "not_found",
    );
    expect(row(t, own)).toMatchObject({
      dmOnly: true,
      strongholdId: keep,
      text: "Owe Brenna 25 gp",
    });
  });

  test("FR-REM-10 link only by the DM", () => {
    const t = seedRs();
    const keep = t.hold("Greystone Keep", true);
    const steam = t.facility(keep, { name: "Steam Rooms", state: "built" });
    const other = t.hold("Other Hall", true);
    const otherFacility = t.facility(other, { name: "Loft", state: "built" });
    const id = save(t, { target: party, text: "Steam", strongholdId: keep, facilityId: steam });
    expect(row(t, id)).toMatchObject({ strongholdId: keep, facilityId: steam, linkHidden: false });
    expect(codeOf(() => save(t, { target: party, text: "x", strongholdId: "nope" }))).toBe(
      "not_found",
    );
    expect(
      codeOf(() =>
        save(t, { target: party, text: "x", strongholdId: keep, facilityId: otherFacility }),
      ),
    ).toBe("not_found");
    expect(codeOf(() => save(t, { target: party, text: "x", facilityId: steam }))).toBe("invalid");
    expect(codeOf(() => save(t, { target: party, text: "x", strongholdId: keep }, t.p1Actor))).toBe(
      "forbidden",
    );
    // A DM full replacement without the link unlinks; the target and text never change by a link.
    save(t, { id, target: party, text: "Steam" });
    expect(row(t, id)).toMatchObject({ strongholdId: null, facilityId: null, text: "Steam" });
  });

  test("FR-REM-06 link copy", () => {
    const t = seedRs();
    const keep = t.hold("Greystone Keep", true);
    const vault = t.facility(keep, { name: "Vault", state: "built" });
    const id = save(t, {
      target: party,
      text: "Vault rumours",
      strongholdId: keep,
      facilityId: vault,
    });
    expect(loadIds(t, t.p1V)).toEqual([id]);
    // The facility goes DM-only → hidden with it, in the HOLD command's event.
    const n = t.events.length;
    t.run(
      "hold.saveFacility",
      { strongholdId: keep, facility: { id: vault, name: "Vault", state: "built", dmOnly: true } },
      { actor: t.dm },
    );
    expect(row(t, id).linkHidden).toBe(true);
    expect(loadIds(t, t.p1V)).toEqual([]);
    const ev = t.since(n)[0]?.event;
    expect(ev?.type).toBe("StrongholdUpdated");
    expect(ev?.changes.map((c) => c.type)).toEqual(["stronghold", REMINDER_TYPE]);
    t.run(
      "hold.saveFacility",
      { strongholdId: keep, facility: { id: vault, name: "Vault", state: "built" } },
      { actor: t.dm },
    );
    expect(row(t, id).linkHidden).toBe(false);
    // The stronghold hidden / shown flips every linked row.
    t.run("hold.update", { strongholdId: keep, dmOnly: true }, { actor: t.dm });
    expect(row(t, id).linkHidden).toBe(true);
    t.run("hold.update", { strongholdId: keep, dmOnly: false }, { actor: t.dm });
    expect(row(t, id).linkHidden).toBe(false);
  });

  test("FR-REM-11 removal with the source", () => {
    const t = seedRs();
    const keep = t.hold("Greystone Keep", true);
    const steam = t.facility(keep, { name: "Steam Rooms", state: "built" });
    const a = save(t, { target: party, text: "a", strongholdId: keep, facilityId: steam });
    const b = save(t, {
      target: charT(t.miraId),
      text: "b",
      strongholdId: keep,
      facilityId: steam,
    });
    const whole = save(t, { target: party, text: "whole", strongholdId: keep });
    const n = t.events.length;
    t.run("hold.removeFacility", { strongholdId: keep, facilityId: steam }, { actor: t.dm });
    const evs = t.since(n);
    expect(evs.map((e) => e.event.type)).toEqual(["FacilityRemoved"]);
    expect(evs[0]?.event.payload).toEqual({
      strongholdId: keep,
      facilityId: steam,
      reminderIds: [a, b],
    });
    expect([a, b].map((id) => getReminder(t.s.db, t.campaignId, id))).toEqual([null, null]);
    expect(row(t, whole).text).toBe("whole");
    t.run("hold.delete", { strongholdId: keep }, { actor: t.dm });
    expect(getReminder(t.s.db, t.campaignId, whole)).toBeNull();
  });

  test("FR-REM-05 owner copy follows the PC (in the entity update's transaction)", () => {
    const t = seedRs();
    const own = save(t, { target: charT(t.thornId), text: "REM-THORN-OWN" }, t.p2Actor);
    const n = t.events.length;
    t.run("char.edit", { creatureId: t.thornId, set: { ownerPlayerId: t.p1.id } }, { actor: t.dm });
    expect(row(t, own).ownerPlayerId).toBe(t.p1.id);
    const ev = t.since(n).find((e) => e.event.changes.some((c) => c.type === REMINDER_TYPE));
    const change = ev?.event.changes.find((c) => c.type === REMINDER_TYPE);
    expect(change).toBeDefined();
    if (!change) return;
    expect(t.s.records.filterChange(change, t.p2V)).toEqual({
      type: REMINDER_TYPE,
      id: own,
      op: "delete",
    });
    expect(t.s.records.filterChange(change, t.p1V)?.op).toBe("upsert");
    expect(loadIds(t, t.p1V)).toEqual([own]);
    expect(loadIds(t, t.p2V)).toEqual([]);
    // A DM-only row's owner change sends players nothing.
    const secret = save(t, { target: charT(t.thornId), text: "secret", dmOnly: true });
    t.run("char.edit", { creatureId: t.thornId, set: { ownerPlayerId: t.p2.id } }, { actor: t.dm });
    const last = t.events.at(-1)?.event.changes.find((c) => c.id === secret);
    expect(last && t.s.records.filterChange(last, t.p2V)).toBeNull();
    expect(t.s.db.select().from(reminder).where(eq(reminder.id, secret)).get()?.ownerPlayerId).toBe(
      t.p2.id,
    );
  });
});
