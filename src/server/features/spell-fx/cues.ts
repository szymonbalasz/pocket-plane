// Hit cues (FR-VFX-20–22, OQ-VFX-05 A, ADR-0071): after `AttackApplied` / `HpApplied` commit, one
// transient `vfx.hit` signal per applied target row, routed per connection. Writes nothing
// (ADR-0035); never stored, logged, in a snapshot or replayed. Per receiver: the DM always; a
// player only if they receive the target token now (hidden, fog: the token record's own rule,
// FR-FOG-11) and that apply's outcome line (a DM-only line, BL-135's roll guard included, → no
// cue); `attackerTokenId` only if they also receive the attacker's token.
import type { HpChangeRecord } from "@shared/combat-tracker/schemas";
import { HP_CHANGE_TYPE } from "@shared/combat-tracker/schemas";
import { GAME_LOG_ENTRY_TYPE, type GameLogEntryRecord } from "@shared/dice-roll-log/schemas";
import { PartDamageType } from "@shared/effect-modifiers/schemas";
import { AttackApplied, HpApplied, type HpChangeFacts } from "@shared/events/combat-tracker";
import type { SignalFrom } from "@shared/protocol/frames";
import { TOKEN_TYPE } from "@shared/scenes-map/schemas";
import {
  HIT_CUE_PARTS_MAX,
  type HitCue,
  type HitCuePart,
  VFX_HIT_SIGNAL,
} from "@shared/spell-fx/cue";
import { eq } from "drizzle-orm";
import type { Db } from "../../db/client";
import { combatant, token } from "../../db/schema";
import type { DispatchedEvent } from "../../events/types";
import type { Services } from "../../services";
import type { Viewer } from "../../ws/records";
import { toTokenRecord } from "../scenes-map/rows";

const CUE_EVENTS: ReadonlySet<string> = new Set([AttackApplied.type, HpApplied.type]);

function tokenOf(db: Db, combatantId: string | null) {
  if (combatantId === null) return null;
  const c = db
    .select({ tokenId: combatant.tokenId })
    .from(combatant)
    .where(eq(combatant.id, combatantId))
    .get();
  if (!c?.tokenId) return null;
  const t = db.select().from(token).where(eq(token.id, c.tokenId)).get();
  return t ? toTokenRecord(t) : null;
}

const typeOf = (t: string | null) => {
  const r = PartDamageType.safeParse(t);
  return r.success ? r.data : null;
};

/**
 * FR-VFX-21 parts: the base part (the row's type, `raw` minus the extra and trigger parts), the
 * extra weapon parts and the trigger parts, all after their multiplier; the largest four.
 */
function partsOf(f: HpChangeFacts, row: HpChangeRecord | null): HitCuePart[] {
  if (f.kind === "heal") return [{ type: null, value: f.raw }];
  const extra = (row?.damageParts ?? []).map((p) => ({ type: typeOf(p.type), value: p.raw }));
  const triggers = (row?.triggerParts ?? []).map((p) => ({ type: typeOf(p.type), value: p.value }));
  const rest = [...extra, ...triggers].reduce((n, p) => n + p.value, 0);
  const parts = [
    { type: typeOf(f.damageType), value: Math.max(0, f.raw - rest) },
    ...extra,
    ...triggers,
  ];
  return parts
    .map((p, i) => ({ p, i }))
    .sort((a, b) => b.p.value - a.p.value || a.i - b.i)
    .slice(0, HIT_CUE_PARTS_MAX)
    .sort((a, b) => a.i - b.i)
    .map(({ p }) => p);
}

const afterOf = <T>(e: DispatchedEvent, type: string): T | null =>
  (e.event.changes.find((c) => c.type === type && c.after !== null)?.after as T | undefined) ??
  null;

/** The bus listener: one `vfx.hit` per cue event, per live connection that may have it. */
export function hitCueListener(s: Services) {
  return (e: DispatchedEvent): void => {
    if (!CUE_EVENTS.has(e.event.type) || !s.hub || e.event.campaignId === null) return;
    const f = e.event.payload as HpChangeFacts;
    // FR-VFX-20: a miss plays nothing; nothing applied and nothing raw neither (an immune hit,
    // `multiplier: none`, still plays its glance).
    if (f.hit === false) return;
    if (f.raw === 0 && f.applied === 0 && f.multiplier !== "none") return;
    const target = tokenOf(s.db, f.targetId);
    if (!target) return;
    const attacker = tokenOf(s.db, f.attackerId);
    const line = afterOf<GameLogEntryRecord>(e, GAME_LOG_ENTRY_TYPE);
    const row = afterOf<HpChangeRecord>(e, HP_CHANGE_TYPE);
    const cue: HitCue = {
      id: f.hpChangeId,
      targetTokenId: target.id,
      ...(attacker ? { attackerTokenId: attacker.id } : {}),
      kind: f.kind,
      parts: partsOf(f, row),
      multiplier: f.multiplier ?? "normal",
      crit: (line?.payload as { crit?: unknown } | undefined)?.crit === true,
    };
    const { actor } = e.meta;
    const from: SignalFrom =
      actor.role === "player" ? { role: "player", playerId: actor.playerId ?? "" } : { role: "dm" };
    const sees = (type: string, rec: unknown, v: Viewer) =>
      s.records.view(type, rec, v).vis !== "hidden";
    s.hub.sendServerSignal(e.event.campaignId, VFX_HIT_SIGNAL, from, (v) => {
      if (v.role === "dm") return cue;
      if (!sees(TOKEN_TYPE, target, v)) return null;
      if (!line || !sees(GAME_LOG_ENTRY_TYPE, line, v)) return null;
      if (cue.attackerTokenId === undefined || (attacker && sees(TOKEN_TYPE, attacker, v)))
        return cue;
      const { attackerTokenId: _hidden, ...rest } = cue;
      return rest;
    });
  };
}
