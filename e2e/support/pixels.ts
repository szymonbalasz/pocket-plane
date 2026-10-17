// Composited canvas pixels (FOG §13 step 25, FR-FOG-21): `canvasPixel(page, x, y)` reads the map
// stage's pixel under page point (x, y) from Konva's `stage.toCanvas()` (every layer composited,
// whatever DOM covers the canvas) → `getImageData`; `saturation` = its HSL saturation (0–1).
import type { Page } from "@playwright/test";

export interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

/** The first connected stage's composited pixel at page point (x, y). */
export async function canvasPixel(page: Page, x: number, y: number): Promise<Rgba> {
  return page.evaluate(
    ([x, y]) => {
      type KStage = {
        container(): HTMLElement;
        toCanvas(o: { pixelRatio: number }): HTMLCanvasElement;
      };
      const K = (window as unknown as { Konva: { stages: KStage[] } }).Konva;
      const st = K.stages.find((s) => s.container().isConnected) as KStage;
      const box = st.container().getBoundingClientRect();
      const c = st.toCanvas({ pixelRatio: 1 });
      const d = c
        .getContext("2d")
        ?.getImageData(Math.round(x - box.left), Math.round(y - box.top), 1, 1).data;
      return { r: d?.[0] ?? 0, g: d?.[1] ?? 0, b: d?.[2] ?? 0, a: d?.[3] ?? 0 };
    },
    [x, y] as const,
  );
}

/** HSL saturation (0–1) of a pixel. */
export function saturation({ r, g, b }: Rgba): number {
  const max = Math.max(r, g, b) / 255;
  const min = Math.min(r, g, b) / 255;
  if (max === min) return 0;
  const l = (max + min) / 2;
  return l > 0.5 ? (max - min) / (2 - max - min) : (max - min) / (max + min);
}
