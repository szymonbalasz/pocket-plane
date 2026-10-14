// Labels layer (FR-MAP-42/43, P2), above every token: per token a name pill centred on the
// footprint's bottom grid line, then the overlay badges in the same row; full opacity whatever the
// token's `dim`; DM: hidden tokens' labels styled `visibility.hidden`. A label follows its token's
// own drag and others' drag previews; only that label re-renders per frame. The moving tokens'
// labels draw last, so a dragged token's label is on top. Konva names: layer `map-labels`, name
// `map-token-label` (id = token id), badges by their test id (id = token id).
import { cellToPx, footprint } from "@shared/scenes-map/geometry";
import type { TokenView } from "@shared/scenes-map/schemas";
import { useMemo } from "react";
import { Group, Layer, Rect, Text } from "react-konva";
import { useStore } from "zustand";
import { useCanvas } from "../canvas-context";
import { decorateToken } from "../decorations";
import { labelRow, type Measure } from "../label";
import type { TokenBadge } from "../token-overlays";
import { tokenOverlays } from "../token-overlays";
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
}) {
  const { cam } = useCanvas();
  return (
    <Group name={name} id={id} x={x} y={y} icon={icon}>
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

function TokenLabel({ t }: { t: TokenView }) {
  const c = useCanvas();
  const { grid, colors, cam } = c;
  // Own drag first, then another client's preview, else the (shown) cell.
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
  const row = labelRow(t.name, deco.badges, side, grid.gridCellSize, cam.scale, measureText);
  const byId = new Map<string, TokenBadge>(deco.badges.map((b) => [b.id, b]));
  return (
    <Group x={at.x} y={at.y}>
      <Pill
        name="map-token-label"
        id={t.id}
        {...row.name}
        font={row.font}
        fill={colors.background}
        fillOpacity={0.7}
        color={t.hidden ? colors.mutedForeground : colors.foreground}
        bold={false}
        dashed={t.hidden ? colors.hidden : undefined}
      />
      {row.badges.map((p) => {
        const b = byId.get(p.id);
        if (!b) return null;
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

export function LabelsLayer() {
  const { tokens, previews } = useCanvas();
  // Changes only when a drag or preview starts / stops, not per frame.
  const movingKey = useStore(previews, (s) =>
    [s.local?.tokenId ?? "", ...Object.keys(s.previews)].join(" "),
  );
  const ordered = useMemo(() => {
    const moving = new Set(movingKey.split(" ").filter(Boolean));
    if (moving.size === 0) return tokens;
    return [...tokens.filter((t) => !moving.has(t.id)), ...tokens.filter((t) => moving.has(t.id))];
  }, [tokens, movingKey]);
  return (
    <Layer name="map-labels" listening={false}>
      {ordered.map((t) => (
        <TokenLabel key={t.id} t={t} />
      ))}
    </Layer>
  );
}
