// AoE tool (FR-SCN-22–26; SCN §7), both clients: a drawing tool in the canvas tool registry.
// Press at a vertex and drag: the direction (cone, line, cube quadrant) or the radius (sphere,
// cylinder); release → this connection's ephemeral template (a new one replaces it; Clear or
// Esc removes it). Pressing an editable kept template's origin selects it and drags it (one
// `scn.updateTemplate` on release). The panel: shape, size / width with ±5 nudges, label, Keep,
// Clear; for a selected kept template: resize, rotate, Delete and (DM) Hide / Reveal; DM: DM-only
// and "Clear templates".
import {
  SCN_INTENTS as S,
  TEMPLATE_ANGLE,
  TEMPLATE_LABEL_MAX,
  TEMPLATE_SHAPES,
  TEMPLATE_SIZE,
  TEMPLATE_WIDTH,
  type TemplateShape,
} from "@shared/scene-tools/schemas";
import {
  CircleIcon,
  CylinderIcon,
  EyeIcon,
  EyeOffIcon,
  MinusIcon,
  PlusIcon,
  RotateCcwIcon,
  RotateCwIcon,
  SlashIcon,
  SquareIcon,
  TargetIcon,
  Trash2Icon,
  TriangleIcon,
} from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "../../components/ui/button";
import { Switch, ToggleGroup, ToggleGroupItem } from "../../components/ui/menus";
import { Input, Label } from "../../components/ui/primitives";
import { ToggleTip } from "../../components/ui/toggle-tip";
import { useSendSignal } from "../../sync/store";
import { toastReject, useMapIntent } from "../scenes-map/intents";
import { useMapTool } from "../scenes-map/tool-store";
import type { CanvasToolDef, ToolPointer } from "../scenes-map/tools";
import { bindAoe, cancelAoe, editTemplate, endOwn, keepOwn, showOwn, useAoe } from "./aoe-store";
import {
  type AoeSettings,
  gestureTemplate,
  snapSize,
  snapWidth,
  type TemplateView,
} from "./templates";

const SHAPE_ICONS: Record<TemplateShape, typeof CircleIcon> = {
  cone: TriangleIcon,
  sphere: CircleIcon,
  cylinder: CylinderIcon,
  cube: SquareIcon,
  line: SlashIcon,
};

const sameVertex = (a: { x: number; y: number }, b: { x: number; y: number }) =>
  a.x === b.x && a.y === b.y;

function down(e: ToolPointer): void {
  bindAoe(e.signal, e.intent);
  const st = useAoe.getState();
  const kept = st.editable.find((t) => t.sceneId === e.scene.id && sameVertex(t, e.vertex));
  if (kept) {
    useAoe.setState({
      selectedId: kept.id,
      gesture: { kind: "move", id: kept.id, from: e.vertex, at: e.vertex },
    });
    return;
  }
  const angle = st.own?.template.angle ?? 0;
  useAoe.setState({ selectedId: null, gesture: { kind: "place", origin: e.vertex, angle } });
  showOwn(e.scene.id, gestureTemplate(st.settings, e.vertex, e, e.grid, angle));
}

function move(e: ToolPointer): void {
  const g = useAoe.getState().gesture;
  if (!g) return;
  if (g.kind === "move") {
    if (!sameVertex(g.at, e.vertex)) useAoe.setState({ gesture: { ...g, at: e.vertex } });
    return;
  }
  showOwn(e.scene.id, gestureTemplate(useAoe.getState().settings, g.origin, e, e.grid, g.angle));
}

function up(e: ToolPointer): void {
  const g = useAoe.getState().gesture;
  useAoe.setState({ gesture: null });
  if (g?.kind !== "move" || sameVertex(g.from, g.at)) return;
  e.intent(S.updateTemplate, { templateId: g.id, x: g.at.x, y: g.at.y }).catch(toastReject);
}

export const aoeTool: CanvasToolDef = {
  id: "aoe",
  label: "AoE templates",
  icon: TargetIcon,
  clients: ["dm", "player"],
  order: 30,
  panel: AoePanel,
  pointer: { down, move, up, cancel: cancelAoe },
};

