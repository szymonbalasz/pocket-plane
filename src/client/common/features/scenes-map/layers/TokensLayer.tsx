// Tokens layer (FR-MAP-14–19, -31, -34, -35, -43): image or initials per shape, DM hidden styling,
// selection / target ring, overlay cross and dim (inside the token's group, so they move with a
// drag and show in drag previews). Names and badges are on the labels layer (FR-MAP-42). Konva
// node `name` = `map-token`, `id` = token id, attrs `shape`, `preview` (FR-MAP-40); ring
// `map-token-ring` (attr `state`); crosses named by their overlay id.
import { cellToPx, footprint, initials } from "@shared/scenes-map/geometry";
import type { TokenView } from "@shared/scenes-map/schemas";
import { useEffect } from "react";
import { Circle, Group, Image, Layer, Line, Rect, Shape, Text } from "react-konva";
import { useStore } from "zustand";
import { retryAssetImage, useAssetImage } from "../../assets-pipeline/useAssetImage";
import { useCanvas } from "../canvas-context";
import { decorateToken, type MergedDecoration } from "../decorations";
import { CROSS_OPACITY, crossGeometry } from "../label";
import { containRect, coverCrop, initialsBackdropOf, outlineOf } from "../shape";
import type { TokenCross } from "../token-overlays";
import { tokenOverlays } from "../token-overlays";
import { toneColor } from "./tone";

const INSET = 0.92;

/** Token art per shape (FR-MAP-35); initials when there is no image (yet). */
function TokenBody({
  t,
  side,
  image,
}: {
  t: TokenView;
  side: number;
  image: HTMLImageElement | null;
}) {
  const { colors } = useCanvas();
  const r = side / 2;
  if (image) {
    const w = image.naturalWidth || side;
    const h = image.naturalHeight || side;
    if (t.shape === "none") return <Image image={image} {...containRect(w, h, side)} />;
    const cover = (
      <Image image={image} x={0} y={0} width={side} height={side} crop={coverCrop(w, h)} />
    );
    if (t.shape === "square") return cover;
    return (
      <Group clipFunc={(ctx) => ctx.arc(r, r, r * INSET, 0, Math.PI * 2, false)}>{cover}</Group>
    );
  }
  const inset = r * (1 - INSET);
  return (
    <>
      {initialsBackdropOf(t.shape) === "circle" ? (
        <Circle x={r} y={r} radius={r * INSET} fill={colors.muted} />
      ) : (
        <Rect
          x={inset}
          y={inset}
          width={side - 2 * inset}
          height={side - 2 * inset}
          cornerRadius={side * 0.15}
          fill={colors.muted}
        />
      )}
      <Text
        text={initials(t.name)}
        x={0}
        y={r - r * 0.35}
        width={side}
        align="center"
        fontSize={r * 0.7}
        fontStyle="bold"
        fill={colors.foreground}
        listening={false}
      />
    </>
  );
}

/** Selection / target ring, hidden outline or the plain border; follows the shape (none: square). */
function TokenOutline({
  t,
  side,
  state,
}: {
  t: TokenView;
  side: number;
  state: "selected" | "target" | null;
}) {
  const { colors, cam } = useCanvas();
  const r = side / 2;
  let stroke: string;
  let width = 1.5 / cam.scale;
  let dash: number[] | undefined;
  if (state === "target") {
    stroke = colors.destructive;
    width = 3 / cam.scale;
  } else if (state === "selected") {
    stroke = colors.primary;
    width = 3 / cam.scale;
  } else if (t.hidden) {
    stroke = colors.hidden;
    dash = [6 / cam.scale, 4 / cam.scale];
  } else if (t.shape === "none") {
    return null;
  } else {
    stroke = colors.background;
  }
  const common = {
    name: state ? "map-token-ring" : undefined,
    state: state ?? undefined,
    stroke,
    strokeWidth: width,
    dash,
    listening: false,
  };
  if (outlineOf(t.shape) === "circle") {
    return <Circle x={r} y={r} radius={r * INSET} {...common} />;
  }
  const inset = state && t.shape === "none" ? 0 : r * (1 - INSET) * 0.5;
  return (
    <Rect x={inset} y={inset} width={side - 2 * inset} height={side - 2 * inset} {...common} />
  );
}

