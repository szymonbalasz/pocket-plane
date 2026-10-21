// Stats window logic (pure): which live frames re-query (FR-STATS-17), the overkill callout toast
// (FR-STATS-22, FR-NOTE-49), the live awards open (FR-SHELL-94), labels (FR-STATS-19).
import { describe, expect, test } from "bun:test";
import { LOG_KIND_ATTACK, LOG_KIND_HP } from "@shared/combat-tracker/schemas";
import { GAME_LOG_ENTRY_TYPE } from "@shared/dice-roll-log/schemas";
import { NotificationCreated, NotificationUpdated } from "@shared/events/notifications";
import type { EventFrame } from "@shared/protocol/frames";
import type { Award } from "@shared/stats/schemas";
import {
  awardDetailText,
  awardsOpenOf,
  awardValueText,
  noDamageYet,
  OVERKILL_TOAST_ID,
  overkillToast,
  refreshes,
  sessionLabel,
  winnerText,
} from "./logic";

type Frame = Pick<EventFrame, "cause" | "changes">;

const entry = (over: Record<string, unknown> = {}) => ({
  id: "e1",
  campaignId: "c1",
  n: 10,
  at: "2026-10-20T19:00:00.000Z",
  kind: LOG_KIND_ATTACK,
  category: "attack",
  public: true,
  undone: false,
  rollerRole: "dm",
  rollerPlayerId: null,
  actorName: "Thorn",
  payload: {
    targetName: "Goblin 1",
    attackName: "Longsword",
    damageType: "slashing",
    toHit: null,
    hit: true,
    damage: 30,
    multiplier: "normal",
    crit: false,
    callout: "overkill",
  },
  dmPayload: {
    targetAc: 15,
    hitComputed: null,
    toHitRolled: null,
    damageRolled: 30,
    damageTotal: 30,
    applied: 7,
    overkill: 23,
    overrides: { toHit: false, hit: false, damage: false },
  },
  rollIds: [],
  encounterId: "enc-1",
  supersededBy: null,
  ...over,
});

const frame = (data: unknown[], cause = "AttackApplied"): Frame => ({
  cause: { name: cause },
  changes: data.map((d, i) => ({
    type: GAME_LOG_ENTRY_TYPE,
    id: `e${i}`,
    op: "upsert" as const,
    data: d,
  })),
});

describe("FR-STATS-17 refresh", () => {
  test("FR-STATS-17 refresh encounter filter: a picked fight re-queries on its own lines only; the default fight on any fight's line; the Session tab on any line", () => {
    const own = frame([entry()]);
    const other = frame([entry({ encounterId: "enc-2" })]);
    const outside = frame([entry({ encounterId: null })]);
    expect(refreshes(own, { tab: "fight", pickedFight: "enc-1" })).toBe(true);
    expect(refreshes(other, { tab: "fight", pickedFight: "enc-1" })).toBe(false);
    expect(refreshes(outside, { tab: "fight", pickedFight: "enc-1" })).toBe(false);
    expect(refreshes(other, { tab: "fight", pickedFight: null })).toBe(true);
    expect(refreshes(outside, { tab: "fight", pickedFight: null })).toBe(false);
    expect(refreshes(outside, { tab: "session", pickedFight: null })).toBe(true);
  });

  test("FR-STATS-17 refresh: only game-log-entry upserts count (a delete, other types, an empty frame → no)", () => {
    const del: Frame = {
      cause: { name: "X" },
      changes: [{ type: GAME_LOG_ENTRY_TYPE, id: "e1", op: "delete" }],
    };
    const tok: Frame = {
      cause: { name: "X" },
      changes: [{ type: "token", id: "t1", op: "upsert", data: { id: "t1" } }],
    };
    for (const f of [del, tok, { cause: { name: "X" }, changes: [] }]) {
      expect(refreshes(f, { tab: "session", pickedFight: null })).toBe(false);
      expect(refreshes(f, { tab: "fight", pickedFight: null })).toBe(false);
    }
  });
});

