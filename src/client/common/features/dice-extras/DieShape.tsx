// A die drawn flat (FR-DICEX-42): its outline with the value centred, inline SVG in the roller's
// look (fill = `body`, number + outline = `pips`). d4 triangle, d6 square, d8 diamond, d10 kite,
// d12 pentagon, d20 flat icosahedron (hexagon + centre triangle); d100 = a tens kite + a units
// kite; other faces and dice-less sums → a round chip. Dropped (adv / dis): 40 % opacity + struck;
// offered trigger die: dashed outline, never struck. Used by the tray, the throw zone's flat
// dice, the roll popup and the game log (FR-DICE-35). `blank`: the shape without its number while
// the entry is held (FR-DICEX-49, table E).
// FR-DICE-93 (BL-57): the number is HTML text over the shape (an inline-block `<span>` pulled
// back over the `<svg>` by a negative margin; the `<svg>` stays `aria-hidden`, no `<text>`) and
// every box is inline-level, so a log line's `innerText` / a selection copy reads on one line.
// Neither `inline-flex` nor an absolutely positioned span: Chromium breaks `innerText` around both.
import { type DiceLook, STYLE_LOOK } from "@shared/dice-extras/looks";
import { cn } from "../../lib/utils";

export type DieShapeKind = "d4" | "d6" | "d8" | "d10" | "d12" | "d20" | "round";

/** The shape of a die with `faces` (null = unknown, a sum); d100 draws two d10 kites. */
export function dieShapeOf(faces: number | null): DieShapeKind {
  switch (faces) {
    case 4:
    case 6:
    case 8:
    case 10:
    case 12:
    case 20:
      return `d${faces}`;
    case 100:
      return "d10";
    default:
      return "round";
  }
}

/** d100 → tens + units faces ("40" + "0"; 100 → "00" + "0"; 7 → "00" + "7"). */
export function d100Faces(value: number): [string, string] {
  const tens = (value % 100) - (value % 10);
  return [String(tens).padStart(2, "0"), String(value % 10)];
}

/**
 * Pixel size per `size` (FR-DICEX-42): `sm` game log, `md` tray / flat zone, `lg` a roll popup
 * cell (FR-DICEX-46: 44 px, never scaled).
 */
export const DIE_PX = { sm: 18, md: 36, lg: 44 } as const;

/** The round chip per `size`. */
const ROUND: Record<keyof typeof DIE_PX, string> = {
  sm: "h-[18px] min-w-[18px] px-1 text-[10px] leading-[16px]",
  md: "h-9 min-w-9 px-1.5 text-sm leading-[32px]",
  lg: "h-11 min-w-11 px-1.5 text-base leading-[40px]",
};
/** The round chip's font px per `size` (its class), for a scaled chip. */
const ROUND_FONT: Record<keyof typeof DIE_PX, number> = { sm: 10, md: 14, lg: 16 };

// Outlines in a 100 × 100 box; `cy` = where the number sits.
const OUTLINE: Record<Exclude<DieShapeKind, "round">, { d: string; cy: number; scale?: number }> = {
  d4: { d: "M50 5 L96 91 L4 91 Z", cy: 64, scale: 0.8 },
  d6: {
    d: "M14 6 H86 A8 8 0 0 1 94 14 V86 A8 8 0 0 1 86 94 H14 A8 8 0 0 1 6 86 V14 A8 8 0 0 1 14 6 Z",
    cy: 50,
  },
  d8: { d: "M50 3 L97 50 L50 97 L3 50 Z", cy: 50, scale: 0.85 },
  d10: { d: "M50 3 L95 44 L50 97 L5 44 Z", cy: 48, scale: 0.85 },
  d12: { d: "M50 4 L95 37 L78 92 L22 92 L5 37 Z", cy: 55 },
  d20: { d: "M50 3 L91 26.5 L91 73.5 L50 97 L9 73.5 L9 26.5 Z", cy: 56 },
};
/** d20: the centre triangle and its spokes to the hexagon's corners. */
const D20_FACE = "M50 22 L76 67 L24 67 Z M50 22 L50 3 M76 67 L91 73.5 M24 67 L9 73.5";

/** Font size in box units: shorter numbers bigger. */
const fontOf = (text: string, scale = 1) =>
  (text.length <= 2 ? 46 : text.length === 3 ? 36 : 28) * scale;

