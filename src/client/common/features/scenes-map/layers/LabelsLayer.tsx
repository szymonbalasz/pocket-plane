// Labels layer (FR-MAP-42/43, P2), above every token and every token decoration (FR-MAP-56): per
// token a name pill centred on the footprint's bottom grid line, the overlay badges in rows just
// above it inside the footprint's width (BL-04: never over a neighbour's name; FR-MAP-57: a badge
// whose text doesn't fit is an icon chip); full opacity whatever the token's `dim`; DM: hidden
// tokens' labels styled `visibility.hidden`. A label follows its token's own drag and others'
// drag previews; only that label re-renders per frame, the layer only when the collision layout
// (`layoutLabels`, from the shown positions) changes. Hovering a token or its label draws that
// label in full, on top. The moving tokens' labels draw last, so a dragged token's label is on
// top. Konva names: Group `map-labels`, name `map-token-label` (id = token id, attrs `cut`,
// `full`), badges by their test id (id = token id; icon chips attr `compact`). Tooltips (the
// canvas' native title) for nodes with a `tip` attr: cut names, "+N" badges, icon chips, the tokens
// layer's icons. The layer keeps not listening, so clicks and drags still reach the token below.
import { cellToPx, footprint, type Grid } from "@shared/scenes-map/geometry";
import type { TokenView } from "@shared/scenes-map/schemas";
import type Konva from "konva";
import { useEffect, useMemo, useRef, useState } from "react";
import { Circle, Group, Path, Rect, Text } from "react-konva";
import { useStore } from "zustand";
import { withoutDmOnly } from "../../scene-tools/layer-switches";
import { useCanvas } from "../canvas-context";
import { chipGlyph, ICON_GRID, ICON_STROKE } from "../canvas-icons";
import { decorateToken } from "../decorations";
import type { PreviewState } from "../drag-preview";
import {
  type BadgePill,
  hoverTarget,
  LABEL_GAP_PX,
  type LabelBox,
  labelMetrics,
  labelRow,
  layoutLabels,
  type Measure,
  MORE_BADGE_ID,
  namePill,
} from "../label";
import type { TokenBadge } from "../token-overlays";
import { tokenOverlays } from "../token-overlays";
import { useLayerToggles } from "../tool-store";
import { toneColor } from "./tone";

/** Konva's default font family; labels and badges measure with the same canvas font. */
const FONT_FAMILY = "Arial";

let measureCtx: CanvasRenderingContext2D | null | undefined;

export const measureText: Measure = (text, size, bold) => {
  measureCtx ??=
    typeof document === "undefined" ? null : document.createElement("canvas").getContext("2d");
  if (!measureCtx) return [...text].length * size * 0.6;
  measureCtx.font = `${bold ? "bold " : ""}${size}px ${FONT_FAMILY}`;
  return measureCtx.measureText(text).width;
};

/** Where a token is drawn now: own drag, else another client's preview, else its shown cell (a new object: not a store selector). */
const shownAt = (t: TokenView, grid: Grid, s: PreviewState) =>
  (s.local?.tokenId === t.id ? s.local : s.previews[t.id]) ?? cellToPx(grid, t.col, t.row);

function Pill({
  name,
  id,
  x,
  y,
  width,
  height,
  text,
  font,
  fill,
  fillOpacity,
  color,
  bold,
  icon,
  dashed,
  tip,
  attrs,
}: {
  name: string;
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  text: string;
  font: number;
  fill: string;
  fillOpacity: number;
  color: string;
  bold: boolean;
  icon?: string;
  dashed?: string;
  /** Hover tooltip: a cut name in full, the "+N" badge's hidden badges. */
  tip?: string;
  attrs?: Record<string, unknown>;
}) {
  const { cam } = useCanvas();
  return (
    <Group name={name} id={id} x={x} y={y} icon={icon} tip={tip} {...attrs}>
      <Rect
        width={width}
        height={height}
        cornerRadius={height / 2}
        fill={fill}
        opacity={fillOpacity}
        stroke={dashed}
        strokeWidth={dashed ? 1 / cam.scale : 0}
        dash={dashed ? [4 / cam.scale, 3 / cam.scale] : undefined}
      />
      <Text
        text={text}
        width={width}
        height={height}
        align="center"
        verticalAlign="middle"
        fontSize={font}
        fontFamily={FONT_FAMILY}
        fontStyle={bold ? "bold" : "normal"}
        fill={color}
        wrap="none"
      />
    </Group>
  );
}

