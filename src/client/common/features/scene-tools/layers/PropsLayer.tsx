// `scn-props` canvas layer (order 20, FR-SCN-02, -18): a Konva Group in the shared `scn-objects`
// layer, below structure. Each prop draws its `display` image cover-fitted to the footprint and
// rotated about its centre, ordered by `z`, then `seq`. DM: hidden props in `visibility.hidden`
// styling (DM-only items off → not drawn), the selected prop's outline and corner handles, the
// move / resize preview. Props take pointer events only while the DM's Props tool is active (right
// click → the prop menu); otherwise a drag on one pans (FR-SCN-18). Players: visible props only.

import { PROP_HANDLES } from "@shared/scene-tools/props";
import { SCENE_PROP_TYPE, type ScenePropRecord } from "@shared/scene-tools/schemas";
import { useEffect, useMemo } from "react";
import { Group, Image, Line, Rect } from "react-konva";
import { useSync } from "../../../sync/store";
import { retryAssetImage, useAssetImage } from "../../assets-pipeline/useAssetImage";
import { useCanvas } from "../../scenes-map/canvas-context";
import { useLayerToggles } from "../../scenes-map/tool-store";
import { coverCrop, propFrame, propsToDraw } from "../prop-draw";
import { PROPS_TOOL_ID, publishProps, shownBox, usePropTool } from "../prop-tool";

/** FR-SCN-05: the "DM-only items" switch (build/scene-tools-settings writes it). */
const DM_ONLY_KEY = "dm-only";

function PropNode({ p, interactive }: { p: ScenePropRecord; interactive: boolean }) {
  const { grid, colors, cam, client } = useCanvas();
  const img = useAssetImage(p.assetId, "display");
  useEffect(() => {
    retryAssetImage(p.assetId, "display");
  }, [p]);
  const gesture = usePropTool((s) => (s.gesture?.propId === p.id ? s.gesture : null));
  const selected = usePropTool((s) => s.selectedId === p.id) && interactive;
  const f = propFrame(shownBox(p, gesture), p.rotation, grid);
  const image = img.image;
  const crop = image
    ? coverCrop(image.naturalWidth || f.drawW, image.naturalHeight || f.drawH, f.drawW, f.drawH)
    : null;
  const px = 1 / cam.scale;
  const handle = 8 * px;

  return (
    <Group
      name="scn-prop"
      id={p.id}
      hidden={p.hidden}
      locked={client === "dm" ? p.locked : undefined}
      selected={selected || undefined}
      listening={interactive}
      onMouseDown={(e) => {
        // Right press opens the menu, never the laser (the stage's handler).
        if (e.evt.button === 2) e.cancelBubble = true;
      }}
      onContextMenu={(e) => {
        e.evt.preventDefault();
        e.cancelBubble = true;
        usePropTool.setState({
          selectedId: p.id,
          gesture: null,
          menu: { propId: p.id, at: { x: e.evt.clientX, y: e.evt.clientY } },
        });
      }}
    >
      <Group x={f.cx} y={f.cy} rotation={f.rotation} opacity={p.hidden ? 0.45 : 1}>
        {image && crop ? (
          <Image
            image={image}
            crop={crop}
            x={-f.drawW / 2}
            y={-f.drawH / 2}
            width={f.drawW}
            height={f.drawH}
          />
        ) : (
          // Loading, or the broken-image placeholder (assets-pipeline §7).
          <Group
            x={-f.drawW / 2}
            y={-f.drawH / 2}
            name={img.state === "error" ? "scn-prop-error" : undefined}
          >
            <Rect
              width={f.drawW}
              height={f.drawH}
              fill={colors.muted}
              stroke={colors.border}
              strokeWidth={px}
            />
            {img.state === "error" && (
              <Line
                points={[0, 0, f.drawW, f.drawH, f.drawW, 0, 0, f.drawH]}
                stroke={colors.mutedForeground}
                strokeWidth={1.5 * px}
              />
            )}
          </Group>
        )}
      </Group>
      {/* Hit area: the whole footprint, whatever the art's alpha. */}
      <Rect x={f.x} y={f.y} width={f.width} height={f.height} fill="transparent" />
      {p.hidden && (
        // Eye-off mark and outline in `visibility.hidden` (only the DM receives hidden props).
        <Group listening={false} name="scn-prop-hidden">
          <Rect
            x={f.x}
            y={f.y}
            width={f.width}
            height={f.height}
            stroke={colors.hidden}
            strokeWidth={1.5 * px}
            dash={[4 * px, 3 * px]}
          />
          <Group x={f.x + f.width - 9 * px} y={f.y + 9 * px}>
            <Rect
              x={-8 * px}
              y={-8 * px}
              width={16 * px}
              height={16 * px}
              cornerRadius={8 * px}
              fill={colors.background}
              stroke={colors.hidden}
              strokeWidth={px}
            />
            <Line
              points={[-5 * px, 5 * px, 5 * px, -5 * px]}
              stroke={colors.hidden}
              strokeWidth={1.5 * px}
            />
          </Group>
        </Group>
      )}
      {selected && (
        <Group listening={false} name="scn-prop-selection">
          <Rect
            x={f.x}
            y={f.y}
            width={f.width}
            height={f.height}
            stroke={colors.primary}
            strokeWidth={2 * px}
            dash={p.locked ? [6 * px, 4 * px] : undefined}
          />
          {!p.locked &&
            PROP_HANDLES.map((h) => (
              <Rect
                key={h}
                name="scn-prop-handle"
                handle={h}
                x={(h.endsWith("w") ? f.x : f.x + f.width) - handle / 2}
                y={(h.startsWith("n") ? f.y : f.y + f.height) - handle / 2}
                width={handle}
                height={handle}
                fill={colors.background}
                stroke={colors.primary}
                strokeWidth={1.5 * px}
              />
            ))}
        </Group>
      )}
    </Group>
  );
}

export function ScnPropsLayer() {
  const { scene, client, activeTool, live } = useCanvas();
  const byId = useSync((s) => s.store.records[SCENE_PROP_TYPE]);
  const dmOnlyOff = useLayerToggles((s) => s.off[DM_ONLY_KEY] === true) && client === "dm";
  const drawn = useMemo(() => {
    const all = Object.values(byId ?? {}) as ScenePropRecord[];
    return propsToDraw(
      all.filter((p) => p.sceneId === scene.id),
      dmOnlyOff,
    );
  }, [byId, scene.id, dmOnlyOff]);
  const interactive = client === "dm" && live && activeTool?.id === PROPS_TOOL_ID;
  // The Props tool hits what is drawn here (DM only).
  useEffect(() => {
    if (client === "dm") publishProps(scene.id, drawn);
  }, [client, scene.id, drawn]);
  useEffect(() => () => publishProps(null, []), []);
  return (
    <Group name="scn-props">
      {drawn.map((p) => (
        <PropNode key={p.id} p={p} interactive={interactive} />
      ))}
    </Group>
  );
}
