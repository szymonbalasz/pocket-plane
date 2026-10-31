// Stats window logic (pure): which live frames re-query (FR-STATS-17, -41, -52), the live awards
// and fight-summary opens (FR-SHELL-94, FR-STATS-34), labels (FR-STATS-19), Highlights items
// (FR-STATS-31, -36). The kill feed (FR-STATS-26–29) is `feed.test.ts`.
import { describe, expect, test } from "bun:test";
import { ENCOUNTER_TYPE, LOG_KIND_ATTACK } from "@shared/combat-tracker/schemas";
import { GAME_LOG_ENTRY_TYPE } from "@shared/dice-roll-log/schemas";
import { NotificationCreated, NotificationUpdated } from "@shared/events/notifications";
import type { EventFrame } from "@shared/protocol/frames";
import type { Award } from "@shared/stats/schemas";
import {
  avgText,
  awardDetailText,
  awardsOpenOf,
  awardValueText,
  durationText,
  highlightDetailText,
  highlightItems,
  highlightsOpenByDefault,
  noDamageYet,
  refreshes,
  sessionLabel,
  summaryOpenOf,
  winnerText,
} from "./logic";
import {
  DM_HIGHLIGHTS,
  EMPTY_DM_HIGHLIGHTS,
  EMPTY_PLAYER_HIGHLIGHTS,
  PLAYER_HIGHLIGHTS,
} from "./test-acks";

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
  test("FR-DICE-102 a hide re-queries every tab, though a player's frame holds only a delete", () => {
    const hide = {
      cause: { name: "LogEntryHiddenSet" },
      changes: [{ type: GAME_LOG_ENTRY_TYPE, id: "e1", op: "delete" as const }],
    };
    for (const tab of ["campaign", "fight", "session", "luck"] as const) {
      expect(refreshes(hide, { tab, pickedFight: "enc-1" })).toBe(true);
    }
  });

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
    expect(awardsOpenOf(created)).toEqual({ ...payload, notificationId: "n1" });
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
    expect(awardValueText(a, "player")).toBe("30 damage");
    expect(awardDetailText(a)).toBe("Thorn → Goblin 1, 30, Goblin Ambush");
    expect(awardValueText({ key: "most-kills", value: null, winners: [] }, "dm")).toBe("—");
    expect(awardValueText({ key: "most-kills", value: 2, winners: [] }, "player")).toBe("2");
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

  test("FR-STATS-70 no 'No damage yet' beside a kill: zero rows + a kill, a down or a callout in Highlights → no copy; zero rows and no event → the copy", () => {
    const row = {
      key: "a",
      name: "A",
      kind: "pc" as const,
      dealt: 0,
      taken: 0,
      healed: 0,
      kills: 0,
    };
    // f09: only the DM's damage killed the monster, so the party's rows are 0.
    const kill = { fell: "kill" as const, from: null, to: "Goblin 1", callout: false };
    const killed = { ...EMPTY_PLAYER_HIGHLIGHTS, kills: { events: [kill] } };
    expect(noDamageYet([row], killed)).toBe(false);
    expect(noDamageYet([], killed)).toBe(false);
    const down = {
      ...EMPTY_PLAYER_HIGHLIGHTS,
      downed: { events: [{ ...kill, fell: "down" as const }] },
    };
    expect(noDamageYet([row], down)).toBe(false);
    const callout = {
      ...EMPTY_PLAYER_HIGHLIGHTS,
      "biggest-overkill": { value: 14, winners: [] },
    };
    expect(noDamageYet([row], callout)).toBe(false);
    expect(noDamageYet([row], EMPTY_PLAYER_HIGHLIGHTS)).toBe(true);
    expect(noDamageYet([row], EMPTY_DM_HIGHLIGHTS)).toBe(true);
    expect(noDamageYet([row], DM_HIGHLIGHTS)).toBe(false);
  });
});

