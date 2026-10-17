// FR-FOG-21 (sprint 4, session-sim-7: darkvision kept the map's colours): the map image's
// greyscale copy the darkvision ring draws, made **once per image** with an offscreen canvas:
// `filter: grayscale(1)` where the 2D context supports it, else Konva's Grayscale filter on the
// pixels. Null where no canvas is available (tests, SSR) or the pixels can't be read; the ring
// then keeps the plain tint. `saturation`: the HSL check the tests use (the e2e reads the same on
// the composited stage through `canvasPixel`).
import Konva from "konva";

const copies = new WeakMap<object, HTMLCanvasElement | null>();

/** The image's greyscale copy (its natural size), cached per image; null when none can be made. */
export function greyCopy(img: HTMLImageElement): HTMLCanvasElement | null {
  const hit = copies.get(img);
  if (hit !== undefined) return hit;
  const out = makeCopy(img);
  copies.set(img, out);
  return out;
}

function makeCopy(img: HTMLImageElement): HTMLCanvasElement | null {
  if (typeof document === "undefined") return null;
  const w = img.naturalWidth || img.width;
  const h = img.naturalHeight || img.height;
  if (w === 0 || h === 0) return null;
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d");
  if (!ctx) return null;
  try {
    ctx.filter = "grayscale(1)";
    if (ctx.filter === "grayscale(1)") {
      ctx.drawImage(img, 0, 0, w, h);
      return c;
    }
    ctx.filter = "none";
    ctx.drawImage(img, 0, 0, w, h);
    const data = ctx.getImageData(0, 0, w, h);
    const grayscale = Konva.Filters.Grayscale;
    // The filter reads only the pixels, never its node.
    if (typeof grayscale !== "function") return null;
    grayscale.call(null as never, data);
    ctx.putImageData(data, 0, 0);
    return c;
  } catch {
    // A tainted canvas (cross-origin pixels): the ring keeps the plain tint.
    return null;
  }
}

/** HSL saturation (0–1) of an RGB pixel (0–255 each). */
export function saturation(r: number, g: number, b: number): number {
  const max = Math.max(r, g, b) / 255;
  const min = Math.min(r, g, b) / 255;
  const l = (max + min) / 2;
  if (max === min) return 0;
  return l > 0.5 ? (max - min) / (2 - max - min) : (max - min) / (max + min);
}