/** A panel change reshapes the ephemeral in place (same origin; a cube keeps its quadrant). */
function applySettings(patch: Partial<AoeSettings>): void {
  const settings = { ...useAoe.getState().settings, ...patch };
  useAoe.setState({ settings });
  const own = useAoe.getState().own;
  if (!own) return;
  const t = own.template;
  const next: TemplateView = {
    ...t,
    shape: settings.shape,
    size: settings.size,
    width: settings.shape === "line" ? settings.width : null,
    angle: settings.shape === "cube" ? Math.floor(t.angle / 90) * 90 : t.angle,
    label: settings.label,
  };
  showOwn(own.sceneId, next);
}

/** A ft value with ±5 nudges, committed on blur / Enter (snapped to the range). */
function FtField({
  id,
  label,
  value,
  snap,
  onCommit,
}: {
  id: string;
  label: string;
  value: number;
  snap: (ft: number) => number;
  onCommit(ft: number): void;
}) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  const commit = (v: number) => {
    const s = Number.isFinite(v) ? snap(v) : value;
    setDraft(String(s));
    if (s !== value) onCommit(s);
  };
  return (
    <div className="flex items-center gap-1">
      <Label htmlFor={id} className="w-12 text-xs">
        {label}
      </Label>
      <Button
        size="icon"
        variant="ghost"
        className="size-7"
        aria-label={`${label} −5 ft`}
        data-testid={`${id}-dec`}
        onClick={() => commit(value - 5)}
      >
        <MinusIcon className="size-3" />
      </Button>
      <Input
        id={id}
        data-testid={id}
        type="number"
        inputMode="numeric"
        step={5}
        className="h-7 w-16 px-2 text-xs"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => commit(Number(draft))}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit(Number(draft));
        }}
      />
      <Button
        size="icon"
        variant="ghost"
        className="size-7"
        aria-label={`${label} +5 ft`}
        data-testid={`${id}-inc`}
        onClick={() => commit(value + 5)}
      >
        <PlusIcon className="size-3" />
      </Button>
      <span className="text-muted-foreground text-xs">ft</span>
    </div>
  );
}

function LabelField({ value, onCommit }: { value: string; onCommit(v: string): void }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const commit = () => {
    if (draft !== value) onCommit(draft);
  };
  return (
    <Input
      data-testid="scn-aoe-label"
      aria-label="Label"
      placeholder="Label (e.g. Fireball)"
      maxLength={TEMPLATE_LABEL_MAX}
      className="h-7 text-xs"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") commit();
      }}
    />
  );
}

