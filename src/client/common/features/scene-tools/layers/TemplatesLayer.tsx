// `scn-templates` canvas layer (order 35, FR-SCN-02, -21, -23): above fog, below tokens. Kept
// templates of the shown scene (`aoe-template` records), others' ephemeral templates
// (`scn.template` signals, dropped on `end`, a snapshot, leaving live or 3 s of silence; only
// the shown scene's), this connection's own ephemeral and a kept template being moved. Each:
// the affected squares (cut to the map) tinted in the placer's role accent, the shape's outline
// and "‹label› · N squares" at the origin. DM: hidden / DM-only ones in `visibility.hidden`
// styling; the "DM-only items" switch (`dm-only`) drops hidden ones. No pointer events: the AoE
// tool works on the stage. Konva: name `scn-template`, id = record ID or `eph-<key>`, attrs
// `shape`, `cells`, `ephemeral`.
import { templateCells } from "@shared/scene-tools/geometry";
import {
  AOE_TEMPLATE_TYPE,
  SCN_SIGNALS,
  type TemplateRecordView,
  TemplateSignalData,
} from "@shared/scene-tools/schemas";
import { useEffect, useMemo, useState } from "react";
import { Circle, Group, Label, Layer, Line, Shape, Tag, Text } from "react-konva";
import { useStore } from "zustand";
import { useSignal, useSync } from "../../../sync/store";
import { useCanvas } from "../../scenes-map/canvas-context";
import { useLayerToggles } from "../../scenes-map/tool-store";
import { useAoe } from "../aoe-store";
import {
  canEditTemplate,
  createEphemeralStore,
  ephemeralsOn,
  pruneEphemerals,
  receiveTemplate,
  resetEphemerals,
  type TemplateView,
  templateCaption,
  templateOutline,
} from "../templates";

interface Drawn {
  id: string;
  template: TemplateView;
  accent: string;
  /** Hidden for players (kept `hidden`, or a DM-only ephemeral): DM styling. */
  hidden: boolean;
  ephemeral: boolean;
  selected?: boolean;
  /** Draw the origin handle (this client may drag it with the AoE tool). */
  handle?: boolean;
}

function TemplateNode({ d }: { d: Drawn }) {
  const { scene, grid, cam, colors } = useCanvas();
  const t = d.template;
  const { shape, x, y, size, width, angle } = t;
  const { gridCellSize: cs, gridOffsetX: gx, gridOffsetY: gy } = grid;
  const { mapWidth, mapHeight } = scene;
  // FR-SCN-21: memoised per template / grid change.
  const cells = useMemo(
    () =>
      templateCells(
        { shape, x, y, size, width, angle },
        { gridCellSize: cs, gridOffsetX: gx, gridOffsetY: gy, mapWidth, mapHeight },
        { cut: true },
      ),
    [shape, x, y, size, width, angle, cs, gx, gy, mapWidth, mapHeight],
  );
  const outline = useMemo(
    () =>
      templateOutline(
        { shape, x, y, size, width, angle },
        { gridCellSize: cs, gridOffsetX: gx, gridOffsetY: gy },
      ),
    [shape, x, y, size, width, angle, cs, gx, gy],
  );
  const stroke = d.hidden ? colors.hidden : d.accent;
  const ox = gx + x * cs;
  const oy = gy + y * cs;
  const sw = (d.selected ? 3 : 1.5) / cam.scale;
  const dash = d.hidden || d.ephemeral ? [6 / cam.scale, 4 / cam.scale] : undefined;
  return (
    <Group
      name="scn-template"
      id={d.id}
      shape={t.shape}
      cells={cells.length}
      ephemeral={d.ephemeral}
      hidden={d.hidden}
      listening={false}
      opacity={d.hidden ? 0.6 : 1}
    >
      <Shape
        fill={stroke}
        opacity={0.22}
        sceneFunc={(ctx, shape) => {
          ctx.beginPath();
          for (const [c, r] of cells) {
            ctx.rect(gx + c * cs, gy + r * cs, cs, cs);
          }
          ctx.fillShape(shape);
        }}
      />
      {outline.kind === "circle" ? (
        <Circle
          x={outline.x}
          y={outline.y}
          radius={outline.r}
          stroke={stroke}
          strokeWidth={sw}
          dash={dash}
        />
      ) : (
        <Line points={outline.points} closed stroke={stroke} strokeWidth={sw} dash={dash} />
      )}
      {d.handle && (
        <Circle
          name="scn-template-origin"
          x={ox}
          y={oy}
          radius={6 / cam.scale}
          fill={colors.background}
          stroke={stroke}
          strokeWidth={2 / cam.scale}
        />
      )}
      <Label x={ox + 8 / cam.scale} y={oy + 8 / cam.scale} name="scn-template-label">
        <Tag fill={colors.background} opacity={0.85} cornerRadius={4 / cam.scale} />
        <Text
          text={templateCaption(t.label, cells.length)}
          fontSize={12 / cam.scale}
          padding={3 / cam.scale}
          fill={colors.foreground}
          name="scn-template-label-text"
        />
      </Label>
    </Group>
  );
}

