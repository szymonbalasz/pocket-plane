// `hpRules` (FR-CBTX-01/02, ADR-0035): the only path that changes a creature's HP, temp HP or
// death saves from damage / heal. Callers: `cbt.applyCard`, `cbt.applyHp`, `cbt.undo`
// (`revert`), `char.adjustHp`, `cbtx.rollDeathSave` (natural 20). In the caller's transaction:
//   1. `apply` writes HP (monsters on the combatant, PCs via `characters.adjustHp`), temp HP
//      (absorbs first, FR-CBTX-15), death counters (FR-CBTX-20), ends concentration at 0 HP
//      (FR-CBTX-16) and returns the rows + facts for the caller's event;
//   2. the caller emits its event;
//   3. `after` creates the concentration card (FR-CBTX-17) and closes the cards of an ended
//      concentration (FR-CBTX-10), so their events follow the owner's.
import { CONCENTRATION_ACTION } from "@shared/combat-extras/intents";
import {
  absorb,
  clampTemp,
  concentrationDc,
  deathAfterHp,
  deathRevert,
  sameCounters,
} from "@shared/combat-extras/rules";
import {
  CONCENTRATION_CARD_KIND,
  type DeathCounters,
  type EffectRecord,
} from "@shared/combat-extras/schemas";
import { clampHp } from "@shared/combat-tracker/rules";
import type { CombatantRecord, HpChangeRecord } from "@shared/combat-tracker/schemas";
import { and, eq, inArray } from "drizzle-orm";
import { combatant, entity, notification } from "../../db/schema";
import type { RecordChange } from "../../events/types";
import { adjustHp } from "../character-sheet/hp";
import { campaignOf, combatantChange, readCombatant } from "../combat-tracker/rows";
import { notify } from "../notifications";
import {
  closeCards,
  closeCardsOfEnded,
  type Ended,
  endEffects,
  endedByHpChange,
  restoreEffects,
} from "./effects";
import {
  activeConcentrationOf,
  characterChange,
  type Env,
  pcCombatant,
  readCharacter,
} from "./rows";

/** Whose HP: a monster's combatant, or a character (a PC combatant resolves to its character). */
export type HpTarget = { kind: "monster"; combatantId: string } | { kind: "character"; id: string };

export const hpTargetOf = (c: CombatantRecord): HpTarget =>
  c.kind === "pc" ? { kind: "character", id: c.entityId } : { kind: "monster", combatantId: c.id };

export interface ApplyInput {
  kind: "damage" | "heal";
  /** Damage dealt (before temp HP) or HP healed; ≥ 0. */
  raw: number;
  /** A crit's damage at 0 HP is two failures (FR-CBTX-20). */
  crit?: boolean;
  /** The combat log entry about to be written (effects ended `down` point at it), or null. */
  hpChangeId: string | null;
}

export interface Applied {
  target: HpTarget;
  name: string;
  hpBefore: number;
  hpAfter: number;
  /** Damage taken by temp HP (FR-CBTX-15). */
  absorbed: number;
  tempBefore: number;
  tempAfter: number;
  /** Null = the counters did not change (FR-CBTX-21). */
  deathBefore: DeathCounters | null;
  deathAfter: DeathCounters | null;
  /** `combatant` / `entity` + ended `effect` rows, for the caller's event. */
  changes: RecordChange[];
  ended: Ended;
  /** FR-CBTX-17: a concentration save to ask for, issued by `after`. */
  card: { concentration: EffectRecord; dc: number; damage: number } | null;
}

const noEnded = (): Ended => ({ changes: [], ended: [], concentrationIds: [] });
const counters = (c: { deathSuccesses: number; deathFailures: number }): DeathCounters => ({
  successes: c.deathSuccesses,
  failures: c.deathFailures,
});