describe("FR-STATS-41 FR-STATS-52 refresh (tier B)", () => {
  const enc = (id: string, op: "upsert" | "delete" = "upsert"): Frame => ({
    cause: { name: "EncounterStarted" },
    changes: [
      {
        type: ENCOUNTER_TYPE,
        id,
        op,
        ...(op === "upsert" ? { data: { id, status: "started", round: 1 } } : {}),
      },
    ],
  });

  test("FR-STATS-52 default fight: a Start (the encounter upsert players get before any public fact) re-queries the default Fight tab; a picked fight only on its own encounter", () => {
    expect(refreshes(enc("enc-9"), { tab: "fight", pickedFight: null })).toBe(true);
    expect(refreshes(enc("enc-9", "delete"), { tab: "fight", pickedFight: null })).toBe(true);
    expect(refreshes(enc("enc-9"), { tab: "fight", pickedFight: "enc-1" })).toBe(false);
    expect(refreshes(enc("enc-1"), { tab: "fight", pickedFight: "enc-1" })).toBe(true);
    expect(refreshes(enc("enc-9"), { tab: "session", pickedFight: null })).toBe(false);
  });

  test("FR-STATS-41 Luck refreshes on a live entry holding a roll only", () => {
    expect(refreshes(frame([entry({ rollIds: ["r1"] })]), { tab: "luck", pickedFight: null })).toBe(
      true,
    );
    expect(refreshes(frame([entry()]), { tab: "luck", pickedFight: null })).toBe(false);
    expect(refreshes(enc("enc-9"), { tab: "luck", pickedFight: null })).toBe(false);
  });

  test("FR-STATS-38 Avg shows 1 decimal, '—' with no d20", () => {
    expect(avgText(10.5)).toBe("10.5");
    expect(avgText(7)).toBe("7.0");
    expect(avgText(null)).toBe("—");
  });
});

describe("FR-STATS-34 fight summary open", () => {
  const note = (
    kind: string,
    payload: unknown,
    cause: string = NotificationCreated.type,
  ): Frame => ({
    cause: { name: cause },
    changes: [{ type: "notification", id: "n7", op: "upsert", data: { id: "n7", kind, payload } }],
  });

  test("FR-STATS-34 a live NotificationCreated frame with a stats-fight-summary row → its fight; an update, another kind or a bad payload → null", () => {
    expect(summaryOpenOf(note("stats-fight-summary", { encounterId: "enc-1" }))).toEqual({
      encounterId: "enc-1",
      notificationId: "n7",
    });
    expect(
      summaryOpenOf(
        note("stats-fight-summary", { encounterId: "enc-1" }, NotificationUpdated.type),
      ),
    ).toBeNull();
    expect(summaryOpenOf(note("stats-awards", { encounterId: "enc-1" }))).toBeNull();
    expect(summaryOpenOf(note("stats-fight-summary", {}))).toBeNull();
    expect(awardsOpenOf(note("stats-fight-summary", { encounterId: "enc-1" }))).toBeNull();
  });
});

describe("FR-STATS-31 FR-STATS-36 Highlights items", () => {
  test("FR-STATS-31 per role: the player's items in order, no Still standing; the DM's add Still standing; the ack's values as sent", () => {
    expect(highlightItems(PLAYER_HIGHLIGHTS).map((i) => i.key)).toEqual([
      "mvp",
      "biggest-hit",
      "biggest-overkill",
      "most-healing",
      "kills",
      "downed",
      "nat20",
      "rounds",
      "duration",
    ]);
    expect(highlightItems(DM_HIGHLIGHTS).map((i) => i.key)).toEqual([
      "mvp",
      "biggest-hit",
      "biggest-overkill",
      "kills",
      "downed",
      "rounds",
      "duration",
      "standing",
    ]);
    const values = Object.fromEntries(
      highlightItems(PLAYER_HIGHLIGHTS).map((i) => [i.key, i.kind === "stat" ? i.value : null]),
    );
    expect(values).toMatchObject({
      mvp: "45 damage",
      "biggest-hit": "30 damage",
      // Sprint 10 (BL-103): the player's is the callout line's damage, labelled so.
      "biggest-overkill": "30 damage",
      "most-healing": "8 HP",
      nat20: "1",
    });
    const overkill = highlightItems(DM_HIGHLIGHTS).find((i) => i.key === "biggest-overkill");
    expect(overkill?.kind === "stat" && overkill.value).toBe("23");
    expect(overkill?.kind === "stat" && highlightDetailText(overkill.stat)).toBe(
      "Thorn → Goblin 1, 30",
    );
  });

  test("FR-STATS-36 empty → hidden: an ack with nothing scored yields no item (the block is not drawn)", () => {
    expect(highlightItems(EMPTY_PLAYER_HIGHLIGHTS)).toEqual([]);
    expect(highlightItems(EMPTY_DM_HIGHLIGHTS)).toEqual([]);
  });

  test("FR-STATS-36 open on an ended fight, closed on a started one; Duration text", () => {
    expect(highlightsOpenByDefault("ended")).toBe(true);
    expect(highlightsOpenByDefault("started")).toBe(false);
    expect(durationText(20_000)).toBe("<1 min");
    expect(durationText(12 * 60_000)).toBe("12 min");
    expect(durationText(65 * 60_000)).toBe("1 h 5 min");
  });
});
