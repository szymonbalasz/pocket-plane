// Animated tokens, redraws (FR-ANIM-13, -14): while a layer shows ≥ 1 playing video it redraws
// its scene at ≤ 30 fps through the FX frame loop (VFX's 30 fps cap, hidden-tab stop and slow-frame
// meter: a slow machine drops the Map effects tier, which stops the videos). No video, no extra
// redraws. The hit graph is never redrawn here: a video frame changes no hit area.
import type Konva from "konva";
import { type RefObject, useEffect } from "react";
import { useAssetVideo } from "../assets-pipeline/video-pool";
import { createFxLoop, type FxLoop } from "../spell-fx/loop";
import { useVfxLevel, vfxPrefs } from "../spell-fx/prefs";

interface Registered {
  count: number;
  loop: FxLoop;
  offVisible: () => void;
}

const layers = new Map<Konva.Layer, Registered>();

/** Test hook: layers with a running registration. */
export const redrawingLayers = () => layers.size;

/** One more animated node on `layer`; returns its removal. */
export function registerVideoLayer(layer: Konva.Layer): () => void {
  let r = layers.get(layer);
  if (!r) {
    const loop = createFxLoop({
      raf: (fn) => window.requestAnimationFrame(fn),
      caf: (h) => window.cancelAnimationFrame(h as number),
      hidden: () => typeof document !== "undefined" && document.hidden,
      step: () => {},
      draw() {
        const t0 = performance.now();
        layer.drawScene();
        return performance.now() - t0;
      },
      animating: () => (layers.get(layer)?.count ?? 0) > 0,
      onFrame: () => {},
      onSlow: () => vfxPrefs().lower(),
    });
    const onVisible = () => loop.wake();
    document.addEventListener("visibilitychange", onVisible);
    r = {
      count: 0,
      loop,
      offVisible: () => document.removeEventListener("visibilitychange", onVisible),
    };
    layers.set(layer, r);
  }
  const reg = r;
  reg.count += 1;
  reg.loop.wake();
  let done = false;
  return () => {
    if (done) return;
    done = true;
    reg.count -= 1;
    if (reg.count > 0) return;
    reg.loop.stop();
    reg.offVisible();
    layers.delete(layer);
  };
}

/** Keeps `node`'s layer redrawing while `active` (a node drawing a video). */
export function useVideoRedraw(node: RefObject<Konva.Node | null>, active: boolean): void {
  useEffect(() => {
    if (!active) return;
    const layer = node.current?.getLayer();
    return layer ? registerVideoLayer(layer) : undefined;
  }, [node, active]);
}

/** FR-ANIM-14: Full and Reduced play animated tokens; Still and Off show the still frame. */
export const playsVideo = (level: string) => level === "full" || level === "reduced";

/** A token's (or mirror's) playing video, or null: draw the still `thumb` (FR-ANIM-12, -14). */
export function useTokenVideo(
  imageAssetId: string | null | undefined,
  imageAnimated: boolean | undefined,
): HTMLVideoElement | null {
  const { level } = useVfxLevel();
  return useAssetVideo(imageAssetId, imageAnimated === true && playsVideo(level));
}