describe("FR-STATS-22 callout toast", () => {
  test("FR-STATS-22 toast live-only, not undone: players 'Overkill! Thorn → Goblin 1: 30 damage', the DM adds '(+23 over 7 HP)'", () => {
    expect(overkillToast(frame([entry()]), "player")).toEqual({
      entryId: "e1",
      text: "Overkill! Thorn → Goblin 1: 30 damage",
    });
    expect(overkillToast(frame([entry()]), "dm")?.text).toBe(
      "Overkill! Thorn → Goblin 1: 30 damage (+23 over 7 HP)",
    );
    // A player's line has no dmPayload: never the amount.
    const redacted = entry();
    delete (redacted as { dmPayload?: unknown }).dmPayload;
    expect(overkillToast(frame([redacted]), "player")?.text).not.toContain("over");
  });

  test("FR-STATS-22 no toast for an undone line, a line without callout, a cbt.hp line or another kind", () => {
    expect(overkillToast(frame([entry({ undone: true })]), "dm")).toBeNull();
    const plain = entry();
    delete (plain.payload as { callout?: unknown }).callout;
    expect(overkillToast(frame([plain]), "dm")).toBeNull();
    expect(
      overkillToast(
        frame([
          entry({
            kind: LOG_KIND_HP,
            payload: { targetName: "G", kind: "damage", amount: 30, callout: "overkill" },
          }),
        ]),
        "dm",
      ),
    ).toBeNull();
    expect(overkillToast(frame([entry({ kind: "roll", payload: [] })]), "dm")).toBeNull();
  });

  test("FR-STATS-22 one per frame: a multi-target apply toasts the first callout line only", () => {
    const two = frame([
      entry({ id: "a", payload: { ...entry().payload, targetName: "Goblin 1" } }),
      entry({ id: "b", payload: { ...entry().payload, targetName: "Goblin 2" } }),
    ]);
    expect(overkillToast(two, "player")).toEqual({
      entryId: "a",
      text: "Overkill! Thorn → Goblin 1: 30 damage",
    });
  });

  test("FR-NOTE-49 callout toast is not a notification: one fixed toast id (a new callout replaces it), built from the frame alone (no notification row)", () => {
    expect(OVERKILL_TOAST_ID).toBe("stats-overkill");
    // The same frame never yields a notification change to apply.
    expect(awardsOpenOf(frame([entry()]))).toBeNull();
  });
});

describe("FR-SHELL-94 awards open", () => {
  const note = (kind: string, payload: unknown) => ({
    type: "notification",
    id: "n1",
    op: "upsert" as const,
    data: { id: "n1", kind, payload },
  });
  const payload = {
    fromN: 1,
    toN: 40,
    from: "2026-10-20T19:02:00.000Z",
    to: "2026-10-20T23:41:00.000Z",
    label: "Tue 20 Oct",
  };

  test("FR-SHELL-94 a live NotificationCreated frame with a stats-awards row → its session; anything else → null", () => {
    const created: Frame = {
      cause: { name: NotificationCreated.type },
      changes: [note("stats-awards", payload)],
    };
    expect(awardsOpenOf(created)).toEqual(payload);
    // A later update of the same row (dismiss, read) opens nothing.
    expect(awardsOpenOf({ ...created, cause: { name: NotificationUpdated.type } })).toBeNull();
    expect(
      awardsOpenOf({
        cause: { name: NotificationCreated.type },
        changes: [note("loot-received", payload)],
      }),
    ).toBeNull();
    // A payload that doesn't parse opens nothing.
    expect(
      awardsOpenOf({
        cause: { name: NotificationCreated.type },
        changes: [note("stats-awards", { fromN: 0 })],
      }),
    ).toBeNull();
  });
});

describe("FR-STATS-19 labels", () => {
  test("FR-STATS-19 session picker label 'Tue 20 Oct · 19:02–23:41 · 3 fights' (local time); today's says Today; 1 fight", () => {
    const from = new Date(2026, 9, 20, 19, 2).toISOString();
    const to = new Date(2026, 9, 20, 23, 41).toISOString();
    const s = { fromN: 1, toN: 9, from, to, fights: 3 };
    expect(sessionLabel(s, new Date(2026, 9, 21, 12))).toBe("Tue 20 Oct · 19:02–23:41 · 3 fights");
    expect(sessionLabel({ ...s, fights: 1 }, new Date(2026, 9, 20, 23, 50))).toBe(
      "Today · 19:02–23:41 · 1 fight",
    );
  });

  test("FR-STATS-12 award texts: value with its unit, '—' for nobody, companion roll-up 'Mira + Owlbear', detail line", () => {
    const a: Award = {
      key: "biggest-hit",
      value: 30,
      winners: [{ characterId: "t", name: "Thorn", playerId: "p2" }],
      detail: { from: "Thorn", to: "Goblin 1", raw: 30, fight: "Goblin Ambush" },
    };
    expect(awardValueText(a)).toBe("30 damage");
    expect(awardDetailText(a)).toBe("Thorn → Goblin 1, 30, Goblin Ambush");
    expect(awardValueText({ key: "most-kills", value: null, winners: [] })).toBe("—");
    expect(awardValueText({ key: "most-kills", value: 2, winners: [] })).toBe("2");
    expect(winnerText({ characterId: "m", name: "Mira", playerId: "p1", with: ["Owlbear"] })).toBe(
      "Mira + Owlbear",
    );
  });

  test("FR-STATS-24 'No damage yet' = every row's numbers 0", () => {
    const row = {
      key: "a",
      name: "A",
      kind: "pc" as const,
      dealt: 0,
      taken: 0,
      healed: 0,
      kills: 0,
    };
    expect(noDamageYet([row])).toBe(true);
    expect(noDamageYet([row, { ...row, key: "b", taken: 1 }])).toBe(false);
  });
});
