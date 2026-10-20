// `scn-templates` canvas layer (order 35, FR-SCN-02, -21, -23): above fog, below tokens. Kept
// templates of the shown scene (`aoe-template` records), others' ephemeral templates
// (`scn.template` signals, dropped on `end`, a snapshot, leaving live or 3 s of silence; only
// the shown scene's), this connection's own ephemeral and a kept template being moved or re-aimed
// (FR-SCN-45, local preview until the commit). Each: the affected squares (> 50 % covered,
// FR-SCN-41; cut to the map) tinted in its person's player colour (kept: the placer, null = the
// DM; ephemeral: the sender; own: the own; FR-SCN-47), the shape's true outline (off-grid allowed)
// over a dark casing (FR-MAP-72) and a label pill at the origin: a colour dot + "‹label› · N
// squares", plus " · by ‹name›" while hovered (its area or its pill, FR-SCN-52) or selected.
// With the AoE tool: an origin handle on every template this client may edit, and an end handle
// on the selected one. DM: hidden / DM-only ones in `visibility.hidden` styling (OQ-SCN-41 A);
// the "DM-only items" switch (`dm-only`) drops hidden ones. No pointer events: the AoE tool works
// on the stage; the hover is read from the stage's pointer. Konva: name `scn-template`, id =
// record ID or `eph-<key>`, attrs `shape`, `cells` ("c,r c,r …"), `origin` ("x,y"), `angle`,
// `ephemeral`, `color` (the drawn hex), `by` (player id | `dm`); `map-casing` (id = template id)
// under the outline; label `scn-template-label` (id = template id; `hovered` = true while
// hovered) with `scn-template-label-dot`; handles `scn-template-handle-origin` / `-end` (id =
// template id). Mounts the right-click menu island (FR-SCN-48; the press routing is MapCanvas',
// FR-MAP-71).
import { templateCells } from "@shared/scene-tools/geometry";
import {
  AOE_TEMPLATE_TYPE,
  SCN_SIGNALS,
  type TemplateRecordView,
  TemplateSignalData,
} from "@shared/scene-tools/schemas";
import type { Grid } from "@shared/scenes-map/geometry";
import Konva from "konva";
import { type RefObject, useContext, useEffect, useMemo, useRef, useState } from "react";
import { Circle, Group, Line, Rect, Shape, Text } from "react-konva";
import { useStore } from "zustand";
import { SyncContext, useSignal, useSync } from "../../../sync/store";
import { canvasBlind } from "../../fog-of-war/blind";
import { useCanvas } from "../../scenes-map/canvas-context";
import {
  byAttr,
  CASING_COLOR,
  CASING_NAME,
  casingWidth,
  type MarkPerson,
  personName,
  placerOf,
  selfOf,
} from "../../scenes-map/mark-colors";
import { useLayerToggles } from "../../scenes-map/tool-store";
import { type AoeGesture, useAoe } from "../aoe-store";
import { useTemplateMenuIsland } from "../TemplateMenu";
import {
  canEditTemplate,
  cellsAttr,
  createEphemeralStore,
  ephemeralsOn,
  type GridPoint,
  keptView,
  mapPx,
  type PillRect,
  pickableTemplates,
  pruneEphemerals,
  receiveTemplate,
  resetEphemerals,
  type TemplateView,
  templateCaptionBy,
  templateColor,
  templateHandles,
  templateOutline,
  templateUnder,
} from "../templates";

interface Drawn {
  id: string;
  template: TemplateView;
  /** Whose template (FR-SCN-47): colour, `by` attr and "by ‹name›". */
  who: MarkPerson;
  /** Hidden for players (kept `hidden`, or a DM-only ephemeral): DM styling. */
  hidden: boolean;
  ephemeral: boolean;
  selected?: boolean;
  /** Draw the origin handle (this client may drag it with the AoE tool). */
  handle?: boolean;
  /** Draw the end handle too (the selected kept template, FR-SCN-45). */
  endHandle?: boolean;
  /** Record id of a kept template (handle node ids). */
  recordId?: string;
}

function Handle({
  name,
  id,
  at,
  stroke,
}: {
  name: string;
  id: string;
  at: GridPoint;
  stroke: string;
}) {
  const { cam, colors } = useCanvas();
  return (
    <Circle
      name={name}
      id={id}
      x={at.x}
      y={at.y}
      radius={6 / cam.scale}
      fill={colors.background}
      stroke={stroke}
      strokeWidth={2 / cam.scale}
    />
  );
}

