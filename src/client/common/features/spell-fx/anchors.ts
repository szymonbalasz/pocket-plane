// Aura anchors (FR-VFX-11, -15, -17, VFX §8 derived values; pure): which tokens on the shown
// scene draw which aura, for this viewer, from records the client already holds. No new record
// type: an active effect with `fx` + the tokens it targets. DOM-free.
import { EFFECT_TYPE, type EffectView } from "@shared/combat-extras/schemas";
import { COMBATANT_TYPE, type CombatantView } from "@shared/combat-tracker/schemas";
import type { RecordStore } from "@shared/protocol/store";
import { footprint } from "@shared/scenes-map/geometry";
import type { TokenView } from "@shared/scenes-map/schemas";
import { type FxParamsOut, type FxPreset, presetOf } from "@shared/spell-fx/presets";
import type { Cover } from "./aura-types";

export interface AuraSpec {
  /** `<effectId>:<tokenId>`: one aura per (effect, anchor token). */
  key: string;
  effectId: string;
  tokenId: string;
  preset: FxPreset;
  params: FxParamsOut;
  /** Feet, or null for a preset without a radius. */
  radiusFt: number | null;
  /** DM only: the anchor token is hidden (drawn at the hidden-token opacity, FR-VFX-12). */
  hidden: boolean;
  /** FR-VFX-17. */
  cover: Cover;
  /** FR-VFX-15: the anchor's side (`party` = a PC or owned token). */
  side: Side;
}

export type Side = "party" | "monster";

export interface AnchorView {
  client: "dm" | "player";
  myPlayerId: string | null;
}

const warned = new Set<string>();

/** VFX §11: an unknown preset (a newer server) draws nothing, one console warning per key. */
function knownPreset(key: string): FxPreset | null {
  const p = presetOf(key);
  if (!p && !warned.has(key)) {
    warned.add(key);
    console.warn(`spell-fx: unknown preset "${key}", nothing drawn`);
  }
  return p;
}

/** A token's side: PC or owned → `party`, else `monster`. */
export const sideOfToken = (t: Pick<TokenView, "characterId" | "ownerPlayerId">): Side =>
  t.characterId !== null || t.ownerPlayerId !== null ? "party" : "monster";

/** Active effects with a map effect, oldest first (players only ever hold active ones). */
export function fxEffects(store: RecordStore): EffectView[] {
  return (Object.values(store.records[EFFECT_TYPE] ?? {}) as EffectView[])
    .filter((e) => !e.endedAt && e.fx)
    .sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0) || (a.id < b.id ? -1 : 1));
}

/**
 * FR-VFX-11: an aura per active `fx` effect the viewer holds, at each token on the shown scene
 * that is its target (`targetCharacterId` → tokens with that `characterId`; `targetCombatantId`
 * → that combatant's `tokenId`). `tokens` = what this canvas draws (the DM's "DM-only items"
 * switch already applied); a token the viewer lacks draws nothing.
 */
export function aurasOf(
  store: RecordStore,
  tokens: readonly TokenView[],
  view: AnchorView,
): AuraSpec[] {
  const effects = fxEffects(store);
  if (effects.length === 0) return [];
  const byCharacter = new Map<string, TokenView[]>();
  const byId = new Map<string, TokenView>();
  for (const t of tokens) {
    byId.set(t.id, t);
    if (t.characterId) {
      const list = byCharacter.get(t.characterId) ?? [];
      list.push(t);
      byCharacter.set(t.characterId, list);
    }
  }
  const combatants = store.records[COMBATANT_TYPE] ?? {};
  const out: AuraSpec[] = [];
  for (const e of effects) {
    const fx = e.fx;
    if (!fx) continue;
    const preset = knownPreset(fx.preset);
    if (!preset) continue;
    const parsed = preset.params.safeParse(fx.params);
    if (!parsed.success) continue;
    let anchors: TokenView[] = [];
    if (e.targetCharacterId) anchors = byCharacter.get(e.targetCharacterId) ?? [];
    else if (e.targetCombatantId) {
      const c = combatants[e.targetCombatantId] as CombatantView | undefined;
      const t = c?.tokenId ? byId.get(c.tokenId) : undefined;
      if (t) anchors = [t];
    }
    for (const t of anchors) {
      if (t.hidden && view.client !== "dm") continue;
      const owner =
        view.client === "dm" || (t.ownerPlayerId !== null && t.ownerPlayerId === view.myPlayerId);
      out.push({
        key: `${e.id}:${t.id}`,
        effectId: e.id,
        tokenId: t.id,
        preset,
        params: parsed.data,
        radiusFt: preset.radiusFt?.(parsed.data) ?? null,
        hidden: t.hidden,
        cover: owner ? "half" : "eyes",
        side: sideOfToken(t),
      });
    }
  }
  return out;
}

/** VFX §8: the turn reaction's "inside" test: centre distance ≤ radius + half the target's side. */
export function insideAura(
  anchor: { x: number; y: number; size: number },
  radiusFt: number,
  target: { x: number; y: number; size: number },
  cell: number,
): boolean {
  const ax = anchor.x + anchor.size / 2;
  const ay = anchor.y + anchor.size / 2;
  const tx = target.x + target.size / 2;
  const ty = target.y + target.size / 2;
  const edge = (radiusFt / 5) * cell + anchor.size / 2;
  return Math.hypot(tx - ax, ty - ay) <= edge + target.size / 2;
}

/** FR-VFX-15: the combatant's side (a PC or a token a player owns → `party`). */
export function sideOfCombatant(c: CombatantView, token: TokenView | undefined): Side {
  if (c.kind === "pc") return "party";
  return token ? sideOfToken(token) : "monster";
}

/** Footprint side in px of a token at `cell` px per square. */
export const sidePx = (t: Pick<TokenView, "size">, cell: number) => footprint(t.size) * cell;