function Outline({
  kind,
  text,
  copy = true,
  look,
  kept,
  offered,
  px,
}: {
  kind: Exclude<DieShapeKind, "round">;
  /** "" = blank. */
  text: string;
  /** false: the face is drawn (`data-face`) but is no text node (a d100 kite; the chip's value is). */
  copy?: boolean;
  look: DiceLook;
  kept: boolean;
  offered: boolean;
  px: number;
}) {
  const o = OUTLINE[kind];
  const stroke = { stroke: look.pips, strokeWidth: 6, strokeLinejoin: "round" as const };
  /** Box units → px, two decimals. */
  const toPx = (u: number) => Math.round(u * px) / 100;
  // The number's centre sits at `cy`: padding on one side and a shorter line, so the box stays
  // `px` high (a relative `top` would add scroll overflow under the last log line).
  const shift = 2 * toPx(o.cy - 50);
  return (
    <>
      <svg
        viewBox="0 0 100 100"
        width={px}
        height={px}
        aria-hidden
        className="inline-block overflow-visible align-top"
      >
        <path d={o.d} fill={look.body} {...stroke} strokeDasharray={offered ? "12 9" : undefined} />
        {kind === "d20" && <path d={D20_FACE} fill="none" {...stroke} strokeWidth={3} />}
        {!kept && !offered && (
          <line x1={14} y1={o.cy} x2={86} y2={o.cy} stroke={look.pips} strokeWidth={7} />
        )}
      </svg>
      {text !== "" && (
        <span
          data-face={text}
          className={cn(
            "relative box-border inline-block text-center align-top font-bold tabular-nums",
            !copy && "before:content-[attr(data-face)]",
            !kept && !offered && "line-through",
          )}
          style={{
            width: px,
            height: px,
            marginLeft: -px,
            paddingTop: Math.max(0, shift),
            paddingBottom: Math.max(0, -shift),
            lineHeight: `${px - Math.abs(shift)}px`,
            fontSize: toPx(fontOf(text, o.scale)),
            color: look.pips,
          }}
        >
          {copy ? text : null}
        </span>
      )}
    </>
  );
}

export function DieShape({
  faces,
  value,
  kept = true,
  offered = false,
  look = STYLE_LOOK.ivory,
  size = "md",
  round = false,
  part,
  negative = false,
  label,
  blank = false,
  scale = 1,
}: {
  /** Faces as rolled (a d100 part keeps 100); null = unknown → round. */
  faces: number | null;
  value: number;
  kept?: boolean;
  offered?: boolean;
  look?: DiceLook;
  size?: keyof typeof DIE_PX;
  /** A sum without per-die values (a chip), whatever `faces` says. */
  round?: boolean;
  /** One part of a d100 the caller already split (throws): a single kite with `value`. */
  part?: "tens" | "units";
  /** A subtracted die ("1d6-1d4": the d4). */
  negative?: boolean;
  /** Accessible name; default "d20: 13". */
  label?: string;
  /** Held (FR-DICEX-49): the shape in the look, no number, no `data-value`. */
  blank?: boolean;
  /** FR-DICEX-96: the tray's dice scale (× 1 = `size`'s px). */
  scale?: number;
}) {
  const kind = round ? "round" : dieShapeOf(faces);
  const px = Math.round(DIE_PX[size] * scale);
  const border = size === "sm" ? 1 : 2;
  const sign = negative ? "−" : "";
  const faceText =
    part === "tens" ? String(value).padStart(2, "0") : part === "units" ? String(value) : null;
  const texts =
    faceText !== null
      ? [faceText]
      : faces === 100 && kind === "d10"
        ? d100Faces(value)
        : [String(value)];
  const dimmed = !kept && !offered;
  // A whole d100 (two kites, "40" + "0"): the faces are drawn, the value is the text node.
  const split = texts.length > 1;
  return (
    <span
      data-testid="dicex-die"
      data-shape={kind}
      data-faces={faces ?? ""}
      data-value={blank ? undefined : value}
      data-kept={kept}
      data-offered={offered}
      role="img"
      aria-label={
        label ?? `${faces ? `d${faces}` : "dice"}: ${blank ? "rolling" : `${sign}${value}`}`
      }
      className={cn(
        "inline-block shrink-0 whitespace-nowrap align-middle leading-none",
        dimmed && "opacity-40",
      )}
    >
      {kind === "round" ? (
        <span
          className={cn(
            "inline-block rounded-full border text-center align-top font-bold tabular-nums",
            ROUND[size],
            offered && "border-dashed",
            dimmed && "line-through",
          )}
          style={{
            backgroundColor: look.body,
            color: look.pips,
            borderColor: look.pips,
            borderWidth: border,
            ...(scale !== 1 && {
              height: px,
              minWidth: px,
              fontSize: Math.round(ROUND_FONT[size] * scale),
              lineHeight: `${px - 2 * border}px`,
            }),
          }}
        >
          {!blank && sign}
          {!blank && value}
        </span>
      ) : (
        <>
          {texts.map((t, i) => (
            <Outline
              // biome-ignore lint/suspicious/noArrayIndexKey: d100 tens then units, positional
              key={i}
              kind={kind}
              text={blank ? "" : i === 0 ? `${sign}${t}` : t}
              copy={!split}
              look={look}
              kept={kept}
              offered={offered}
              px={px}
            />
          ))}
          {split && !blank && <span className="text-[0px]">{`${sign}${value}`}</span>}
        </>
      )}
    </span>
  );
}
