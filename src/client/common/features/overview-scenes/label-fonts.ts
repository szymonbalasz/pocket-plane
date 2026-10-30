// FR-OVW-30: the three label fonts on the 2D canvas. A browser fetches a `themes/fonts.css` face
// only when text is drawn in its family, and a canvas gets no redraw when it lands, so the items'
// fonts load here and `useLabelFonts` bumps once they have.
import { useEffect, useState } from "react";
import { fontStack, type LabelFontKey, type MeasureText } from "./item-layout";

const fontSpec = (font: LabelFontKey, size: number) => `${size}px ${fontStack(font)}`;

let context: CanvasRenderingContext2D | null = null;

/** The text's width in units; before a font has loaded, its fallback's. */
export const measureText: MeasureText = (text, style) => {
  if (typeof document !== "undefined")
    context ??= document.createElement("canvas").getContext("2d");
  if (!context) return text.length * style.size * 0.5;
  context.font = fontSpec(style.font, style.size);
  return context.measureText(text).width;
};

/** Grows when a font of `fonts` has newly loaded: label nodes re-measure and redraw on it. */
export function useLabelFonts(fonts: readonly LabelFontKey[]): number {
  const [rev, setRev] = useState(0);
  const key = fonts.join(" ");
  useEffect(() => {
    if (key === "") return;
    const missing = key
      .split(" ")
      .map((f) => fontSpec(f as LabelFontKey, 16))
      .filter((spec) => !document.fonts.check(spec));
    if (missing.length === 0) return;
    let on = true;
    // A font that fails stays on its fallback, and there is nothing more to redraw.
    void Promise.allSettled(missing.map((spec) => document.fonts.load(spec))).then(() => {
      if (on) setRev((n) => n + 1);
    });
    return () => {
      on = false;
    };
  }, [key]);
  return rev;
}