/** Text width in map px for the label pill (Konva measures off-stage). */
let measurer: Konva.Text | null = null;
function textWidth(text: string, fontSize: number, padding: number): number {
  measurer ??= new Konva.Text({});
  measurer.setAttrs({ text, fontSize, padding });
  return measurer.width();
}

/** FR-SCN-47: the label pill: a colour dot, then the caption (+ " · by ‹name›" when `named`). */
function TemplateLabel({
  d,
  x,
  y,
  squares,
  color,
  named,
  hovered,
}: {
  d: Drawn;
  x: number;
  y: number;
  squares: number;
  color: string;
  named: boolean;
  hovered: boolean;
}) {
  const { cam, colors, store } = useCanvas();
  const s = cam.scale;
  const text = templateCaptionBy(
    d.template.label,
    squares,
    named ? personName(store, d.who) : null,
  );
  const font = 12 / s;
  const pad = 3 / s;
  const dot = 8 / s;
  const lead = pad + dot;
  const h = font + 2 * pad;
  return (
    <Group x={x} y={y} name="scn-template-label" id={d.id} {...(hovered && { hovered: true })}>
      <Rect
        width={lead + textWidth(text, font, pad)}
        height={h}
        fill={colors.background}
        opacity={0.85}
        cornerRadius={4 / s}
      />
      <Circle
        name="scn-template-label-dot"
        x={pad + dot / 2}
        y={h / 2}
        radius={dot / 2}
        fill={color}
        stroke={CASING_COLOR}
        strokeWidth={1 / s}
      />
      <Text
        x={lead}
        text={text}
        fontSize={font}
        padding={pad}
        fill={colors.foreground}
        name="scn-template-label-text"
      />
    </Group>
  );
}

function TemplateNode({ d, hovered }: { d: Drawn; hovered: boolean }) {
  const { scene, grid, cam, colors, store } = useCanvas();
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
  const handles = useMemo(() => {
    const h = templateHandles({ shape, x, y, size, width, angle });
    const g = { gridCellSize: cs, gridOffsetX: gx, gridOffsetY: gy };
    return { origin: mapPx(g, h.origin), end: mapPx(g, h.end) };
  }, [shape, x, y, size, width, angle, cs, gx, gy]);
  // FR-SCN-47: resolved per draw, so a `player` / `campaign` upsert recolours (OQ-CAMP-21).
  const stroke = templateColor(store, d.who, d.hidden, colors.hidden);
  const ox = gx + x * cs;
  const oy = gy + y * cs;
  const swPx = d.selected ? 3 : 1.5;
  const sw = swPx / cam.scale;
  const dash = d.hidden || d.ephemeral ? [6 / cam.scale, 4 / cam.scale] : undefined;
  // FR-MAP-72: the coloured outline over an opaque casing (hidden: grey styling, no casing).
  const casing = { name: CASING_NAME, id: d.id, stroke: CASING_COLOR, dash };
  const casingSw = casingWidth(swPx, cam.scale);
  return (
    <Group
      name="scn-template"
      id={d.id}
      shape={t.shape}
      cells={cellsAttr(cells)}
      origin={`${x},${y}`}
      angle={angle}
      ephemeral={d.ephemeral}
      hidden={d.hidden}
      color={stroke}
      by={byAttr(d.who)}
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
      {!d.hidden &&
        (outline.kind === "circle" ? (
          <Circle
            {...casing}
            x={outline.x}
            y={outline.y}
            radius={outline.r}
            strokeWidth={casingSw}
          />
        ) : (
          <Line {...casing} points={outline.points} closed strokeWidth={casingSw} />
        ))}
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
        <Handle
          name="scn-template-handle-origin"
          id={d.recordId ?? d.id}
          at={handles.origin}
          stroke={stroke}
        />
      )}
      {d.endHandle && (
        <Handle
          name="scn-template-handle-end"
          id={d.recordId ?? d.id}
          at={handles.end}
          stroke={stroke}
        />
      )}
      <TemplateLabel
        d={d}
        x={ox + 8 / cam.scale}
        y={oy + 8 / cam.scale}
        squares={cells.length}
        color={stroke}
        named={hovered || d.selected === true}
        hovered={hovered}
      />
    </Group>
  );
}

