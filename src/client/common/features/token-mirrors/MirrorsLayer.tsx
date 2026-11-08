// Token mirrors layer (FR-MIR-15), under the tokens: a mirror's art at its cell in its mode's look.
// Konva node `name` = `mir-mirror`, `id` = mirror id, attrs `mode`, `off` (DM: players see nothing);
// label `mir-label` (attr `text`). Players' mirrors never listen: they can't be picked, dragged or
// targeted. The DM drags one with the Select tool (FR-MIR-12) and right-clicks it (FR-MIR-16);
// while the DM targets, a click on a mirror is a click on its token, and no mirror drags (FR-MIR-04).
import { cellToPx, dropCell, footprint } from "@shared/scenes-map/geometry";
import { MIR_INTENTS, type MirrorView, TOKEN_MIRROR_TYPE } from "@shared/token-mirrors/schemas";
import type Konva from "konva";
import { useContext, useMemo } from "react";
import { Circle, Group, Rect, Text } from "react-konva";
import { SyncContext, useSync } from "../../sync/store";
import { useAssetImage } from "../assets-pipeline/useAssetImage";
import { DM_ONLY_SWITCH } from "../scene-tools/layer-switches";
import { useCanvas } from "../scenes-map/canvas-context";
import { toastReject, useMapIntent } from "../scenes-map/intents";
import { TokenBody } from "../scenes-map/layers/TokensLayer";
import { outlineOf } from "../scenes-map/shape";
import { TOKEN_INSET } from "../scenes-map/token-decor";
import { useLayerToggles } from "../scenes-map/tool-store";
import { useTokenVideo } from "../scenes-map/video-redraw";
import { useMirrorMenuIsland } from "./MirrorMenu";
import {
  dmLabel,
  drawsAsShadow,
  mirrorOpacity,
  mirrorTarget,
  offForPlayers,
  playerLabel,
  shownMirrorsOf,
} from "./mirror-store";

const LABEL_FONT_PX = 11;
const LABEL_PAD_PX = 4;
/** A shadow is dark on any map, whatever the theme. */
const SHADOW_FILL = "#000000";

function MirrorLabel({ text, side }: { text: string; side: number }) {
  const { colors, cam } = useCanvas();
  const px = 1 / cam.scale;
  const font = LABEL_FONT_PX * px;
  const width = text.length * font * 0.56 + 2 * LABEL_PAD_PX * px;
  const height = font + 2 * LABEL_PAD_PX * px;
  return (
    <Group
      name="mir-label"
      text={text}
      x={(side - width) / 2}
      y={side - height / 2}
      listening={false}
    >
      <Rect
        width={width}
        height={height}
        cornerRadius={height / 2}
        fill={colors.background}
        opacity={0.85}
      />
      <Text
        text={text}
        width={width}
        y={LABEL_PAD_PX * px}
        align="center"
        fontSize={font}
        fill={colors.foreground}
      />
    </Group>
  );
}

function ShadowBody({ m, side }: { m: MirrorView; side: number }) {
  const r = side / 2;
  if (outlineOf(m.shape) === "circle") {
    return <Circle x={r} y={r} radius={r * TOKEN_INSET} fill={SHADOW_FILL} />;
  }
  const inset = r * (1 - TOKEN_INSET);
  return (
    <Rect
      x={inset}
      y={inset}
      width={side - 2 * inset}
      height={side - 2 * inset}
      cornerRadius={side * 0.15}
      fill={SHADOW_FILL}
    />
  );
}

function MirrorNode({
  m,
  draggable,
  targeting,
}: {
  m: MirrorView;
  draggable: boolean;
  targeting: boolean;
}) {
  const { grid, colors, cam, client, tokens, token } = useCanvas();
  const send = useMapIntent();
  const img = useAssetImage(m.imageAssetId ?? null, "thumb");
  // FR-ANIM-06, -12: a mirror of an animated token plays too (a Shadow has no art).
  const video = useTokenVideo(m.imageAssetId, m.imageAnimated);
  const side = footprint(m.size) * grid.gridCellSize;
  const { x, y } = cellToPx(grid, m.col, m.row);
  const shadow = drawsAsShadow(m);
  const label = client === "dm" ? dmLabel(m) : playerLabel(m);
  const dm = client === "dm";
  return (
    <Group
      name="mir-mirror"
      id={m.id}
      mode={m.mode}
      off={dm ? offForPlayers(m) : undefined}
      x={x}
      y={y}
      listening={draggable || targeting}
      draggable={draggable && !targeting}
      onMouseDown={(e) => {
        // A left press drags the mirror (or targets its token): never the stage's selection box.
        // A right press goes on to the stage, which opens this layer's menu (FR-MAP-71 step 4).
        if (e.evt.button === 0) e.cancelBubble = true;
      }}
      onClick={(e) => {
        // FR-MIR-04: targeting, the mirror stands for its token (plain click, Ctrl/Shift toggle).
        if (!targeting || e.evt.button !== 0) return;
        const t = mirrorTarget(m, tokens);
        if (t) token.click(t, e.evt.ctrlKey || e.evt.metaKey || e.evt.shiftKey);
      }}
      onDragEnd={(e) => {
        const node = e.target as Konva.Node;
        const to = dropCell(grid, node.x(), node.y());
        const back = () => node.position(cellToPx(grid, m.col, m.row));
        node.position(cellToPx(grid, to.col, to.row));
        if (to.col === m.col && to.row === m.row) return;
        send(MIR_INTENTS.move, { mirrorId: m.id, ...to }).catch((err: unknown) => {
          back();
          node.getLayer()?.batchDraw();
          toastReject(err);
        });
      }}
    >
      <Rect width={side} height={side} fill="transparent" />
      <Group opacity={mirrorOpacity(m)}>
        {shadow ? (
          <ShadowBody m={m} side={side} />
        ) : (
          <TokenBody
            t={{
              shape: m.shape,
              creatureType: m.creatureType ?? null,
              name: m.name ?? "",
            }}
            side={side}
            image={video ?? img.image}
          />
        )}
      </Group>
      {dm && (
        <Rect
          name="mir-outline"
          width={side}
          height={side}
          stroke={colors.dmAccent}
          strokeWidth={1.5 / cam.scale}
          dash={[6 / cam.scale, 4 / cam.scale]}
          listening={false}
        />
      )}
      {label !== null && <MirrorLabel text={label} side={side} />}
    </Group>
  );
}

export function MirrorsLayer() {
  const { scene, client, live, tool, targeting } = useCanvas();
  const byId = useSync((s) => s.store.records[TOKEN_MIRROR_TYPE]);
  const dmOnlyOff = useLayerToggles((s) => s.off[DM_ONLY_SWITCH.key] === true) && client === "dm";
  useMirrorMenuIsland(useContext(SyncContext), client === "dm");
  const drawn = useMemo(
    () => shownMirrorsOf(byId, scene.id, dmOnlyOff),
    [byId, scene.id, dmOnlyOff],
  );
  const draggable = client === "dm" && live && tool === "select";
  // FR-MAP-33: targeting is the DM's only (always false on the player client).
  const targets = client === "dm" && targeting;
  return (
    <Group name="mir-mirrors">
      {drawn.map((m) => (
        <MirrorNode key={m.id} m={m} draggable={draggable} targeting={targets} />
      ))}
    </Group>
  );
}
