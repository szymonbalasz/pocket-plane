// combat-extras' token overlay `cbtx` (FR-CBTX-28/29/30; registry FR-MAP-34) on tokens bound to
// an active combatant of the started encounter: HP bar, effect icons, PC death badge. Pure over
// the store the client holds, so players see only what they receive: the DM every bar; a player
// their own PC's bar (they hold its HP) and a monster's band as a full-width bar (no proportion);
// no bar on other PCs. After End (no bound combatant) only a PC's death state stays (FR-CBTX-50).
import { healthBand } from "@shared/combat-tracker/rules";
import type { CombatantView } from "@shared/combat-tracker/schemas";
import type { DeathState } from "@shared/entities/schemas";
import type { RecordStore } from "@shared/protocol/store";
import type { TokenView } from "@shared/scenes-map/schemas";
import { boundCombatant, DOWN_CROSS } from "../combat-tracker/token-overlay";
import type {
  TokenBadge,
  TokenBar,
  TokenDecoration,
  TokenIcon,
  TokenOverlay,
} from "../scenes-map/token-overlays";
import { effectIconName, effectValue } from "./icons";
import {
  activeEffects,
  characterOf,
  chipOrder,
  chipText,
  creatureOf,
  DEATH_LABEL,
  deathStateFor,
  effectsOn,
} from "./logic";

export const BAR_ID = "cbtx-token-bar";
export const ICON_ID = "cbtx-token-effect";
export const DEATH_ID = "cbtx-token-death";

const TONE: Record<DeathState, TokenBadge["tone"]> = {
  dying: "down",
  stable: "neutral",
  dead: "down",
};

/** A proportional bar (DM; the owner's PC): fill = HP / max, temp after it; none at 0 HP. */
function proportional(hp: number, max: number, temp: number): TokenBar | null {
  if (hp <= 0 || max <= 0) return null;
  return {
    id: BAR_ID,
    fraction: Math.min(1, hp / max),
    ...(temp > 0 ? { temp: temp / max } : {}),
    tone: healthBand(hp, max) === "bloodied" ? "bloodied" : "full",
  };
}

/** FR-CBTX-28: the bar this viewer may see for the bound combatant, or null. */
export function barFor(store: RecordStore, c: CombatantView): TokenBar | null {
  if (c.kind === "monster") {
    if (typeof c.hpCurrent === "number" && typeof c.hpMax === "number") {
      return proportional(c.hpCurrent, c.hpMax, c.tempHp ?? 0);
    }
    // Players: the band's tone, full width, no proportion (#178); Down shows the X instead.
    if (!c.band || c.band === "down") return null;
    return { id: BAR_ID, fraction: null, tone: c.band === "bloodied" ? "bloodied" : "full" };
  }
  const ch = c.entityId ? characterOf(store, c.entityId) : undefined;
  // Other players' PCs arrive redacted: no HP, so no bar.
  if (!ch || typeof ch.hpCurrent !== "number") return null;
  return proportional(ch.hpCurrent, ch.statBlock?.hpMax ?? 0, ch.tempHp ?? 0);
}

/** FR-CBTX-29: one icon per active effect the viewer holds (the renderer caps at 4 + "+N"). */
export function iconsFor(store: RecordStore, c: CombatantView): TokenIcon[] {
  const enc = c.encounterId;
  const round = (store.records.encounter?.[enc] as { round?: number } | undefined)?.round ?? null;
  return chipOrder(effectsOn(activeEffects(store), creatureOf(c))).map((e) => ({
    id: ICON_ID,
    icon: effectIconName(e),
    tone: "neutral",
    label: chipText(e, round),
    value: effectValue(e),
  }));
}

/** FR-CBTX-30: "Dying" / "Stable" / "Dead" on a PC token, for everyone who receives it. */
export function deathBadgeFor(store: RecordStore, c: CombatantView): TokenBadge | null {
  if (c.kind !== "pc" || !c.entityId) return null;
  const state = deathStateFor(characterOf(store, c.entityId));
  if (!state) return null;
  return {
    id: DEATH_ID,
    icon: state === "stable" ? "heart-pulse" : "skull",
    tone: TONE[state],
    label: DEATH_LABEL[state],
  };
}

/**
 * FR-CBTX-50 (item 14): a character token not bound to an active combatant (after End, another
 * scene) keeps its death state: "Dead" always while dead, "Dying" / "Stable" while at 0 HP, plus
 * the Down X. The link is the token's `characterId` copy (players get it, FR-MAP-50; DM clients
 * may also use `definitionId`); DM and owner read the full character, others the redacted one.
 */
export function unboundDeathFor(store: RecordStore, token: TokenView): TokenDecoration | null {
  const id = token.characterId ?? token.definitionId;
  const state = id ? deathStateFor(characterOf(store, id)) : null;
  if (!state) return null;
  return {
    badges: [
      {
        id: DEATH_ID,
        icon: state === "stable" ? "heart-pulse" : "skull",
        tone: TONE[state],
        label: DEATH_LABEL[state],
      },
    ],
    cross: DOWN_CROSS,
  };
}

export const cbtxTokenOverlay: TokenOverlay = {
  id: "cbtx",
  decorate(token: TokenView, store): TokenDecoration | null {
    const c = boundCombatant(store, token.id);
    if (!c) return unboundDeathFor(store, token);
    const out: TokenDecoration = {};
    const bar = barFor(store, c);
    if (bar) out.bar = bar;
    const icons = iconsFor(store, c);
    if (icons.length > 0) out.icons = icons;
    const badge = deathBadgeFor(store, c);
    if (badge) out.badges = [badge];
    return Object.keys(out).length > 0 ? out : null;
  },
};
