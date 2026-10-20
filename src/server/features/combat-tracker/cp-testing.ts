// Sprint 6 track CP test support (CP0 core, CBT §13.3): combat's battle scene (active) with Mira
// (player 1) and Thorn (player 2), an "Owlbear" pet of Mira (`after-owner`, 2 attack rows) and a
// "Drake" pet of Thorn (`in-owner-turn`), both with tokens; "Ambush at the Ford" started with
// both pets (FR-CBT-109) and initiatives Wolf 18, Mira 15, Goblin 12, Goblin 2 12, Thorn 10,
// Elite 8, then Next → round 1, the Wolf's turn. Wire filters, snapshots and leak helpers per
// viewer.
import { CBTX_INTENTS } from "@shared/combat-extras/intents";
import {
  COMBATANT_TYPE,
  type CombatantRecord,
  type EncounterRecord,
  type SetCompanionInput,
  type TurnMode,
} from "@shared/combat-tracker/schemas";
import { ENTITY_TYPE, type EntityRecord, type MonsterStatBlock } from "@shared/entities/schemas";
import { MAP_INTENTS } from "@shared/scenes-map/schemas";
import { asc, eq } from "drizzle-orm";
import { combatant, effect, entity, gameLogEntry, token } from "../../db/schema";
import type { Actor, RecordChange } from "../../events/types";
import type { Viewer } from "../../ws/records";
import { ORDER } from "../combat-extras/testing";
import { createEntity } from "../entities/commands";
import { CREATE_PET } from "../entities/pets";
import { getRow, toEntityRecord } from "../entities/rows";
import { placeToken } from "../scenes-map/commands";
import { toTokenRecord } from "../scenes-map/rows";
import { setCompanionCommand } from "./companions";
import { setInitiative } from "./initiative";
import { endCommand, startCommand } from "./lifecycle";
import { readEncounter, toCombatantRecord } from "./rows";
import { combatSetup } from "./testing";
import { nextTurn, prevTurn } from "./turns";

/** The pet's base: the SRD Owlbear's numbers (CBT §13.3), a custom without row ids. */
export const owlbearBlock = {
  size: "large",
  ac: 13,
  hpMax: 59,
  hpFormula: "7d10+21",
  initBonus: 1,
  speed: 40,
  attacks: [
    { name: "Beak", toHit: 7, damage: "1d10+5", damageType: "piercing" },
    { name: "Claws", toHit: 7, damage: "2d8+5", damageType: "slashing" },
  ],
  cr: "3",
  type: "monstrosity",
} satisfies MonsterStatBlock;

