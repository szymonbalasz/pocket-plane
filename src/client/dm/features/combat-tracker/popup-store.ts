// Client-only state of the DM's combat dialogs: the attack popup (card id, and where it was opened
// from) and the damage / heal dialog (combatant id). The popup's dragged position lives in its own
// state (lost on close, FR-CBT-76). Sprint 5 (FR-CBT-90, -93): the popup's edits are kept per card
// here until reload (across Later, another card, a reconnect), and the cards this client saw
// resolved, for the late note.
import type { DamageMultiplier } from "@shared/combat-tracker/schemas";
import { create } from "zustand";
import { setMapSelection } from "../scenes-map/selection";
import { blurField, type FieldDraft, type ResolvedCard } from "./late-fill";

/** FR-CBT-75: the notification toast / row the popup was opened from, viewport px. */
export interface PopupOrigin {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** One target row's edits: toggled hit (null = the preset), multiplier, extra parts' multipliers. */
export interface PerTarget {
  hit: boolean | null;
  mult: DamageMultiplier;
  /** FR-CBT-82: each extra part's picked multiplier; null / absent = its defense preset. */
  extra?: (DamageMultiplier | null)[];
}

/** The DM's edits of one card's popup (FR-CBT-90); absent = untouched. */
export interface CardDraft {
  toHit: FieldDraft;
  /** The base part's total (a total typed before the roll is the base part's). */
  damage: FieldDraft;
  /** FR-CBT-82: each extra part's total, card order. */
  extra: FieldDraft[];
  added: string[];
  per: Record<string, PerTarget>;
  /** Popup parts' values (`popupParts` id → value), e.g. trigger chips' ticks and values. */
  parts: Record<string, unknown>;
  /** FR-CBT-89: ruled hits the DM dropped (✕) in the damage step. */
  dropped: string[];
}

export const emptyDraft = (): CardDraft => ({
  toHit: { text: null },
  damage: { text: null },
  extra: [],
  added: [],
  per: {},
  parts: {},
  dropped: [],
});

/** FR-CBT-93 (b): cards this client saw resolved, newest last; a few turns' worth. */
const RESOLVED_KEEP = 40;

interface CombatDialogs {
  cardId: string | null;
  /** Null: placed per FR-CBT-55/56 (Pending row, own attack). */
  origin: PopupOrigin | null;
  /** Bumped per open, so reopening the same card places it again. */
  openSeq: number;
  hpCombatantId: string | null;
  openCard(id: string, origin?: PopupOrigin | null): void;
  closeCard(): void;
  openHp(combatantId: string): void;
  closeHp(): void;
  drafts: Record<string, CardDraft>;
  /** Patch one card's draft (created untouched on first use). */
  editDraft(cardId: string, patch: (d: CardDraft) => Partial<CardDraft>): void;
  /** The card left the popup for good (applied, dismissed): its draft goes. */
  dropDraft(cardId: string): void;
  /** The popup closed with a field focused (no blur): that field follows its roll again. */
  thawDraft(cardId: string): void;
  resolved: ResolvedCard[];
  sawResolved(card: ResolvedCard): void;
}

export const useCombatDialogs = create<CombatDialogs>((set, get) => ({
  cardId: null,
  origin: null,
  openSeq: 0,
  hpCombatantId: null,
  openCard: (cardId, origin = null) => {
    // Another card over an open popup: that popup closes, and so do its targets (below).
    if (get().cardId !== null) setMapSelection([]);
    set((s) => ({ cardId, origin, openSeq: s.openSeq + 1 }));
  },
  // FR-CBT-54 (sim-5 glitch 1): the popup's selection rows are the map selection, so every close
  // (Apply, Dismiss, Later, Esc, the card resolved elsewhere) clears it: the next card's popup
  // opens with the selection the DM makes for it, never this one's leftovers.
  closeCard: () => {
    if (get().cardId !== null) setMapSelection([]);
    set({ cardId: null, origin: null });
  },
  openHp: (hpCombatantId) => set({ hpCombatantId }),
  closeHp: () => set({ hpCombatantId: null }),
  drafts: {},
  editDraft: (cardId, patch) =>
    set((s) => {
      const d = s.drafts[cardId] ?? emptyDraft();
      return { drafts: { ...s.drafts, [cardId]: { ...d, ...patch(d) } } };
    }),
  dropDraft: (cardId) =>
    set((s) => {
      if (!(cardId in s.drafts)) return s;
      const { [cardId]: _, ...rest } = s.drafts;
      return { drafts: rest };
    }),
  thawDraft: (cardId) =>
    set((s) => {
      const d = s.drafts[cardId];
      if (!d) return s;
      const thawed = { ...d, damage: blurField(d.damage), extra: d.extra.map(blurField) };
      return { drafts: { ...s.drafts, [cardId]: thawed } };
    }),
  resolved: [],
  sawResolved: (card) =>
    set((s) => ({
      resolved: [...s.resolved.filter((r) => r.cardId !== card.cardId), card].slice(-RESOLVED_KEEP),
    })),
}));
