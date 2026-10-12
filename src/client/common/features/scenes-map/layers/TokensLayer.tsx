// Tokens layer (FR-MAP-14–19): image or initials circle, name label below, DM hidden styling,
// selection ring. Konva node `name` = `map-token`, `id` = token id (AGENTS §9.5).
import { cellToPx, footprint, initials } from "@shared/scenes-map/geometry";
import type { TokenView } from "@shared/scenes-map/schemas";
import { useEffect } from "react";
import { Circle, Group, Image, Layer, Line, Text } from "react-konva";
import { retryAssetImage, useAssetImage } from "../../assets-pipeline/useAssetImage";
import { useCanvas } from "../canvas-context";

function TokenNode({ t }: { t: TokenView }) {
  const c = useCanvas();
  const { grid, colors, cam } = c;
  const img = useAssetImage(t.imageAssetId, "thumb");
  useEffect(() => {
    if (t.imageAssetId) retryAssetImage(t.imageAssetId, "thumb");
  }, [t]);
  const side = footprint(t.size) * grid.gridCellSize;
  const r = side / 2;
  const { x, y } = cellToPx(grid, t.col, t.row);
  const movable = c.canMove(t);
  const draggable = movable && c.live && c.tool === "select";
  const selected = c.selectedTokenId === t.id;
  const labelSize = Math.max(11 / cam.scale, Math.min(14, side / 5));
  const setCursor =
    (cursor: string) => (e: { target: { getStage(): { container(): HTMLElement } | null } }) => {
      const stage = e.target.getStage();
      if (stage) stage.container().style.cursor = cursor;
    };

  return (
    <Group
      name="map-token"
      id={t.id}
      x={x}
      y={y}
      draggable={draggable}
      opacity={t.hidden ? 0.45 : 1}
      onDragStart={(e) => c.token.dragStart(t, e.target)}
      onDragMove={(e) => c.token.dragMove(t, e.target)}
      onDragEnd={(e) => c.token.dragEnd(t, e.target)}
      onClick={(e) => {
        if (e.evt.button === 0) c.token.click(t);
      }}
      onDblClick={() => c.token.dblClick(t)}
      onMouseEnter={setCursor(draggable ? "grab" : "")}
      onMouseLeave={setCursor("")}
    >
      {img.image ? (
        <Group clipFunc={(ctx) => ctx.arc(r, r, r * 0.92, 0, Math.PI * 2, false)}>
          <Image image={img.image} x={0} y={0} width={side} height={side} />
        </Group>
      ) : (
        <>
          <Circle x={r} y={r} radius={r * 0.92} fill={colors.muted} />
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
      )}
      <Circle
        x={r}
        y={r}
        radius={r * 0.92}
        stroke={selected ? colors.primary : t.hidden ? colors.hidden : colors.background}
        strokeWidth={(selected ? 3 : 1.5) / cam.scale}
        dash={t.hidden ? [6 / cam.scale, 4 / cam.scale] : undefined}
      />
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
      <Text
        name="map-token-label"
        text={t.name}
        x={-side}
        y={side + 2 / cam.scale}
        width={side * 3}
        align="center"
        fontSize={labelSize}
        fill={colors.foreground}
        shadowColor={colors.background}
        shadowBlur={3 / cam.scale}
        shadowOpacity={1}
        listening={false}
      />
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
