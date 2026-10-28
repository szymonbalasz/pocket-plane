// Pre-tinted particle sprites (VFX §12: `drawImage`, no per-particle gradients): one soft disc
// per colour, drawn once into a small canvas and scaled per particle. Without a DOM (bun test)
// there are no sprites and `dot` falls back to a plain arc, so draws stay deterministic.

/** An `r, g, b` triple, e.g. `"255, 214, 120"`. */
export type Rgb = string;

const SPRITE_PX = 32;
const cache = new Map<string, CanvasImageSource | null>();

function makeCanvas(px: number): HTMLCanvasElement | OffscreenCanvas | null {
  if (typeof document !== "undefined") {
    const c = document.createElement("canvas");
    c.width = px;
    c.height = px;
    return c;
  }
  if (typeof OffscreenCanvas !== "undefined") return new OffscreenCanvas(px, px);
  return null;
}

/** A soft disc in `rgb` (opaque centre → transparent rim), or null without a canvas. */
export function glowSprite(rgb: Rgb): CanvasImageSource | null {
  const hit = cache.get(rgb);
  if (hit !== undefined) return hit;
  let out: CanvasImageSource | null = null;
  try {
    const c = makeCanvas(SPRITE_PX);
    const g = c?.getContext("2d") as CanvasRenderingContext2D | null | undefined;
    if (c && g) {
      const h = SPRITE_PX / 2;
      const grad = g.createRadialGradient(h, h, 0, h, h, h);
      grad.addColorStop(0, `rgba(${rgb}, 1)`);
      grad.addColorStop(0.35, `rgba(${rgb}, 0.6)`);
      grad.addColorStop(1, `rgba(${rgb}, 0)`);
      g.fillStyle = grad;
      g.fillRect(0, 0, SPRITE_PX, SPRITE_PX);
      out = c;
    }
  } catch {
    out = null;
  }
  cache.set(rgb, out);
  return out;
}

/** A sprite particle of radius `r` at (x, y), alpha `a` (the sprite, else a flat arc). */
export function dot(
  ctx: CanvasRenderingContext2D,
  rgb: Rgb,
  x: number,
  y: number,
  r: number,
  a: number,
): void {
  if (r <= 0 || a <= 0) return;
  ctx.globalAlpha = Math.min(1, a);
  const s = glowSprite(rgb);
  if (s) {
    ctx.drawImage(s, x - r, y - r, r * 2, r * 2);
    return;
  }
  ctx.fillStyle = `rgb(${rgb})`;
  ctx.beginPath();
  ctx.arc(x, y, r * 0.6, 0, Math.PI * 2);
  ctx.fill();
}

/** Test seam: drop the sprite cache. */
export function resetSprites(): void {
  cache.clear();
}
