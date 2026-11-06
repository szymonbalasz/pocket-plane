// Aura anchors (FR-VFX-11, -15, -17, VFX §8 derived values; pure): which tokens on the shown
// scene draw which aura, for this viewer, from records the client already holds. No new record
// type: an active effect with `fx` + the tokens it targets. FR-VFX-40: a template-anchored
// preset's aura sits on the kept AoE template its `fx.templateId` names (anchor id `tpl:<id>`),
// drawn only where that template is drawn. DOM-free.
import { EFFECT_TYPE, type EffectView } from "@shared/combat-extras/schemas";
import { COMBATANT_TYPE, type CombatantView } from "@shared/combat-tracker/schemas";
import type { RecordStore } from "@shared/protocol/store";
import { AOE_TEMPLATE_TYPE, type TemplateRecordView } from "@shared/scene-tools/schemas";
import { footprint } from "@shared/scenes-map/geometry";
import type { TokenView } from "@shared/scenes-map/schemas";
import { type FxParamsOut, type FxPreset, presetOf } from "@shared/spell-fx/presets";
import type { Cover } from "./aura-types";

export interface AuraSpec {
  /** `<effectId>:<tokenId>`: one aura per (effect, anchor token). */
  key: string;
  effectId: string;
  /** The anchor: a token id, or `tpl:<templateId>` for a template anchor (FR-VFX-40). */
  tokenId: string;
  /** FR-VFX-40: the kept template it is drawn on, else null (a token aura). */
  templateId: string | null;
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
  templates: readonly TemplateRecordView[] = [],
): AuraSpec[] {
  const effects = fxEffects(store);
  if (effects.length === 0) return [];
  const templateById = new Map(templates.map((t) => [t.id, t]));
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
    if (preset.template) {
      // FR-VFX-40: on its kept template, where this canvas draws it; else nothing.
      const tpl = fx.templateId ? templateById.get(fx.templateId) : undefined;
      if (!tpl) continue;
      out.push({
        key: `${e.id}:${templateAnchorId(tpl.id)}`,
        effectId: e.id,
        tokenId: templateAnchorId(tpl.id),
        templateId: tpl.id,
        preset,
        params: parsed.data,
        radiusFt: null,
        hidden: tpl.hidden,
        cover: "half",
        side: tpl.placedByPlayerId !== null ? "party" : "monster",
      });
      continue;
    }
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
        templateId: null,
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

/** FR-VFX-40: a template anchor's id in the engine's anchor space. */
export const templateAnchorId = (templateId: string) => `tpl:${templateId}`;
const TPL = "tpl:";
/** FR-VFX-40: the template id of an anchor id, else null (a token). */
export const templateOfAnchor = (anchorId: string): string | null =>
  anchorId.startsWith(TPL) ? anchorId.slice(TPL.length) : null;

export interface TemplateDrawView extends AnchorView {
  sceneId: string;
  /** DM: the Layers switch "Templates" is off (none drawn). */
  templatesOff: boolean;
  /** DM: "DM-only items" is off (hidden ones not drawn). */
  dmOnlyOff: boolean;
  /** FR-FOG-36: a blind player draws only their own. */
  blind: boolean;
}

/**
 * FR-VFX-40: the kept templates this canvas draws (SCN FR-SCN-05, FR-FOG-36): the shown scene's,
 * none with the DM's Templates switch off, hidden ones for the DM with DM-only items on, a blind
 * player only their own. A template aura draws only on one of these.
 */
export function drawnTemplates(store: RecordStore, v: TemplateDrawView): TemplateRecordView[] {
  if (v.client === "dm" && v.templatesOff) return [];
  const byId = (store.records[AOE_TEMPLATE_TYPE] ?? {}) as Record<string, TemplateRecordView>;
  return Object.values(byId).filter((t) => {
    if (t.sceneId !== v.sceneId) return false;
    if (t.hidden && (v.client !== "dm" || v.dmOnlyOff)) return false;
    if (v.blind && (v.myPlayerId === null || t.placedByPlayerId !== v.myPlayerId)) return false;
    return true;
  });
}

/**
 * FR-VFX-40: a cube template's square as a drawn box (map px): the square unrotated about its
 * centre, side `size / 5` cells, with its `angle` in radians. The cube's origin is a corner, its
 * sides along `angle` and `angle + 90°` (SCN FR-SCN-42).
 */
export function templateBox(
  g: { gridCellSize: number; gridOffsetX: number; gridOffsetY: number },
  t: { x: number; y: number; size: number; angle: number },
): { x: number; y: number; size: number; angle: number } {
  const L = t.size / 5;
  const a = (t.angle * Math.PI) / 180;
  const cx = t.x + (L / 2) * (Math.cos(a) - Math.sin(a));
  const cy = t.y + (L / 2) * (Math.sin(a) + Math.cos(a));
  const side = L * g.gridCellSize;
  return {
    x: g.gridOffsetX + cx * g.gridCellSize - side / 2,
    y: g.gridOffsetY + cy * g.gridCellSize - side / 2,
    size: side,
    angle: a,
  };
}

/**
 * FR-VFX-40: a token's footprint (centre ± half its side) overlaps a template anchor's square
 * (centre, side, `angle` in radians) by more than a tenth of a cell: a creature in the area.
 */
export function insideSquare(
  anchor: { x: number; y: number; size: number; angle?: number },
  target: { x: number; y: number; size: number },
  cell: number,
): boolean {
  const a = anchor.angle ?? 0;
  const dx = target.x + target.size / 2 - (anchor.x + anchor.size / 2);
  const dy = target.y + target.size / 2 - (anchor.y + anchor.size / 2);
  const lx = dx * Math.cos(a) + dy * Math.sin(a);
  const ly = -dx * Math.sin(a) + dy * Math.cos(a);
  const half = anchor.size / 2 + target.size / 2 - cell * 0.1;
  return Math.abs(lx) < half && Math.abs(ly) < half;
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
