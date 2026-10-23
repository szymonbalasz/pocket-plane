// REM §13 unit: zod bounds (FR-REM-02) and the pure visibility / redaction (FR-REM-13).
import { describe, expect, test } from "bun:test";
import {
  byCreated,
  type ReminderRecord,
  redactReminder,
  reminderVisibility,
  SaveReminderIntent,
} from "./schemas";

const party = { kind: "party" as const };
const ok = (v: unknown) => SaveReminderIntent.safeParse(v).success;

describe("REM §13 unit", () => {
  test("FR-REM-02 input bounds", () => {
    expect(ok({ target: party, text: "x".repeat(500) })).toBe(true);
    expect(ok({ target: party, text: "x".repeat(501) })).toBe(false);
    expect(ok({ target: party, text: "   " })).toBe(false);
    // Clean text: control characters removed, `\r\n` → `\n` kept, trimmed.
    const p = SaveReminderIntent.parse({
      target: party,
      text: " a\u0007b\r\nc ",
      source: " s\tx ",
    });
    expect([p.text, p.source]).toEqual(["ab\nc", "sx"]);
    expect(ok({ target: party, text: "t", source: "x".repeat(61) })).toBe(false);
    const roll = { label: "Charm", expression: "1D4 + 1", category: "saving-throw" };
    expect(SaveReminderIntent.parse({ target: party, text: "t", rolls: [roll] }).rolls[0]).toEqual({
      label: "Charm",
      expression: "1d4+1",
      category: "saving-throw",
    });
    expect(ok({ target: party, text: "t", rolls: Array(4).fill(roll) })).toBe(true);
    expect(ok({ target: party, text: "t", rolls: Array(5).fill(roll) })).toBe(false);
    expect(ok({ target: party, text: "t", rolls: [{ ...roll, expression: "2x6" }] })).toBe(false);
    expect(ok({ target: party, text: "t", rolls: [{ ...roll, label: "x".repeat(41) }] })).toBe(
      false,
    );
    // Category defaults to `other`.
    const d = SaveReminderIntent.parse({
      target: party,
      text: "t",
      rolls: [{ label: "L", expression: "1d6" }],
    });
    expect(d.rolls[0]?.category).toBe("other");
    // A party target with `characterId`, a facility without its stronghold, strict keys.
    expect(ok({ target: { kind: "party", characterId: "c1" }, text: "t" })).toBe(false);
    expect(ok({ target: party, text: "t", facilityId: "f1" })).toBe(false);
    expect(ok({ target: party, text: "t", strongholdId: "h1", facilityId: "f1" })).toBe(true);
    expect(ok({ target: party, text: "t", seq: 3 })).toBe(false);
    expect(
      ok({
        target: party,
        text: "t",
        rolls: [
          { ...roll, id: "a" },
          { ...roll, id: "a" },
        ],
      }),
    ).toBe(false);
  });

  const row = (over: Partial<ReminderRecord> = {}): ReminderRecord => ({
    id: "r1",
    campaignId: "c1",
    seq: 7,
    characterId: null,
    text: "t",
    source: "",
    rolls: [],
    strongholdId: null,
    facilityId: null,
    dmOnly: false,
    ownerPlayerId: null,
    linkHidden: false,
    createdByPlayerId: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-02T00:00:00.000Z",
    ...over,
  });
  const dm = { role: "dm" as const, playerId: null };
  const p1 = { role: "player" as const, playerId: "p1" };
  const p2 = { role: "player" as const, playerId: "p2" };

  test("FR-REM-13 visibility per player", () => {
    const mira = row({ characterId: "mira", ownerPlayerId: "p1" });
    const table: [ReminderRecord, ReturnType<typeof reminderVisibility>[]][] = [
      [row(), ["full", "redacted", "redacted"]],
      [mira, ["full", "redacted", "hidden"]],
      [row({ dmOnly: true }), ["full", "hidden", "hidden"]],
      [row({ linkHidden: true }), ["full", "hidden", "hidden"]],
      [row({ characterId: "npc", ownerPlayerId: null }), ["full", "hidden", "hidden"]],
    ];
    for (const [r, want] of table)
      expect([dm, p1, p2].map((v) => reminderVisibility(r, v))).toEqual(want);
    // Redaction drops the three DM keys, `seq` and `updatedAt`.
    const red = redactReminder(mira);
    for (const k of ["dmOnly", "linkHidden", "ownerPlayerId", "seq", "updatedAt"])
      expect(red).not.toHaveProperty(k);
    expect(red).toMatchObject({ id: "r1", characterId: "mira", createdAt: mira.createdAt });
  });

  test("FR-REM-13 players' order by createdAt", () => {
    const rows = [
      row({ id: "b", createdAt: "2026-01-01T00:00:00.001Z" }),
      row({ id: "c", createdAt: "2026-01-01T00:00:00.000Z" }),
      row({ id: "a", createdAt: "2026-01-01T00:00:00.001Z" }),
    ];
    expect([...rows].sort(byCreated).map((r) => r.id)).toEqual(["c", "a", "b"]);
  });
});