/** FR-MAP-57: a badge as an icon chip, its label as the hover tooltip; attr `compact`. */
function IconChip({ p, b, tokenId }: { p: BadgePill; b: TokenBadge; tokenId: string }) {
  const { colors } = useCanvas();
  const fill = b.tone === "neutral" ? colors.muted : toneColor(colors, b.tone);
  const color = b.tone === "neutral" ? colors.foreground : colors.background;
  const glyph = chipGlyph(b.icon, b.label);
  const r = p.width / 2;
  const inner = p.width * 0.7;
  return (
    <Group
      name={p.id}
      id={tokenId}
      x={p.x}
      y={p.y}
      icon={b.icon}
      label={b.label}
      tip={b.label}
      compact
    >
      <Circle x={r} y={r} radius={r} fill={fill} />
      {"path" in glyph ? (
        <Path
          data={glyph.path}
          x={(p.width - inner) / 2}
          y={(p.width - inner) / 2}
          scaleX={inner / ICON_GRID}
          scaleY={inner / ICON_GRID}
          stroke={color}
          strokeWidth={ICON_STROKE}
          lineCap="round"
          lineJoin="round"
        />
      ) : (
        <Text
          text={glyph.letter}
          width={p.width}
          height={p.width}
          align="center"
          verticalAlign="middle"
          fontSize={p.width * 0.6}
          fontFamily={FONT_FAMILY}
          fontStyle="bold"
          fill={color}
        />
      )}
    </Group>
  );
}

function TokenLabel({ t, cut, full }: { t: TokenView; cut: boolean; full: boolean }) {
  const c = useCanvas();
  const { grid, colors, cam } = c;
  // Own drag first, then another client's preview (stable refs: only this label re-renders).
  const moving = useStore(c.previews, (s) =>
    s.local?.tokenId === t.id ? s.local : s.previews[t.id],
  );
  const at = moving ?? cellToPx(grid, t.col, t.row);
  const side = footprint(t.size) * grid.gridCellSize;
  const deco = decorateToken(tokenOverlays, t, c.store, {
    client: c.client,
    selected: c.selected.has(t.id),
    targeting: c.targeting,
  });
  // FR-MAP-56: cut by a collision → its footprint (less the gap); hovered → the whole name.
  const row = labelRow(
    t.name,
    deco.badges,
    side,
    grid.gridCellSize,
    cam.scale,
    measureText,
    cut ? side - LABEL_GAP_PX / cam.scale : 2 * side,
  );
  const isCut = row.name.text !== t.name;
  const name = full
    ? labelRow(t.name, [], side, grid.gridCellSize, cam.scale, measureText, Infinity).name
    : row.name;
  const byId = new Map<string, TokenBadge>(deco.badges.map((b) => [b.id, b]));
  return (
    <Group x={at.x} y={at.y}>
      <Pill
        name="map-token-label"
        id={t.id}
        {...name}
        font={row.font}
        fill={colors.background}
        fillOpacity={full ? 0.9 : 0.7}
        color={t.hidden ? colors.mutedForeground : colors.foreground}
        bold={false}
        dashed={t.hidden ? colors.hidden : undefined}
        // P3 glitch 10: a cut name's full text is also the canvas' title on hover.
        tip={isCut ? t.name : undefined}
        attrs={{ cut: isCut, full }}
      />
      {row.badges.map((p) => {
        // BL-04: the "+N" for badges that don't fit above the name; hover lists them.
        if (p.id === MORE_BADGE_ID) {
          return (
            <Pill
              key={p.id}
              {...p}
              name={p.id}
              id={t.id}
              font={row.font}
              fill={colors.muted}
              fillOpacity={1}
              color={colors.foreground}
              bold
              tip={p.full}
            />
          );
        }
        const b = byId.get(p.id);
        if (!b) return null;
        if (p.compact) return <IconChip key={p.id} p={p} b={b} tokenId={t.id} />;
        return (
          <Pill
            key={p.id}
            {...p}
            name={p.id}
            id={t.id}
            font={row.font}
            fill={b.tone === "neutral" ? colors.muted : toneColor(colors, b.tone)}
            fillOpacity={1}
            color={b.tone === "neutral" ? colors.foreground : colors.background}
            bold
            icon={b.icon}
          />
        );
      })}
    </Group>
  );
}

/**
 * The stage's pointer moves (the layer stays non-listening): `hover(p)` gets the pointer in map
 * px (null on leave); the canvas' title shows the `tip` of the topmost node under the pointer.
 */
