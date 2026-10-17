// The dice layer's canvas host (FR-DICEX-33, -41): the element the page's one WebGL canvas lives
// in. Every arena draws there: the screen and zone throws, popup miniatures, the look editor's
// preview die. Set while the dice layer is mounted (the display draws 3D), else null.
import type { Rect } from "./dice3d/index";

export const diceLayerHost: { current: HTMLDivElement | null } = { current: null };

/** An element's rect in viewport CSS px (null when absent). */
export function rectOf(el: Element | null): Rect | null {
  const r = el?.getBoundingClientRect();
  return r ? { x: Math.round(r.left), y: Math.round(r.top), w: r.width, h: r.height } : null;
}
