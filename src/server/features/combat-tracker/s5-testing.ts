// Sprint 5 track R test support (R0 core, R1 late damage): CBTX's started ambush with the
// battle scene active; Apply hit, damage rolls, cards, log lines, wire filters and a live DM store.
import { attackLogKind } from "@shared/combat-tracker/log-kinds";
import {
  type ApplyHitResult,
  type AttackResult,
  type CombatantRecord,
  DamageCardPayload,
  HIT_RULING_TYPE,
  type HitRulingRecord,
  type RollDamageResult,
} from "@shared/combat-tracker/schemas";
import { sideLogKind } from "@shared/combat-tracker/side-kind";
import { lineText } from "@shared/dice-roll-log/kind-types";
import type { GameLogEntryRecord } from "@shared/dice-roll-log/schemas";
import { MAP_INTENTS } from "@shared/scenes-map/schemas";
import { asc, eq } from "drizzle-orm";
import { gameLogEntry, hitRuling, notification, token } from "../../db/schema";
import type { Actor, RecordChange } from "../../events/types";
import type { Viewer } from "../../ws/records";
import { cbtxSetup } from "../combat-extras/testing";
import { toTokenRecord } from "../scenes-map/rows";
import { attackCommand } from "./attack";
import { rollDamageCommand } from "./damage";
import { applyHitCommand } from "./hit";
import { setSideCommand } from "./sides";

export type S5Setup = ReturnType<typeof s5Setup>;

/** CBTX's started ambush with the battle scene active, plus sprint-5 helpers (R0, R1). */
export function s5Setup(opts: { round1?: boolean } = {}) {
  const t = cbtxSetup(opts);
  // Players reach the battle scene's tokens (and move their own) only while it is active.
  t.run(MAP_INTENTS.activateScene, { sceneId: t.sceneId });
  const p1 = t.player(t.h.p1);
  const dmV = t.h.viewer("dm");
  const p1V = t.h.viewer("player", t.h.p1.id);
  const p2V = t.h.viewer("player", t.h.p2.id);
  const toHit = (attacker: string, d20: number, actor: Actor = p1) =>
    t.run<AttackResult>(
      attackCommand.name,
      { attackerId: t.id(attacker), rolls: "toHit", manual: [{ diceTotal: d20 }] },
      actor,
    );
  const damage = (attacker: string, dice: number, actor: Actor = p1) =>
    t.run<RollDamageResult>(
      rollDamageCommand.name,
      { attackerId: t.id(attacker), manual: { diceTotal: dice } },
      actor,
    );
  const target = (name: string, hit: boolean, multiplier = "normal") => ({
    targetId: t.id(name),
    hit,
    multiplier,
  });
  const applyHit = (cardId: string, toHitTotal: number, targets: object[], actor = t.h.dm) =>
    t.run<ApplyHitResult>(applyHitCommand.name, { cardId, toHitTotal, targets }, actor);
  const card = (cardId: string) => {
    const r = t.s.db.select().from(notification).where(eq(notification.id, cardId)).get();
    if (!r) throw new Error(`no card ${cardId}`);
    return { ...r, p: DamageCardPayload.parse(r.payload) };
  };
  const entries = () =>
    t.s.db
      .select()
      .from(gameLogEntry)
      .orderBy(asc(gameLogEntry.n))
      .all() as unknown as GameLogEntryRecord[];
  const line = (e: GameLogEntryRecord, dm: boolean) => {
    const kind = e.kind === "cbt.side" ? sideLogKind : attackLogKind;
    return lineText(
      kind.formatLine({
        actorName: e.actorName,
        payload: e.payload,
        ...(dm ? { dmPayload: e.dmPayload } : {}),
      } as Parameters<typeof kind.formatLine>[0]),
    );
  };
  const rulings = () => t.s.db.select().from(hitRuling).all();
  const snap = (v: Viewer, type: string) => (t.h.snapshot(v)[type] ?? []) as unknown[];
  const wire = (changes: readonly RecordChange[], v: Viewer) =>
    changes.map((c) => t.s.records.filterChange(c, v)).filter((w) => w !== null);
  /** A DM store kept from one snapshot by every event's DM wire changes (live = fresh). */
  const dmStore = () => {
    const store = new Map<string, unknown>(
      (snap(dmV, HIT_RULING_TYPE) as HitRulingRecord[]).map((r) => [r.id, r]),
    );
    let seen = t.events.length;
    return () => {
      for (const e of t.events.slice(seen)) {
        for (const w of wire(e.event.changes, dmV)) {
          if (w.type !== HIT_RULING_TYPE) continue;
          if (w.op === "delete") store.delete(w.id);
          else store.set(w.id, w.data);
        }
      }
      seen = t.events.length;
      return [...store.values()];
    };
  };
  const tokenRow = (id: string) =>
    toTokenRecord(t.s.db.select().from(token).where(eq(token.id, id)).get() as never);
  const move = (tokenId: string, col: number, row: number, actor: Actor = t.h.dm) =>
    t.run(MAP_INTENTS.moveToken, { tokenId, col, row }, actor);
  const combatant = (name: string) => t.byName(t.enc.id)[name] as CombatantRecord;
  const setSide = (name: string, side: string, secret?: boolean, actor = t.h.dm) =>
    t.run(
      setSideCommand.name,
      { combatantId: t.id(name), side, ...(secret === undefined ? {} : { secret }) },
      actor,
    );
  return {
    ...t,
    p1,
    dmV,
    p1V,
    p2V,
    toHit,
    damage,
    target,
    applyHit,
    card,
    entries,
    line,
    rulings,
    snap,
    wire,
    dmStore,
    tokenRow,
    move,
    combatant,
    setSide,
  };
}