/** FR-SCN-45: a kept template as drawn, with its origin / end handle drag previewed locally. */
function previewOf(r: TemplateRecordView, g: AoeGesture | null): TemplateView {
  if (g?.kind === "move" && g.id === r.id && g.at) return { ...keptView(r), ...g.at };
  if (g?.kind === "end" && g.id === r.id) return { ...g.template, label: r.label };
  return keptView(r);
}

/**
 * FR-SCN-52: the template under the pointer (its area + 6 px or its label pill), read from the
 * stage's pointer (the layer takes no pointer events, so tools and press routing are unchanged).
 * No hover while a button is held (dragging). The pills are read as drawn, so the hovered one is
 * tested grown: no flicker when it widens.
 */
function useTemplateHover(
  groupRef: RefObject<Konva.Group | null>,
  drawn: readonly Drawn[],
  scale: number,
  grid: Grid,
): string | null {
  const [hovered, setHovered] = useState<string | null>(null);
  const latest = useRef({ drawn, scale, grid });
  latest.current = { drawn, scale, grid };
  useEffect(() => {
    const group = groupRef.current;
    const stage = group?.getStage();
    if (!group || !stage) return;
    const onMove = (e: Konva.KonvaEventObject<MouseEvent>) => {
      const p = stage.getPointerPosition();
      if (!p || (e.evt?.buttons ?? 0) !== 0) return setHovered(null);
      const at = group.getAbsoluteTransform().copy().invert().point(p);
      const pills: Record<string, PillRect> = {};
      for (const n of group.find(".scn-template-label")) {
        pills[n.id()] = n.getClientRect({ relativeTo: group });
      }
      const { drawn: d, scale: s, grid: g } = latest.current;
      setHovered(templateUnder(at, d, s, g, pills));
    };
    const onLeave = () => setHovered(null);
    stage.on("mousemove.scnTemplateHover", onMove);
    stage.on("mouseleave.scnTemplateHover", onLeave);
    return () => {
      stage.off("mousemove.scnTemplateHover", onMove);
      stage.off("mouseleave.scnTemplateHover", onLeave);
    };
  }, [groupRef]);
  return hovered;
}

export function ScnTemplatesLayer() {
  const { client, scene, store, myPlayerId, live, activeTool, cam, grid } = useCanvas();
  const groupRef = useRef<Konva.Group>(null);
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
  // The AoE tool edits only what this client may (FR-SCN-26) and sees: with DM-only items off,
  // hidden ones are not drawn, so not hit (FR-SCN-05).
  useEffect(() => {
    useAoe.setState({
      sceneId: scene.id,
      editable: pickableTemplates(kept, client, myPlayerId, dmOnlyOff),
    });
  }, [kept, scene.id, client, myPlayerId, dmOnlyOff]);
  useEffect(() => () => useAoe.setState({ editable: [], sceneId: null }), []);
  useTemplateMenuIsland(useContext(SyncContext));

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
  // FR-FOG-36: a blind player draws none of the others' previews (they still arrive).
  const blind = canvasBlind(client, store, scene.id, myPlayerId);
  const others = useMemo(
    () => (blind ? [] : ephemeralsOn({ byId: ephById }, scene.id)),
    [blind, ephById, scene.id],
  );

  const drawn: Drawn[] = [];
  for (const r of kept) {
    if (r.hidden && dmOnlyOff) continue;
    const editable = toolOn && canEditTemplate(r, client, myPlayerId);
    drawn.push({
      id: r.id,
      recordId: r.id,
      template: previewOf(r, gesture),
      who: placerOf(r),
      hidden: r.hidden,
      ephemeral: false,
      selected: r.id === selectedId,
      handle: editable,
      endHandle: editable && r.id === selectedId,
    });
  }
  for (const e of others) {
    if (e.dmOnly && dmOnlyOff) continue;
    drawn.push({
      id: `eph-${e.id}`,
      template: e.template,
      who: e.from,
      hidden: e.dmOnly,
      ephemeral: true,
    });
  }
  const dmOnly = useAoe((s) => s.dmOnly);
  if (own && own.sceneId === scene.id) {
    drawn.push({
      id: "eph-own",
      template: own.template,
      who: selfOf(client, myPlayerId),
      hidden: client === "dm" && dmOnly,
      ephemeral: true,
      handle: toolOn,
    });
  }
  const hovered = useTemplateHover(groupRef, drawn, cam.scale, grid);
  return (
    <Group ref={groupRef} name="scn-templates" listening={false}>
      {drawn.map((d) => (
        <TemplateNode key={d.id} d={d} hovered={hovered === d.id} />
      ))}
    </Group>
  );
}
