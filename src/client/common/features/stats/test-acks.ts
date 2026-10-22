// Test support (no React): Highlights acks as the server sends them per role (FR-STATS-31, -47),
// for the logic and render tests. Thorn (player-2) kills Goblin 1 with a callout; Brakka is down;
// the DM's also hold the hidden Elite's kill and Still standing.
import type { DmHighlights, PlayerHighlights } from "@shared/stats/schemas";

const none = { value: null, winners: [] };

export const EMPTY_PLAYER_HIGHLIGHTS: PlayerHighlights = {
  mvp: none,
  "biggest-hit": none,
  "biggest-overkill": none,
  "most-healing": none,
  kills: { events: [] },
  downed: { events: [] },
  nat20: none,
  nat1: none,
  rounds: 0,
  duration: 0,
};

export const EMPTY_DM_HIGHLIGHTS: DmHighlights = {
  mvp: none,
  "biggest-hit": none,
  "biggest-overkill": none,
  "most-healing": none,
  kills: { events: [] },
  downed: { events: [] },
  nat20: none,
  nat1: none,
  rounds: 0,
  duration: 0,
  standing: [],
};

const thorn = { key: "thorn", name: "Thorn", playerId: "p2" };

export const PLAYER_HIGHLIGHTS: PlayerHighlights = {
  ...EMPTY_PLAYER_HIGHLIGHTS,
  mvp: { value: 45, winners: [thorn] },
  "biggest-hit": {
    value: 30,
    winners: [thorn],
    detail: { from: "Thorn", to: "Goblin 1", raw: 30 },
  },
  "biggest-overkill": {
    value: 30,
    winners: [thorn],
    detail: { from: "Thorn", to: "Goblin 1", raw: 30 },
  },
  "most-healing": {
    value: 8,
    winners: [{ key: "mira", name: "Mira", playerId: "p1", with: ["Owlbear"] }],
  },
  kills: { events: [{ fell: "kill", from: "Thorn", to: "Goblin 1", callout: true }] },
  downed: { events: [{ fell: "down", from: "Goblin 2", to: "Brakka", callout: false }] },
  nat20: { value: 1, winners: [thorn] },
  rounds: 3,
  duration: 12 * 60_000,
};

const dmThorn = { ...thorn, hidden: false };

export const DM_HIGHLIGHTS: DmHighlights = {
  ...EMPTY_DM_HIGHLIGHTS,
  mvp: { value: 45, winners: [dmThorn] },
  "biggest-hit": {
    value: 30,
    winners: [dmThorn],
    detail: { from: "Thorn", to: "Goblin 1", raw: 30 },
  },
  "biggest-overkill": {
    value: 23,
    winners: [dmThorn],
    detail: { from: "Thorn", to: "Goblin 1", raw: 30 },
  },
  kills: {
    events: [
      { fell: "kill", from: "Thorn", to: "Goblin 1", callout: true, hidden: false, overkill: 23 },
      { fell: "kill", from: "Thorn", to: "Elite", callout: false, hidden: true },
    ],
  },
  downed: {
    events: [{ fell: "down", from: "Goblin 2", to: "Brakka", callout: false, hidden: false }],
  },
  rounds: 3,
  duration: 12 * 60_000,
  standing: [
    { key: "g2", name: "Goblin 2", hidden: false },
    { key: "wolf", name: "Wolf", hidden: true },
  ],
};