/** FR-MAP-43: a translucent X over the footprint, one path so the crossing isn't darker. */
function TokenCrossMark({ t, side, cross }: { t: TokenView; side: number; cross: TokenCross }) {
  const { colors } = useCanvas();
  const g = crossGeometry(side);
  return (
    <Shape
      name={cross.id}
      id={t.id}
      tone={cross.tone}
      width={side}
      height={side}
      stroke={toneColor(colors, cross.tone)}
      strokeWidth={g.strokeWidth}
      lineCap="round"
      opacity={CROSS_OPACITY}
      listening={false}
      sceneFunc={(ctx, shape) => {
        ctx.beginPath();
        for (const [x0, y0, x1, y1] of g.segments) {
          ctx.moveTo(x0, y0);
          ctx.lineTo(x1, y1);
        }
        ctx.strokeShape(shape);
      }}
    />
  );
}

function TokenNode({ t }: { t: TokenView }) {
  const c = useCanvas();
  const { grid, colors, cam } = c;
  const img = useAssetImage(t.imageAssetId, "thumb");
  useEffect(() => {
    if (t.imageAssetId) retryAssetImage(t.imageAssetId, "thumb");
  }, [t]);
  // FR-MAP-40: another client's drag of T draws it at the previewed spot (only this group re-renders).
  const preview = useStore(c.previews, (s) => s.previews[t.id]);
  const side = footprint(t.size) * grid.gridCellSize;
  const { x, y } = preview ?? cellToPx(grid, t.col, t.row);
  const movable = c.canMove(t);
  const draggable = movable && c.live && c.tool === "select";
  const selected = c.selected.has(t.id);
  const deco: MergedDecoration = decorateToken(tokenOverlays, t, c.store, {
    client: c.client,
    selected,
    targeting: c.targeting,
  });
  const ring = deco.ring === "target" ? "target" : selected ? "selected" : null;
  const setCursor =
    (cursor: string) => (e: { target: { getStage(): { container(): HTMLElement } | null } }) => {
      const stage = e.target.getStage();
      if (stage) stage.container().style.cursor = cursor;
    };

  return (
    <Group
      name="map-token"
      id={t.id}
      shape={t.shape}
      preview={preview ? true : undefined}
      x={x}
      y={y}
      draggable={draggable}
      opacity={(t.hidden ? 0.45 : 1) * (deco.dim ? 0.5 : 1)}
      onDragStart={(e) => c.token.dragStart(t, e.target)}
      onDragMove={(e) => c.token.dragMove(t, e.target)}
      onDragEnd={(e) => c.token.dragEnd(t, e.target)}
      onClick={(e) => {
        if (e.evt.button === 0) c.token.click(t, e.evt.ctrlKey || e.evt.metaKey || e.evt.shiftKey);
      }}
      onDblClick={() => c.token.dblClick(t)}
      onMouseEnter={setCursor(draggable ? "grab" : "")}
      onMouseLeave={setCursor("")}
    >
      {/* Hit area: the whole footprint, whatever the art's alpha. */}
      <Rect width={side} height={side} fill="transparent" />
      <TokenBody t={t} side={side} image={img.image} />
      {deco.cross && <TokenCrossMark t={t} side={side} cross={deco.cross} />}
      <TokenOutline t={t} side={side} state={ring} />
      {t.hidden && (
        // Eye-off mark in `visibility.hidden` (only the DM ever receives hidden tokens).
        <Group x={side - 9 / cam.scale} y={9 / cam.scale} listening={false} name="map-token-hidden">
          <Circle
            radius={8 / cam.scale}
            fill={colors.background}
            stroke={colors.hidden}
            strokeWidth={1 / cam.scale}
          />
          <Line
            points={[-5 / cam.scale, 5 / cam.scale, 5 / cam.scale, -5 / cam.scale]}
            stroke={colors.hidden}
            strokeWidth={1.5 / cam.scale}
          />
        </Group>
      )}
    </Group>
  );
}

export function TokensLayer() {
  const { tokens } = useCanvas();
  return (
    <Layer name="tokens-layer">
      {tokens.map((t) => (
        <TokenNode key={t.id} t={t} />
      ))}
    </Layer>
  );
}