function usePointerHover(
  layer: React.RefObject<Konva.Group | null>,
  hover: React.RefObject<(p: { x: number; y: number } | null) => void>,
) {
  useEffect(() => {
    const stage = layer.current?.getStage();
    if (!stage) return;
    const el = stage.container();
    let shown: string | null = null;
    const set = (tip: string | null) => {
      if (tip === shown) return;
      if (tip) el.title = tip;
      else if (shown !== null) el.removeAttribute("title");
      shown = tip;
    };
    const move = () => {
      const p = stage.getPointerPosition();
      hover.current?.(layer.current?.getRelativePointerPosition() ?? null);
      // Tips in the objects layer: cut names, badges and the tokens' icons.
      const nodes = layer.current?.getLayer()?.find((n: Konva.Node) => Boolean(n.getAttr("tip")));
      const hit = p
        ? (nodes ?? []).findLast((n) => {
            const r = n.getClientRect();
            return p.x >= r.x && p.x <= r.x + r.width && p.y >= r.y && p.y <= r.y + r.height;
          })
        : undefined;
      set((hit?.getAttr("tip") as string | undefined) ?? null);
    };
    const leave = () => {
      hover.current?.(null);
      set(null);
    };
    stage.on("pointermove.labels", move);
    stage.on("pointerleave.labels", leave);
    return () => {
      stage.off("pointermove.labels");
      stage.off("pointerleave.labels");
      set(null);
    };
  }, [layer, hover]);
}

export function LabelsLayer() {
  const { tokens: all, previews, client, grid, cam } = useCanvas();
  // FR-SCN-05: the DM's "DM-only items" switch off → hidden tokens' labels go with them.
  const off = useLayerToggles((s) => s.off);
  const tokens = useMemo(() => withoutDmOnly(all, client, off), [all, client, off]);
  const layer = useRef<Konva.Group>(null);
  const cell = grid.gridCellSize;
  const m = labelMetrics(cell, cam.scale);
  const gap = LABEL_GAP_PX / cam.scale;
  // FR-MAP-42 widths (≤ 2 × the footprint), per token.
  const natural = useMemo(() => {
    const mm = labelMetrics(cell, cam.scale);
    return new Map(
      tokens.map((t) => {
        const side = footprint(t.size) * cell;
        return [t.id, { side, width: namePill(t.name, 2 * side, mm, measureText).width }];
      }),
    );
  }, [tokens, cell, cam.scale]);
  const boxes = (s: PreviewState): LabelBox[] =>
    tokens.map((t) => {
      const n = natural.get(t.id) ?? { side: cell, width: 0 };
      const at = shownAt(t, grid, s);
      return { id: t.id, x: at.x, bottom: at.y + n.side, side: n.side, width: n.width };
    });
  // FR-MAP-56: the cut labels, from the shown positions; re-renders only when that set changes.
  const cutKey = useStore(previews, (s) =>
    [...layoutLabels(boxes(s), m.pillH, gap)]
      .filter(([, f]) => f.cut)
      .map(([id]) => id)
      .sort()
      .join(" "),
  );
  const cut = useMemo(() => new Set(cutKey.split(" ").filter(Boolean)), [cutKey]);
  const [hovered, setHovered] = useState<string | null>(null);
  const hover = useRef<(p: { x: number; y: number } | null) => void>(() => {});
  hover.current = (p) => {
    if (!p) return setHovered(null);
    const all = boxes(previews.getState());
    const fits = layoutLabels(all, m.pillH, gap);
    // As drawn: the hovered label in full and on top, so moving along it keeps it.
    const drawn = all.map((b, i) => {
      const name = tokens[i]?.name ?? "";
      const w = b.id === hovered ? namePill(name, Infinity, m, measureText).width : undefined;
      return { ...b, drawn: w ?? fits.get(b.id)?.width ?? b.width };
    });
    drawn.sort((a, b) => Number(a.id === hovered) - Number(b.id === hovered));
    setHovered(hoverTarget(p, drawn, m.pillH));
  };
  usePointerHover(layer, hover);
  // Changes only when a drag or preview starts / stops, not per frame.
  const movingKey = useStore(previews, (s) =>
    [s.local?.tokenId ?? "", ...Object.keys(s.previews)].join(" "),
  );
  const ordered = useMemo(() => {
    const moving = new Set(movingKey.split(" ").filter(Boolean));
    const rank = (t: TokenView) => (t.id === hovered ? 2 : moving.has(t.id) ? 1 : 0);
    if (moving.size === 0 && hovered === null) return tokens;
    return [...tokens].sort((a, b) => rank(a) - rank(b));
  }, [tokens, movingKey, hovered]);
  return (
    <Group ref={layer} name="map-labels" listening={false}>
      {ordered.map((t) => (
        <TokenLabel key={t.id} t={t} cut={cut.has(t.id)} full={t.id === hovered} />
      ))}
    </Group>
  );
}