export function AoePanel() {
  const client = useMapTool((s) => s.client);
  const sendSignal = useSendSignal();
  const intent = useMapIntent();
  useEffect(() => bindAoe(sendSignal, intent), [sendSignal, intent]);
  const settings = useAoe((s) => s.settings);
  const dmOnly = useAoe((s) => s.dmOnly);
  const own = useAoe((s) => s.own);
  const sceneId = useAoe((s) => s.sceneId);
  const selected = useAoe((s) => s.editable.find((t) => t.id === s.selectedId) ?? null);
  const isDm = client === "dm";
  const update = (input: Record<string, unknown>) =>
    selected && editTemplate(S.updateTemplate, { templateId: selected.id, ...input });
  const shape = selected?.shape ?? settings.shape;
  const step = shape === "cube" ? 90 : TEMPLATE_ANGLE.step;
  const rotate = (by: number) =>
    selected && update({ angle: (((selected.angle + by) % 360) + 360) % 360 });
  return (
    <div
      data-testid="scn-aoe-panel"
      className="flex w-64 flex-col gap-2 rounded-md border bg-background/95 p-2 shadow-md backdrop-blur"
    >
      <ToggleGroup
        type="single"
        value={shape}
        disabled={selected !== null}
        onValueChange={(v) => v && applySettings({ shape: v as TemplateShape })}
        aria-label="Shape"
      >
        {TEMPLATE_SHAPES.map((s) => {
          const Icon = SHAPE_ICONS[s];
          return (
            <ToggleTip key={s} content={`${s[0]?.toUpperCase()}${s.slice(1)}`}>
              <ToggleGroupItem value={s} aria-label={s} data-testid={`scn-aoe-shape-${s}`}>
                <Icon />
              </ToggleGroupItem>
            </ToggleTip>
          );
        })}
      </ToggleGroup>
      <FtField
        id="scn-aoe-size"
        label={shape === "sphere" || shape === "cylinder" ? "Radius" : "Size"}
        value={selected?.size ?? settings.size}
        snap={snapSize}
        onCommit={(size) => (selected ? update({ size }) : applySettings({ size }))}
      />
      {shape === "line" && (
        <FtField
          id="scn-aoe-width"
          label="Width"
          value={selected?.width ?? settings.width}
          snap={snapWidth}
          onCommit={(width) => (selected ? update({ width }) : applySettings({ width }))}
        />
      )}
      <LabelField
        value={selected?.label ?? settings.label}
        onCommit={(label) => (selected ? update({ label }) : applySettings({ label }))}
      />
      {selected ? (
        <div
          data-testid="scn-aoe-selected"
          data-record-id={selected.id}
          className="flex flex-col gap-1"
        >
          <p className="truncate text-muted-foreground text-xs">
            Kept: {selected.label || selected.shape}
          </p>
          <div className="flex flex-wrap gap-1">
            {shape !== "sphere" && shape !== "cylinder" && (
              <>
                <Button
                  size="icon"
                  variant="ghost"
                  className="size-8"
                  aria-label={`Rotate −${step}°`}
                  data-testid="scn-aoe-rotate-ccw"
                  onClick={() => rotate(-step)}
                >
                  <RotateCcwIcon className="size-4" />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  className="size-8"
                  aria-label={`Rotate +${step}°`}
                  data-testid="scn-aoe-rotate-cw"
                  onClick={() => rotate(step)}
                >
                  <RotateCwIcon className="size-4" />
                </Button>
              </>
            )}
            {isDm && (
              <Button
                size="sm"
                variant="outline"
                data-testid="scn-template-menu-hide"
                data-hidden={selected.hidden ? "true" : "false"}
                onClick={() => update({ hidden: !selected.hidden })}
              >
                {selected.hidden ? (
                  <EyeIcon className="size-4" />
                ) : (
                  <EyeOffIcon className="size-4" />
                )}
                {selected.hidden ? "Reveal" : "Hide"}
              </Button>
            )}
            <Button
              size="sm"
              variant="outline"
              data-testid="scn-template-menu-delete"
              onClick={() => {
                editTemplate(S.deleteTemplate, { templateId: selected.id });
                useAoe.setState({ selectedId: null });
              }}
            >
              <Trash2Icon className="size-4" />
              Delete
            </Button>
          </div>
        </div>
      ) : (
        <>
          {isDm && (
            <div className="flex items-center gap-2">
              <Switch
                id="scn-aoe-dm-only"
                data-testid="scn-aoe-dm-only"
                checked={dmOnly}
                onCheckedChange={(v) => {
                  useAoe.setState({ dmOnly: v });
                  const o = useAoe.getState().own;
                  if (o) showOwn(o.sceneId, o.template);
                }}
              />
              <Label htmlFor="scn-aoe-dm-only" className="text-xs">
                DM only
              </Label>
            </div>
          )}
          <div className="flex gap-1">
            <Button
              size="sm"
              data-testid="scn-aoe-keep"
              disabled={own === null}
              onClick={() => void keepOwn()}
            >
              Keep
            </Button>
            <Button
              size="sm"
              variant="outline"
              data-testid="scn-aoe-clear"
              disabled={own === null}
              onClick={endOwn}
            >
              Clear
            </Button>
          </div>
        </>
      )}
      {isDm && sceneId && (
        <Button
          size="sm"
          variant="ghost"
          className="justify-start text-xs"
          data-testid="scn-aoe-clear-all"
          onClick={() => {
            editTemplate(S.clearTemplates, { sceneId });
            useAoe.setState({ selectedId: null });
          }}
        >
          Clear templates on this scene
        </Button>
      )}
      <p className="text-muted-foreground text-xs">
        {selected
          ? "Drag the origin to move it."
          : `Drag from a grid point to aim. ${TEMPLATE_SIZE.min}–${TEMPLATE_SIZE.max} ft${shape === "line" ? `, width ${TEMPLATE_WIDTH.min}–${TEMPLATE_WIDTH.max} ft` : ""}.`}
      </p>
    </div>
  );
}