export function cpSetup(opts: { start?: boolean; round1?: boolean } = {}) {
  const t = combatSetup();
  t.run(MAP_INTENTS.activateScene, { sceneId: t.sceneId });
  const base = t.run<{ id: string }>(createEntity.name, {
    kind: "monster",
    name: "Owlbear Base",
    statBlock: owlbearBlock,
  }).id;
  const pet = (input: Record<string, unknown>, actor: Actor = t.h.dm) =>
    t.run<EntityRecord>(CREATE_PET, input, actor);
  const owlbear = pet({ baseDefinitionId: base, companionOf: t.miraId, name: "Owlbear" }).id;
  const drake = pet({
    baseDefinitionId: t.h.wolfId,
    companionOf: t.thornId,
    name: "Drake",
    turnMode: "in-owner-turn",
  }).id;
  const placePet = (definitionId: string, col: number, row: number) =>
    t.run<{ tokenId: string }>(placeToken.name, { sceneId: t.sceneId, definitionId, col, row })
      .tokenId;
  const petTokens = { owlbear: placePet(owlbear, 0, 7), drake: placePet(drake, 3, 9) };
  const enc: EncounterRecord = t.createAmbush();
  const id = (name: string) => {
    const c = t.byName(enc.id)[name];
    if (!c) throw new Error(`no combatant ${name}`);
    return c.id;
  };
  const encNow = () => readEncounter(t.s.db, enc.id);
  const step = (dir: "next" | "prev", actor: Actor = t.h.dm) => {
    const e = encNow();
    return t.run<{ notRestored: string[] }>(
      dir === "next" ? nextTurn.name : prevTurn.name,
      { encounterId: enc.id, expectedRound: e.round, expectedTurnId: e.turnCombatantId },
      actor,
    );
  };
  const start = (petIds: string[] = [owlbear, drake]) => {
    t.run(startCommand.name, { encounterId: enc.id, sceneId: t.sceneId, petIds });
    for (const [name, value] of Object.entries(ORDER)) {
      t.run(setInitiative.name, { combatantId: id(name), value });
    }
  };
  if (opts.start !== false) {
    start();
    if (opts.round1 !== false) step("next");
  }
  const p1 = t.player(t.h.p1);
  const p2 = t.player(t.h.p2);
  const dmV = t.h.viewer("dm");
  const p1V = t.h.viewer("player", t.h.p1.id);
  const p2V = t.h.viewer("player", t.h.p2.id);
  const turnName = () => {
    const e = encNow();
    return Object.values(t.byName(enc.id)).find((c) => c.id === e.turnCombatantId)?.name;
  };
  /** Steps Next until `name` has the turn in `round`. */
  const nextTo = (name: string, round: number) => {
    for (let i = 0; i < 200; i++) {
      if (encNow().round === round && turnName() === name) return;
      step("next");
    }
    throw new Error(`never reached ${name} in round ${round}`);
  };
  const combatantNamed = (name: string) => t.byName(enc.id)[name] as CombatantRecord;
  const combatantRow = (cid: string) =>
    toCombatantRecord(
      t.s.db.select().from(combatant).where(eq(combatant.id, cid)).get() as Parameters<
        typeof toCombatantRecord
      >[0],
    );
  const entityRow = (eid: string) =>
    toEntityRecord(getRow(t.s.db as never, eid) as NonNullable<ReturnType<typeof getRow>>);
  const tokenRow = (tid: string) =>
    toTokenRecord(t.s.db.select().from(token).where(eq(token.id, tid)).get() as never);
  const setCompanion = (input: SetCompanionInput, actor: Actor = t.h.dm) =>
    t.run(setCompanionCommand.name, input, actor);
  const owner = (characterId: string, turnMode?: TurnMode) => ({
    characterId,
    ...(turnMode ? { turnMode } : {}),
  });
  /** Rank order of the started encounter: names with a position, position order. */
  const ranked = () =>
    t
      .combatants(enc.id)
      .filter((c) => c.position !== null)
      .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
      .map((c) => c.name);
  const snap = (v: Viewer, type: string) => (t.h.snapshot(v)[type] ?? []) as unknown[];
  const wire = (changes: readonly RecordChange[], v: Viewer) =>
    changes.map((c) => t.s.records.filterChange(c, v)).filter((w) => w !== null);
  const lastEvent = () => t.events.at(-1)?.event;
  /** Every wire change since event `n` for viewer `v`, as JSON (leak scans). */
  const framesSince = (n: number, v: Viewer) =>
    JSON.stringify(t.events.slice(n).map((e) => wire(e.event.changes, v)));
  const playerCombatant = (v: Viewer, cid: string) =>
    (snap(v, COMBATANT_TYPE) as Record<string, unknown>[]).find((c) => c.id === cid);
  const playerEntity = (v: Viewer, eid: string) =>
    (snap(v, ENTITY_TYPE) as Record<string, unknown>[]).find((c) => c.id === eid);
  const logRows = () => t.s.db.select().from(gameLogEntry).orderBy(asc(gameLogEntry.n)).all();
  const addCombatants = (items: object[]) =>
    t.run<{ combatantIds: string[] }>(CBTX_INTENTS.addCombatants, { encounterId: enc.id, items });
  const endEncounter = () => t.run(endCommand.name, { encounterId: enc.id });
  const active = () =>
    t.s.db
      .select()
      .from(effect)
      .orderBy(asc(effect.seq))
      .all()
      .filter((e) => e.endedAt === null);
  const petsOf = () =>
    t.s.db
      .select()
      .from(entity)
      .all()
      .filter((e) => e.companionOf !== null);
  return {
    ...t,
    base,
    owlbear,
    drake,
    pet,
    petTokens,
    enc,
    id,
    encNow,
    step,
    start,
    p1,
    p2,
    dmV,
    p1V,
    p2V,
    turnName,
    nextTo,
    combatantNamed,
    combatantRow,
    entityRow,
    tokenRow,
    setCompanion,
    owner,
    ranked,
    snap,
    wire,
    lastEvent,
    framesSince,
    playerCombatant,
    playerEntity,
    logRows,
    addCombatants,
    endEncounter,
    petsOf,
    active,
  };
}

export type CpSetup = ReturnType<typeof cpSetup>;