function applyMonster(env: Env, combatantId: string, input: ApplyInput) {
  const before = readCombatant(env.tx, combatantId);
  const hpBefore = before.hpCurrent ?? 0;
  const tempBefore = before.tempHp;
  const { absorbed, rest } =
    input.kind === "damage" ? absorb(tempBefore, input.raw) : { absorbed: 0, rest: 0 };
  const delta = input.kind === "damage" ? -rest : input.raw;
  const hpAfter = clampHp(hpBefore, delta, before.hpMax ?? 0);
  const tempAfter = tempBefore - absorbed;
  const changes: RecordChange[] = [];
  if (hpAfter !== hpBefore || tempAfter !== tempBefore) {
    env.tx
      .update(combatant)
      .set({ hpCurrent: hpAfter, tempHp: tempAfter })
      .where(eq(combatant.id, combatantId))
      .run();
    changes.push(combatantChange(before, readCombatant(env.tx, combatantId)));
  }
  return {
    name: before.name,
    hpBefore,
    hpAfter,
    absorbed,
    tempBefore,
    tempAfter,
    deathBefore: null,
    deathAfter: null,
    changes,
  };
}

/** Writes temp HP / counters on a character; one `entity` change from `before` to now. */
function writeCharacterPlay(
  env: Env,
  id: string,
  before: ReturnType<typeof readCharacter>,
  set: { tempHp?: number; deathSuccesses?: number; deathFailures?: number },
): RecordChange | null {
  const now = readCharacter(env.tx, id);
  const dirty = (Object.keys(set) as (keyof typeof set)[]).some((k) => set[k] !== now[k]);
  if (dirty) {
    env.tx
      .update(entity)
      .set({ ...set, updatedAt: env.ctx.clock.iso() })
      .where(eq(entity.id, id))
      .run();
  }
  const after = readCharacter(env.tx, id);
  return JSON.stringify(before) === JSON.stringify(after) ? null : characterChange(before, after);
}

function applyCharacter(env: Env, id: string, input: ApplyInput) {
  const before = readCharacter(env.tx, id);
  const tempBefore = before.tempHp;
  const { absorbed, rest } =
    input.kind === "damage" ? absorb(tempBefore, input.raw) : { absorbed: 0, rest: 0 };
  const hp = adjustHp(env, id, input.kind === "damage" ? -rest : input.raw);
  const tempAfter = tempBefore - absorbed;
  const deathBefore = counters(before);
  const deathAfter = deathAfterHp(deathBefore, {
    kind: input.kind,
    raw: input.raw,
    crit: input.crit === true,
    hpBefore: hp.hpBefore,
    hpAfter: hp.hpAfter,
  });
  const change = writeCharacterPlay(env, id, before, {
    tempHp: tempAfter,
    deathSuccesses: deathAfter.successes,
    deathFailures: deathAfter.failures,
  });
  const same = sameCounters(deathBefore, deathAfter);
  return {
    name: before.name,
    hpBefore: hp.hpBefore,
    hpAfter: hp.hpAfter,
    absorbed,
    tempBefore,
    tempAfter,
    deathBefore: same ? null : deathBefore,
    deathAfter: same ? null : deathAfter,
    changes: change ? [change] : [],
  };
}

const columnsOf = (t: HpTarget) =>
  t.kind === "monster"
    ? { targetCombatantId: t.combatantId, targetCharacterId: null }
    : { targetCombatantId: null, targetCharacterId: t.id };

/** Step 1: HP, temp HP, death counters, concentration (see the file header). */
export function apply(env: Env, target: HpTarget, input: ApplyInput): Applied {
  if (!Number.isInteger(input.raw) || input.raw < 0) throw new Error("hpRules: raw must be ≥ 0");
  const r =
    target.kind === "monster"
      ? applyMonster(env, target.combatantId, input)
      : applyCharacter(env, target.id, input);
  let ended = noEnded();
  let card: Applied["card"] = null;
  if (input.kind === "damage" && input.raw > 0) {
    const conc = activeConcentrationOf(env.tx, columnsOf(target));
    if (conc && r.hpAfter === 0) {
      // FR-CBTX-16: down ends concentration (+ links); undo of this row restores them.
      ended = endEffects(env, [conc], "down", { endedByHpChangeId: input.hpChangeId });
    } else if (conc) {
      card = { concentration: conc, dc: concentrationDc(input.raw), damage: input.raw };
    }
  }
  return { target, ...r, changes: [...r.changes, ...ended.changes], ended, card };
}

