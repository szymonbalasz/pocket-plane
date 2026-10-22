// Test support for stats: combat-tracker's ambush (Mira, Thorn; Goblin, Goblin 2 visible; Wolf,
// Elite hidden) started, with helpers to apply, roll and query as the DM or a player.
import {
  type DmFightResult,
  type DmLuckResult,
  type PlayerFightResult,
  type SessionResult,
  type SessionsResult,
  STATS_QUERY_INTENT,
  type StatsQueryInput,
  type TrophiesResult,
} from "@shared/stats/schemas";
import type { Actor } from "../../events/types";
import { applyHp, undoCommand } from "../combat-tracker/hp";
import { startCommand } from "../combat-tracker/lifecycle";
import { combatSetup } from "../combat-tracker/testing";
import { ROLL } from "../dice-roll-log/commands";
import { statsMemory } from "./index";

export function statsSetup() {
  const t = combatSetup();
  const enc = t.createAmbush();
  t.run(startCommand.name, { encounterId: enc.id, sceneId: t.sceneId });
  const id = (name: string) => t.byName(enc.id)[name]?.id as string;
  const clock = t.s.clock as typeof t.s.clock & { advance(ms: number): void };
  const hp = (
    target: string,
    kind: "damage" | "heal",
    amount: number,
    o: { from?: string; public?: boolean } = {},
  ) =>
    t.run<{ hpChangeId: string }>(applyHp.name, {
      combatantId: id(target),
      kind,
      amount,
      public: o.public ?? true,
      ...(o.from ? { sourceId: id(o.from) } : {}),
    }).hpChangeId;
  const undo = (hpChangeId: string) => t.run(undoCommand.name, { expectedHpChangeId: hpChangeId });
  /** A d20 roll with a known natural: as a player (their character) or the DM (`public`). */
  const roll = (
    who: "Mira" | "Thorn",
    natural: number,
    o: { actor?: Actor; public?: boolean; category?: string } = {},
  ) =>
    t.run<{ rollId: string; entryId: string }>(
      ROLL,
      {
        expression: "1d20+5",
        category: o.category ?? "attack",
        actor: { entityId: who === "Mira" ? t.miraId : t.thornId },
        manual: { diceTotal: natural },
        ...(o.public !== undefined ? { public: o.public } : {}),
      },
      o.actor ?? t.h.dm,
    );
  const query = <R>(input: StatsQueryInput, actor: Actor = t.h.dm) =>
    t.run<R>(STATS_QUERY_INTENT, input, actor);
  // Each query is its own second, so the per-actor rate (FR-STATS-16) never trips by accident.
  const fresh = <R>(input: StatsQueryInput, actor: Actor = t.h.dm) => {
    clock.advance(1000);
    return query<R>(input, actor);
  };
  const fight = (actor: Actor = t.h.dm, encounterId?: string) =>
    fresh<DmFightResult & PlayerFightResult>(
      { scope: "fight", ...(encounterId ? { encounterId } : {}) },
      actor,
    );
  const session = (actor: Actor = t.h.dm, n?: number) =>
    fresh<SessionResult>({ scope: "session", ...(n !== undefined ? { n } : {}) }, actor);
  const sessions = (actor: Actor = t.h.dm) => fresh<SessionsResult>({ scope: "sessions" }, actor);
  /** Sprint 8: luck of a session (`n` inside it; absent = the newest) or the campaign. */
  const luck = (actor: Actor = t.h.dm, o: { n?: number; campaign?: true } = {}) =>
    fresh<DmLuckResult>({ scope: "luck", ...o }, actor).luck;
  const trophies = (characterId: string, actor: Actor = t.h.dm) =>
    fresh<TrophiesResult>({ scope: "trophies", characterId }, actor).trophies;
  const memory = () => statsMemory(t.s);
  return {
    ...t,
    enc,
    id,
    clock,
    hp,
    undo,
    roll,
    query,
    fight,
    session,
    sessions,
    luck,
    trophies,
    memory,
  };
}

export type StatsSetup = ReturnType<typeof statsSetup>;

/** A fight row by name. */
export const rowOf = <R extends { name: string }>(rows: readonly R[], name: string) =>
  rows.find((r) => r.name === name);

/** An award by key. */
export const awardOf = <A extends { key: string }>(awards: readonly A[], key: string) =>
  awards.find((a) => a.key === key) as A;
