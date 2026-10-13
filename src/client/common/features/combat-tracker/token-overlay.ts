// Combat's token overlay `cbt` (FR-CBT-38, FR-CBT-39; registry FR-MAP-34): on a token bound to an
// active combatant of the started encounter, Out (removed: dim + badge), Down (0 HP: a monster's
// HP or band, a PC's character HP or redacted `down`), the target ring while the DM targets, and
// movement used this turn. Pure over the record store each client already holds, so players see
// badges only on what they receive, and nothing after End.
import { COMBATANT_TYPE, type CombatantView } from "@shared/combat-tracker/schemas";
import { ENTITY_TYPE } from "@shared/entities/schemas";
import type { RecordStore } from "@shared/protocol/store";
import type { TokenView } from "@shared/scenes-map/schemas";
import { create } from "zustand";
import type { TokenBadge, TokenDecoration, TokenOverlay } from "../scenes-map/token-overlays";
import { startedIn } from "./store";

/** The attacker of the DM's open attack popup: never a target, so no ring (FR-CBT-33). */
export const useTargetingAttacker = create<{ attackerId: string | null }>(() => ({
  attackerId: null,
}));

export const OUT_BADGE: TokenBadge = {
  id: "cbt-token-out",
  icon: "log-out",
  tone: "neutral",
  label: "Out",
};
export const DOWN_BADGE: TokenBadge = {
  id: "cbt-token-down",
  icon: "skull",
  tone: "down",
  label: "Down",
};

/** The active combatant of the started encounter bound to the token, if any. */
export function boundCombatant(store: RecordStore, tokenId: string): CombatantView | null {
  const enc = startedIn(store);
  if (!enc) return null;
  const all = Object.values(store.records[COMBATANT_TYPE] ?? {}) as CombatantView[];
  return (
    all.find((c) => c.tokenId === tokenId && c.encounterId === enc.id && c.active !== false) ?? null
  );
}

/** FR-CBT-38: monster at 0 HP (DM) / band down (players); PC: character HP 0 or `down`. */
export function isDown(store: RecordStore, c: CombatantView): boolean {
  if (c.kind === "monster") {
    if (c.hpCurrent !== undefined && c.hpCurrent !== null) return c.hpCurrent <= 0;
    return c.band === "down";
  }
  if (!c.entityId) return false;
  const e = store.records[ENTITY_TYPE]?.[c.entityId] as
    | { hpCurrent?: number; down?: boolean }
    | undefined;
  if (!e) return false;
  return typeof e.hpCurrent === "number" ? e.hpCurrent <= 0 : e.down === true;
}

export const cbtTokenOverlay: TokenOverlay = {
  id: "cbt",
  decorate(token: TokenView, store, view): TokenDecoration | null {
    const c = boundCombatant(store, token.id);
    if (!c) return null;
    if (c.removed) return { dim: true, badges: [OUT_BADGE] };
    const out: TokenDecoration = isDown(store, c) ? { badges: [DOWN_BADGE] } : {};
    if (view.targeting && view.selected && c.id !== useTargetingAttacker.getState().attackerId) {
      out.ring = "target";
    }
    return out.badges || out.ring ? out : null;
  },
  movedFt(token, store) {
    return boundCombatant(store, token.id)?.movedFt ?? null;
  },
};
