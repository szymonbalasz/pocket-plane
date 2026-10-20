// GEM GM1 client: the "Inspiration: reroll" entry action (FR-GEM-33) over a fake store: who sees
// it on which line; what it sends (FR-GEM-21: physical dice).
import { describe, expect, test } from "bun:test";
import { GEMS_FEATURE } from "@shared/campaign-management/features";
import {
  DAMAGE_CARD_KIND,
  type DamageCardPayload,
  HIT_RULING_TYPE,
} from "@shared/combat-tracker/schemas";
import {
  GAME_LOG_ENTRY_TYPE,
  type GameLogEntryView,
  type RollPayloadItem,
} from "@shared/dice-roll-log/schemas";
import { ENTITY_TYPE } from "@shared/entities/schemas";
import { CHARACTER_GEMS_TYPE } from "@shared/gems/schemas";
import type { NotificationRecord } from "@shared/notifications/schemas";
import { emptyStore, type RecordStore } from "@shared/protocol/store";
import { actionsFor, entryActions } from "../dice-roll-log/entry-actions";
import { gemRerollAction, rerollAvailable } from "./reroll-action";

const item = (p: Partial<RollPayloadItem> = {}): RollPayloadItem => ({
  rollId: "r1",
  expression: "1d20+3",
  mode: "normal",
  manual: false,
  dice: [{ faces: 20, value: 4, kept: true }],
  constant: 3,
  total: 7,
  natural: 4,
  label: "Perception",
  ...p,
});

const entry = (o: Partial<GameLogEntryView> = {}): GameLogEntryView => ({
  id: "e1",
  campaignId: "c1",
  n: 1,
  at: "2026-10-21T10:00:00.000Z",
  kind: "roll",
  category: "skill-check",
  public: true,
  undone: false,
  rollerRole: "player",
  rollerPlayerId: "p1",
  actorName: "Mira",
  payload: [item()],
  rollIds: ["r1"],
  encounterId: null,
  supersededBy: null,
  ...o,
});

const byId = <T extends { id: string }>(rows: T[]) =>
  Object.fromEntries(rows.map((r) => [r.id, r]));

const card = (o: Partial<NotificationRecord> = {}, p: Partial<DamageCardPayload> = {}) =>
  ({
    id: "card1",
    kind: DAMAGE_CARD_KIND,
    state: "pending",
    payload: {
      encounterId: "enc",
      attackerId: "cm",
      attackerName: "Mira",
      attackName: "Dagger",
      damageType: "piercing",
      mode: "normal",
      crit: false,
      toHit: { rollId: "r1", dice: [[4, true]], constant: 3, total: 7, manual: false, natural: 4 },
      damage: null,
      ...p,
    },
    ...o,
  }) as unknown as NotificationRecord;

function store(
  o: {
    role?: "dm" | "player";
    playerId?: string | null;
    inspiration?: number;
    features?: string[];
    cards?: NotificationRecord[];
    rulings?: object[];
  } = {},
): RecordStore {
  const role = o.role ?? "player";
  return {
    ...emptyStore(),
    you: { campaignId: "c1", role, playerId: role === "dm" ? null : (o.playerId ?? "p1") },
    records: {
      campaign: byId([{ id: "c1", name: "C", features: o.features ?? [GEMS_FEATURE] }]),
      [GAME_LOG_ENTRY_TYPE]: {},
      [ENTITY_TYPE]: byId([
        { id: "mira", kind: "character", name: "Mira", ownerPlayerId: "p1" },
        { id: "thorn", kind: "character", name: "Thorn", ownerPlayerId: "p2" },
      ]),
      [CHARACTER_GEMS_TYPE]: byId([
        { id: "mira", characterId: "mira", inspiration: o.inspiration ?? 1 },
      ]),
      notification: byId(o.cards ?? []),
      [HIT_RULING_TYPE]: byId((o.rulings ?? []) as { id: string }[]),
    },
  } as unknown as RecordStore;
}

const shows = (s: RecordStore, e: GameLogEntryView) =>
  actionsFor(entryActions, s, e).some((a) => a.id === gemRerollAction.id);

describe("FR-GEM-33 log action available", () => {
  test("FR-GEM-33 log action available: owner and DM while ≥ 1 held and gems on; never for another player, at 0, or while off", () => {
    expect(shows(store(), entry())).toBe(true);
    expect(shows(store({ role: "dm" }), entry())).toBe(true);
    expect(shows(store({ playerId: "p2" }), entry())).toBe(false);
    expect(shows(store({ inspiration: 0 }), entry())).toBe(false);
    expect(shows(store({ features: [] }), entry())).toBe(false);
    // Thorn's line: Thorn holds no gem row.
    expect(shows(store({ role: "dm" }), entry({ actorName: "Thorn" }))).toBe(false);
  });

  test("FR-GEM-33 log action available: not on initiative, death / concentration saves, no d20, superseded or undone lines", () => {
    const s = store();
    expect(rerollAvailable(s, entry({ category: "initiative" }), s.you as never)).toBe(false);
    expect(rerollAvailable(s, entry({ payload: [item({ note: "kept" })] }), s.you as never)).toBe(
      false,
    );
    expect(
      rerollAvailable(s, entry({ payload: [item({ expression: "2d6" })] }), s.you as never),
    ).toBe(false);
    expect(rerollAvailable(s, entry({ supersededBy: "e2" }), s.you as never)).toBe(false);
    expect(rerollAvailable(s, entry({ undone: true }), s.you as never)).toBe(false);
  });

  test("FR-GEM-33 log action available: a combat to-hit only while its card is pending and unruled", () => {
    const attack = entry({ category: "attack", encounterId: "enc" });
    expect(shows(store({ cards: [card()] }), attack)).toBe(true);
    expect(shows(store({ cards: [card({ state: "resolved" })] }), attack)).toBe(false);
    expect(shows(store({ cards: [] }), attack)).toBe(false);
    expect(
      shows(
        store({ role: "dm", cards: [card()], rulings: [{ id: "h1", cardId: "card1" }] }),
        attack,
      ),
    ).toBe(false);
  });

  test("FR-GEM-21 physical reroll: the action rolls the line's d20 in its mode and sends `manual` when typed", async () => {
    expect(gemRerollAction.roll?.(entry())).toEqual({
      expression: "1d20",
      mode: "normal",
      category: "skill-check",
      label: "Mira — Perception (reroll)",
    });
    const adv = entry({ payload: [item({ mode: "advantage", expression: "2d20kh1+3" })] });
    expect(gemRerollAction.roll?.(adv)?.mode).toBe("advantage");
    const sent: unknown[] = [];
    const send = (name: string, payload: unknown) => {
      sent.push([name, payload]);
      return Promise.resolve({});
    };
    await gemRerollAction.run(entry(), { store: store(), send });
    await gemRerollAction.run(entry(), {
      store: store({ role: "dm" }),
      send,
      manual: { diceTotal: 17 },
    });
    expect(sent).toEqual([
      ["gem.spend", { characterId: "mira", gem: "inspiration", entryId: "e1" }],
      [
        "gem.spend",
        { characterId: "mira", gem: "inspiration", entryId: "e1", manual: { diceTotal: 17 } },
      ],
    ]);
  });
});
