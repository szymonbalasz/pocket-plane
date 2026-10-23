// Recap acks as the server sends them (shapes of `sp-s9`'s fixture session), for client tests.
import type { DmRecap, PlayerRecap } from "@shared/session-recap/schemas";
import { AWARD_KEYS, type Award } from "@shared/stats/schemas";

const awards = (): Award[] =>
  AWARD_KEYS.map((key) =>
    key === "biggest-hit"
      ? {
          key,
          value: 30,
          winners: [{ characterId: "c-thorn", name: "Thorn", playerId: "p2" }],
          detail: { from: "Thorn", to: "Skeleton", raw: 30, fight: "Old Crypt" },
        }
      : { key, value: null, winners: [] },
  );

const loot = {
  rows: [
    {
      id: "l1",
      kind: "coins" as const,
      holder: { kind: "party" as const },
      text: "Bandit Camp strongbox",
      coins: { cp: 0, sp: 25, ep: 0, gp: 40, pp: 0 },
    },
    {
      id: "l2",
      kind: "item" as const,
      holder: { kind: "party" as const },
      text: "Bandit captain's map",
      coins: { cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 },
      qty: 1,
    },
    {
      id: "l3",
      kind: "coins" as const,
      holder: { kind: "character" as const, characterId: "c-thorn", name: "Thorn" },
      text: "Silver ring",
      coins: { cp: 0, sp: 0, ep: 0, gp: 15, pp: 0 },
    },
  ],
  totals: {
    coins: { cp: 0, sp: 25, ep: 0, gp: 55, pp: 0 },
    items: [{ name: "Bandit captain's map", qty: 1 }],
  },
};

const party = [
  {
    characterId: "c-thorn",
    name: "Thorn",
    playerId: "p2",
    dealt: 63,
    kills: 3,
    downed: 1,
    healed: 0,
    nat20: 3,
    nat1: 1,
    avg: 15.3,
  },
];

const header = {
  fromN: 1,
  toN: 46,
  from: "2026-10-23T19:02:00.000Z",
  to: "2026-10-23T23:41:00.000Z",
  label: "Fri 23 Oct",
};

export const DM_RECAP: DmRecap = {
  ...header,
  shared: {
    note: "Cleared the Bandit Camp; the map points north.",
    omit: ["rolls"],
    at: header.to,
  },
  fights: [
    {
      key: "e-camp",
      label: "Bandit Camp",
      status: "ended",
      rounds: 3,
      duration: 12 * 60_000,
      mvp: {
        value: 25,
        winners: [{ key: "c-mira", name: "Mira", playerId: "p1", hidden: false }],
      },
      kills: {
        events: [
          { fell: "kill", from: "Mira", to: "Bandit", callout: true, hidden: false, overkill: 14 },
          { fell: "kill", from: "Thorn", to: "Bandit Captain", callout: false, hidden: true },
        ],
      },
      downed: {
        events: [{ fell: "down", from: "Bandit 2", to: "Thorn", callout: false, hidden: false }],
      },
      standing: [{ key: "b3", name: "Bandit 3", hidden: false }],
    },
  ],
  party,
  loot,
  rolls: {
    rows: [
      { id: "g1", name: "Thorn", natural: 20, label: "Longsword", hidden: false },
      { id: "g2", name: "Thorn", natural: 20, label: "1d20+5", hidden: true },
    ],
  },
  awards: awards(),
};

export const PLAYER_RECAP: PlayerRecap = {
  ...header,
  shared: DM_RECAP.shared,
  fights: [
    {
      key: "e-camp",
      label: "Fight 2 · Fri 23 Oct",
      status: "ended",
      rounds: 3,
      duration: 12 * 60_000,
      mvp: { value: 25, winners: [{ key: "c-mira", name: "Mira", playerId: "p1" }] },
      kills: { events: [{ fell: "kill", from: "Mira", to: "Bandit", callout: true }] },
      downed: { events: [{ fell: "down", from: "Bandit 2", to: "Thorn", callout: false }] },
    },
  ],
  party,
  loot,
  awards: awards(),
};

export const EMPTY_PLAYER_RECAP: PlayerRecap = {
  ...header,
  shared: null,
  fights: [],
  party: [],
  loot: { rows: [], totals: { coins: { cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 }, items: [] } },
  rolls: { rows: [] },
  awards: AWARD_KEYS.map((key) => ({ key, value: null, winners: [] })),
};