const keptView = (r: TemplateRecordView): TemplateView => ({
  shape: r.shape,
  x: r.x,
  y: r.y,
  size: r.size,
  width: r.width,
  angle: r.angle,
  label: r.label,
});

export function ScnTemplatesLayer() {
  const { client, scene, store, colors, myPlayerId, live, activeTool } = useCanvas();
  const dmOnlyOff = useLayerToggles((s) => s.off["dm-only"] === true);
  const own = useAoe((s) => s.own);
  const gesture = useAoe((s) => s.gesture);
  const selectedId = useAoe((s) => s.selectedId);
  const toolOn = activeTool?.id === "aoe";

  // ---- kept templates of the shown scene ----
  const byId = store.records[AOE_TEMPLATE_TYPE] as Record<string, TemplateRecordView> | undefined;
  const kept = useMemo(
    () => Object.values(byId ?? {}).filter((r) => r.sceneId === scene.id),
    [byId, scene.id],
  );
  // The AoE tool edits only what this client may (FR-SCN-26) and sees.
  useEffect(() => {
    useAoe.setState({
      sceneId: scene.id,
      editable: kept.filter((r) => canEditTemplate(r, client, myPlayerId)),
    });
  }, [kept, scene.id, client, myPlayerId]);
  useEffect(() => () => useAoe.setState({ editable: [], sceneId: null }), []);

  // ---- others' ephemerals (FR-SCN-23) ----
  const [eph] = useState(createEphemeralStore);
  useSignal(SCN_SIGNALS.template, (s) => {
    const d = TemplateSignalData.safeParse(s.data);
    if (d.success) receiveTemplate(eph, s.from, d.data, performance.now());
  });
  // A snapshot (a new scene window) or leaving live drops them all.
  const sceneWindow = useSync((s) => s.scenes);
  // biome-ignore lint/correctness/useExhaustiveDependencies: every snapshot replaces `scenes`.
  useEffect(() => resetEphemerals(eph), [eph, sceneWindow]);
  useEffect(() => {
    if (!live) resetEphemerals(eph);
  }, [eph, live]);
  const ephById = useStore(eph, (s) => s.byId);
  const anyEph = Object.keys(ephById).length > 0;
  useEffect(() => {
    if (!anyEph) return;
    const h = setInterval(() => pruneEphemerals(eph, performance.now()), 500);
    return () => clearInterval(h);
  }, [eph, anyEph]);
  const others = useMemo(() => ephemeralsOn({ byId: ephById }, scene.id), [ephById, scene.id]);

  const accent = (role: "dm" | "player") => (role === "dm" ? colors.dmAccent : colors.playerAccent);
  const drawn: Drawn[] = [];
  for (const r of kept) {
    if (r.hidden && dmOnlyOff) continue;
    const moving = gesture?.kind === "move" && gesture.id === r.id ? gesture.at : null;
    drawn.push({
      id: r.id,
      template: moving ? { ...keptView(r), x: moving.x, y: moving.y } : keptView(r),
      accent: accent(r.placedByPlayerId === null ? "dm" : "player"),
      hidden: r.hidden,
      ephemeral: false,
      selected: r.id === selectedId,
      handle: toolOn && canEditTemplate(r, client, myPlayerId),
    });
  }
  for (const e of others) {
    if (e.dmOnly && dmOnlyOff) continue;
    drawn.push({
      id: `eph-${e.id}`,
      template: e.template,
      accent: accent(e.role),
      hidden: e.dmOnly,
      ephemeral: true,
    });
  }
  const dmOnly = useAoe((s) => s.dmOnly);
  if (own && own.sceneId === scene.id) {
    drawn.push({
      id: "eph-own",
      template: own.template,
      accent: accent(client),
      hidden: client === "dm" && dmOnly,
      ephemeral: true,
      handle: toolOn,
    });
  }
  return (
    <Layer name="scn-templates" listening={false}>
      {drawn.map((d) => (
        <TemplateNode key={d.id} d={d} />
      ))}
    </Layer>
  );
}
