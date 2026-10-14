// CBT feedback pass, client logic shared by both clients: token overlay (FR-CBT-38/39), turn-alert
// predicate (FR-CBT-41), player resolved-view text (FR-CBT-42).
import { describe, expect, test } from "bun:test";
import { resolutionText } from "@shared/combat-tracker/rules";
import { type CombatantView, DamageCardResolutionRead } from "@shared/combat-tracker/schemas";
import type { You } from "@shared/protocol/frames";
import { emptyStore, type RecordStore } from "@shared/protocol/store";
import type { TokenView } from "@shared/scenes-map/schemas";
import type { TokenOverlayView } from "../scenes-map/token-overlays";
import { cbtTokenOverlay, pcDown, useTargetingAttacker } from "./token-overlay";
import { turnAlertFor } from "./turn-alert";

const dmYou: You = { campaignId: "c", role: "dm", playerId: null };
const p1You: You = { campaignId: "c", role: "player", playerId: "p1" };
const p2You: You = { campaignId: "c", role: "player", playerId: "p2" };

/** DM-shaped rows; players get the redacted forms below. */
function store(you: You, o: { combatants?: object[]; entities?: object[]; status?: string } = {}) {
  const byId = (rows: object[]) =>
    Object.fromEntries(rows.map((r) => [(r as { id: string }).id, r]));
  const s: RecordStore = {
    ...emptyStore(),
    you,
    records: {
      encounter: {
        e1: { id: "e1", status: o.status ?? "started", round: 1, playerTurnCombatantId: null },
      },
      combatant: byId(o.combatants ?? []),
      entity: byId(o.entities ?? []),
    },
  };
  return s;
}

const goblin = {
  id: "k-gob",
  encounterId: "e1",
  kind: "monster",
  tokenId: "t-gob",
  name: "Goblin",
  active: true,
  removed: false,
  hpCurrent: 7,
  hpMax: 7,
  movedFt: 15,
};
const mira = {
  id: "k-mira",
  encounterId: "e1",
  kind: "pc",
  entityId: "mira",
  tokenId: "t-mira",
  name: "Mira",
  active: true,
  removed: false,
  movedFt: 0,
};
const token = (id: string) => ({ id }) as TokenView;
const dmView = (o: Partial<TokenOverlayView> = {}): TokenOverlayView => ({
  client: "dm",
  selected: false,
  targeting: false,
  ...o,
});
const playerView: TokenOverlayView = { client: "player", selected: false, targeting: false };
const decorate = (t: string, s: RecordStore, v: TokenOverlayView) =>
  cbtTokenOverlay.decorate?.(token(t), s, v) ?? null;

describe("FR-CBT-38 FR-CBT-39 token overlay cbt", () => {
  test("FR-CBT-38 Out: removed → dim + Out badge; nothing for an unbound token or after End", () => {
    const s = store(dmYou, { combatants: [{ ...goblin, removed: true }] });
    expect(decorate("t-gob", s, dmView())).toEqual({
      dim: true,
      badges: [expect.objectContaining({ id: "cbt-token-out", label: "Out" })],
    });
    expect(decorate("t-other", s, dmView())).toBeNull();
    const ended = store(dmYou, { combatants: [{ ...goblin, removed: true }], status: "ended" });
    expect(decorate("t-gob", ended, dmView())).toBeNull();
    const inactive = store(dmYou, { combatants: [{ ...goblin, active: false, hpCurrent: 0 }] });
    expect(decorate("t-gob", inactive, dmView())).toBeNull();
  });

  test("FR-CBT-48 Down → cross: monster HP 0 (DM) / band down (player); healthy → nothing", () => {
    const dm = store(dmYou, { combatants: [{ ...goblin, hpCurrent: 0 }] });
    expect(decorate("t-gob", dm, dmView())).toEqual({
      cross: { id: "cbt-token-down", tone: "down" },
    });
    const { hpCurrent: _c, hpMax: _m, ...redacted } = goblin;
    const pl = store(p1You, { combatants: [{ ...redacted, band: "down" }] });
    expect(decorate("t-gob", pl, playerView)?.cross?.id).toBe("cbt-token-down");
    expect(decorate("t-gob", pl, playerView)?.badges).toBeUndefined();
    const ok = store(p1You, { combatants: [{ ...redacted, band: "bloodied" }] });
    expect(decorate("t-gob", ok, playerView)).toBeNull();
  });

  test("FR-CBT-48 PC Down cross for DM / owner (character HP) and other players (redacted down)", () => {
    const full = { id: "mira", kind: "character", ownerPlayerId: "p1", hpCurrent: 0 };
    for (const you of [dmYou, p1You]) {
      const s = store(you, { combatants: [mira], entities: [full] });
      expect(decorate("t-mira", s, dmView())?.cross?.id).toBe("cbt-token-down");
    }
    const other = { id: "mira", kind: "character", ownerPlayerId: "p1", down: true };
    const s2 = store(p2You, { combatants: [mira], entities: [other] });
    expect(decorate("t-mira", s2, playerView)?.cross?.id).toBe("cbt-token-down");
    const up = store(p2You, { combatants: [mira], entities: [{ ...other, down: false }] });
    expect(decorate("t-mira", up, playerView)).toBeNull();
  });

  test("FR-CBT-49 PC Down Badge: DM / owner by HP, other players by redacted down; never a monster", () => {
    const full = { id: "mira", kind: "character", ownerPlayerId: "p1", hpCurrent: 0 };
    for (const you of [dmYou, p1You]) {
      expect(pcDown(store(you, { entities: [full] }), mira as CombatantView)).toBe(true);
      const up = store(you, { entities: [{ ...full, hpCurrent: 4 }] });
      expect(pcDown(up, mira as CombatantView)).toBe(false);
    }
    const other = { id: "mira", kind: "character", ownerPlayerId: "p1", down: true };
    expect(pcDown(store(p2You, { entities: [other] }), mira as CombatantView)).toBe(true);
    expect(
      pcDown(store(p2You, { entities: [{ ...other, down: false }] }), mira as CombatantView),
    ).toBe(false);
    expect(pcDown(store(dmYou), { ...goblin, hpCurrent: 0 } as CombatantView)).toBe(false);
  });

  test("FR-CBT-48 removed and down → dim + Out badge + cross", () => {
    const s = store(dmYou, { combatants: [{ ...goblin, removed: true, hpCurrent: 0 }] });
    expect(decorate("t-gob", s, dmView())).toEqual({
      dim: true,
      badges: [expect.objectContaining({ id: "cbt-token-out", label: "Out" })],
      cross: { id: "cbt-token-down", tone: "down" },
    });
  });

  test("FR-CBT-38 target ring only while targeting a selected eligible token; never the attacker", () => {
    const s = store(dmYou, { combatants: [goblin, mira] });
    expect(decorate("t-gob", s, dmView({ selected: true }))).toBeNull();
    expect(decorate("t-gob", s, dmView({ targeting: true }))).toBeNull();
    expect(decorate("t-gob", s, dmView({ selected: true, targeting: true }))).toEqual({
      ring: "target",
    });
    useTargetingAttacker.setState({ attackerId: "k-gob" });
    expect(decorate("t-gob", s, dmView({ selected: true, targeting: true }))).toBeNull();
    useTargetingAttacker.setState({ attackerId: null });
    // Removed: Out, no ring.
    const out = store(dmYou, { combatants: [{ ...goblin, removed: true }] });
    expect(decorate("t-gob", out, dmView({ selected: true, targeting: true }))?.ring).toBe(
      undefined,
    );
  });

  test("FR-CBT-39 movedFt(token) = the bound combatant's movedFt; none → null", () => {
    const s = store(p1You, { combatants: [goblin, mira] });
    expect(cbtTokenOverlay.movedFt?.(token("t-gob"), s)).toBe(15);
    expect(cbtTokenOverlay.movedFt?.(token("t-mira"), s)).toBe(0);
    expect(cbtTokenOverlay.movedFt?.(token("t-x"), s)).toBeNull();
    expect(cbtTokenOverlay.movedFt?.(token("t-gob"), store(p1You, { status: "ended" }))).toBeNull();
  });
});