/**
 * Step 3, after the caller's event: the concentration card (PC → its owner unless hidden from
 * them, #141; else and monsters → DM) and the closures of an ended concentration's cards.
 * Returns the created card ids (`noteIds`).
 */
export function after(
  env: Env,
  a: Applied,
  ctx: { encounterId: string | null; hpChangeId: string | null },
): string[] {
  closeCardsOfEnded(env, a.ended);
  if (!a.card) return [];
  let owner: string | null = null;
  if (a.target.kind === "character") {
    const ch = readCharacter(env.tx, a.target.id);
    const hidden = pcCombatant(env.tx, campaignOf(env.actor), ch.id)?.hidden ?? false;
    owner = hidden ? null : ch.ownerPlayerId || null;
  }
  const { concentration: conc, dc, damage } = a.card;
  const id = notify(env, {
    kind: CONCENTRATION_CARD_KIND,
    audience: owner ? "player" : "dm",
    audiencePlayerId: owner,
    text: `${a.name}: concentration save DC ${dc} (${conc.label ?? ""})`,
    payload: {
      effectId: conc.id,
      targetName: a.name,
      dc,
      damage,
      hpChangeId: ctx.hpChangeId,
      encounterId: ctx.encounterId,
    },
    action: owner
      ? { label: CONCENTRATION_ACTION, role: "player", playerId: owner }
      : { label: CONCENTRATION_ACTION, role: "dm" },
  });
  return [id];
}

export interface Reverted {
  changes: RecordChange[];
  notRestored: string[];
  /** Cards this row created that are still pending: closed `undone` after the caller's event. */
  pendingNoteIds: string[];
}

/**
 * FR-CBTX-22 (`cbt.undo`, per row): HP inverse (clamped, I2); temp HP back by its change;
 * death counters by delta; effects this row ended back where the slot is free.
 */
export function revert(env: Env, row: HpChangeRecord, target: CombatantRecord): Reverted {
  const delta = row.kind === "damage" ? row.applied : -row.applied;
  const tempDelta = row.tempBefore - row.tempAfter;
  const changes: RecordChange[] = [];
  if (target.kind === "pc") {
    const before = readCharacter(env.tx, target.entityId);
    const hp = adjustHp(env, target.entityId, delta);
    const death = deathRevert(counters(before), row.deathBefore, row.deathAfter, hp.hpAfter);
    const change = writeCharacterPlay(env, target.entityId, before, {
      tempHp: clampTemp(before.tempHp + tempDelta),
      deathSuccesses: death.successes,
      deathFailures: death.failures,
    });
    if (change) changes.push(change);
  } else {
    const before = readCombatant(env.tx, target.id);
    const hpAfter = clampHp(before.hpCurrent ?? 0, delta, before.hpMax ?? 0);
    const tempAfter = clampTemp(before.tempHp + tempDelta);
    if (hpAfter !== before.hpCurrent || tempAfter !== before.tempHp) {
      env.tx
        .update(combatant)
        .set({ hpCurrent: hpAfter, tempHp: tempAfter })
        .where(eq(combatant.id, target.id))
        .run();
      changes.push(combatantChange(before, readCombatant(env.tx, target.id)));
    }
  }
  const restored = restoreEffects(env, endedByHpChange(env, row.id));
  const pendingNoteIds =
    row.noteIds.length === 0
      ? []
      : env.tx
          .select({ id: notification.id })
          .from(notification)
          .where(
            and(
              inArray(notification.id, row.noteIds),
              eq(notification.campaignId, campaignOf(env.actor)),
              eq(notification.state, "pending"),
            ),
          )
          .all()
          .map((n) => n.id);
  return {
    changes: [...changes, ...restored.changes],
    notRestored: restored.notRestored,
    pendingNoteIds,
  };
}

/** After the row's `CombatEntryUndone`: its pending cards close `undone` by rule (FR-CBTX-43). */
export function afterRevert(env: Env, r: Reverted): void {
  closeCards(env, r.pendingNoteIds, "undone");
}

export const hpRules = { apply, after, revert, afterRevert } as const;
