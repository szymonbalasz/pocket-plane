// Combat's token overlay `cbt` (FR-CBT-38, FR-CBT-39, FR-CBT-48; registry FR-MAP-34): on a token
// bound to an active combatant of the started encounter, Out (removed: dim + badge), Down (a cross;
// 0 HP: a monster's HP or band, a PC's character HP or redacted `down`), the target ring while the
// DM targets, movement used this turn, and the side badge (FR-CBT-104: the row's "Ally" / "Enemy"
// chip). Pure over the record store each client already holds, so players see badges only on what
// they receive, and nothing after End. Plus `companion` (FR-MAP-76): a paw on an owned non-PC
// token in its owner's colour, on every client; a pure token rule (no combat data).
import { COMBATANT_TYPE, type CombatantView } from "@shared/combat-tracker/schemas";
import { ENTITY_TYPE } from "@shared/entities/schemas";
import type { RecordStore } from "@shared/protocol/store";
import type { TokenView } from "@shared/scenes-map/schemas";
import { create } from "zustand";
import { markColor, ownerOf, personName } from "../scenes-map/mark-colors";
import type {
  TokenBadge,
  TokenCross,
  TokenDecoration,
  TokenOverlay,
} from "../scenes-map/token-overlays";
import { SIDE_LABEL, sideChip } from "./side";
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
/** FR-CBT-48 (#171): Down is a translucent X in `hp.down`, no longer a badge. */
export const DOWN_CROSS: TokenCross = { id: "cbt-token-down", tone: "down" };

/** FR-CBT-104 (#252): the row's side chip as a badge (the same rule: `sideChip`). */
export function sideBadge(c: CombatantView): TokenBadge | null {
  const chip = sideChip(c);
  if (!chip) return null;
  return {
    id: "cbt-token-side",
    icon: chip.side === "ally" ? "handshake" : "swords",
    tone: "neutral",
    label: SIDE_LABEL[chip.side],
  };
}

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

/** FR-CBT-49 (G9): the Initiative row's "Down" Badge for a PC (DM, owner: HP; others: `down`). */
export const pcDown = (store: RecordStore, c: CombatantView) => c.kind === "pc" && isDown(store, c);

export const cbtTokenOverlay: TokenOverlay = {
  id: "cbt",
  decorate(token: TokenView, store, view): TokenDecoration | null {
    const c = boundCombatant(store, token.id);
    if (!c) return null;
    // FR-CBT-48: Down = translucent X; Out = dim + badge; removed and down → both.
    const out: TokenDecoration = {};
    if (isDown(store, c)) out.cross = DOWN_CROSS;
    if (c.removed) return { ...out, dim: true, badges: [OUT_BADGE] };
    if (view.targeting && view.selected && c.id !== useTargetingAttacker.getState().attackerId) {
      out.ring = "target";
    }
    const side = sideBadge(c);
    if (side) out.badges = [side];
    return out.cross || out.ring || out.badges ? out : null;
  },
  movedFt(token, store) {
    return boundCombatant(store, token.id)?.movedFt ?? null;
  },
};

/** FR-MAP-76: an owned non-PC token (pet, summon, a familiar the DM gave an owner). */
export const isOwnedCompanionToken = (t: Pick<TokenView, "ownerPlayerId" | "characterId">) =>
  t.ownerPlayerId !== null && t.characterId === null;

/** FR-MAP-76's badge test id / Konva name (id = token id). */
export const COMPANION_MARKER_ID = "map-token-companion";

/**
 * FR-MAP-76: the paw badge in the owner's colour (`colorOf`; unknown → the player accent),
 * "Player 1's companion" as its tooltip; always a chip. In the label row, so BL-35's small-cell
 * rules (chip + "+N", "+N") keep it off names.
 */
export function companionBadge(
  token: Pick<TokenView, "ownerPlayerId" | "characterId">,
  store: RecordStore,
): TokenBadge | null {
  if (!isOwnedCompanionToken(token)) return null;
  const owner = ownerOf(token);
  return {
    id: COMPANION_MARKER_ID,
    icon: "paw-print",
    tone: "neutral",
    label: `${personName(store, owner)}'s companion`,
    color: markColor(store, owner),
    compact: true,
  };
}

export const companionTokenOverlay: TokenOverlay = {
  id: "companion",
  decorate(token, store) {
    const badge = companionBadge(token, store);
    return badge ? { badges: [badge] } : null;
  },
};