describe("FR-CBT-41 turn alert predicate", () => {
  const owned = { id: "mira", kind: "character", ownerPlayerId: "p1" };
  const frame = (name: string, turn: string | null) => ({
    cause: { name },
    changes: [
      {
        type: "encounter",
        id: "e1",
        op: "upsert" as const,
        data: { id: "e1", status: "started", round: 1, playerTurnCombatantId: turn },
      },
    ],
  });

  test("FR-CBT-41 TurnChanged naming the own PC → alert; other PC, null, other cause → none", () => {
    const s1 = store(p1You, { combatants: [goblin, mira], entities: [owned] });
    expect(turnAlertFor(frame("TurnChanged", "k-mira"), s1)).toEqual({
      id: "cbt.turn",
      title: "Your turn",
      detail: "Mira",
      sound: "ping",
    });
    const s2 = store(p2You, { combatants: [goblin, mira], entities: [owned] });
    expect(turnAlertFor(frame("TurnChanged", "k-mira"), s2)).toBeNull();
    expect(turnAlertFor(frame("TurnChanged", "k-gob"), s1)).toBeNull();
    expect(turnAlertFor(frame("TurnChanged", null), s1)).toBeNull();
    for (const cause of ["TokenRevealed", "CombatantRestored", "InitiativeSet"]) {
      expect(turnAlertFor(frame(cause, "k-mira"), s1)).toBeNull();
    }
    // The DM client never alerts.
    const dm = store(dmYou, { combatants: [goblin, mira], entities: [owned] });
    expect(turnAlertFor(frame("TurnChanged", "k-mira"), dm)).toBeNull();
    // A TurnChanged without an encounter upsert (nothing to say) → none.
    expect(turnAlertFor({ cause: { name: "TurnChanged" }, changes: [] }, s1)).toBeNull();
  });
});

describe("FR-CBT-42 player resolved view", () => {
  test("FR-CBT-42 one part per target, multipliers, null names; legacy single-target rows", () => {
    const parts = DamageCardResolutionRead.parse({
      targets: [
        { targetName: "Goblin", hit: true, multiplier: "normal", applied: 6 },
        { targetName: "Goblin 2", hit: true, multiplier: "half", applied: 3 },
        { targetName: "Wolf", hit: false, multiplier: "normal", applied: 0 },
        { targetName: null, hit: false, multiplier: "normal", applied: 0 },
        { targetName: null, hit: true, multiplier: "double", applied: 12 },
        { targetName: "Mira", hit: true, multiplier: "none", applied: 0 },
      ],
    }).targets;
    expect(resolutionText(parts)).toBe(
      "Hit Goblin: 6 · Hit Goblin 2: 3 (half) · Miss Wolf · Miss · Hit: 12 (double) · Hit Mira: 0 (none)",
    );
    const legacy = DamageCardResolutionRead.parse({
      targetName: "Goblin",
      hit: true,
      multiplier: "normal",
      applied: 6,
    }).targets;
    expect(resolutionText(legacy)).toBe("Hit Goblin: 6");
  });
});
