// AoE tool (FR-SCN-22–26, -43–45; SCN §7), both clients: a drawing tool in the canvas tool
// registry. Press and drag: the direction (cone, line, cube diagonal) or the radius (sphere,
// cylinder); release → this connection's ephemeral template (a new one replaces it; Clear or Esc
// removes it). Snapped unless Ctrl (FR-SCN-43, #375: cell centre, a big token's centre for a
// sphere / cylinder, a vertex for a cube; 15°; the origin cells highlighted while placing): Ctrl
// frees the origin to 0.01 cell and the angle to 0.1°, read on every move, with the "Free" chip
// at the cursor. Pressing an editable kept
// template's origin selects it and drags it; the selected one's end handle re-aims it (cone,
// line, cube) or resizes it (sphere, cylinder); release sends one `scn.updateTemplate`
// (FR-SCN-45). The panel: shape, size / width with ±5 nudges, label, Keep, Clear; for a selected
// kept template: resize, rotate, Delete and (DM) Hide / Reveal; DM: DM-only and "Clear templates
// on this scene" (confirm + scope, FR-SCN-44).

import {
  AOE_TEMPLATE_TYPE,
  SCN_INTENTS as S,
  TEMPLATE_ANGLE,
  TEMPLATE_LABEL_MAX,
  TEMPLATE_SHAPES,
  TEMPLATE_SIZE,
  TEMPLATE_WIDTH,
  type TemplateRecordView,
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
import { useEffect, useMemo, useState } from "react";
import { Button } from "../../components/ui/button";
import { Checkbox } from "../../components/ui/controls";
import { Switch, ToggleGroup, ToggleGroupItem } from "../../components/ui/menus";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from "../../components/ui/overlays";
import { Input, Label } from "../../components/ui/primitives";
import { ToggleTip } from "../../components/ui/toggle-tip";
import { useSendSignal, useSync } from "../../sync/store";
import { toastReject, useLive, useMapIntent } from "../scenes-map/intents";
import { useMapTool } from "../scenes-map/tool-store";
import type { CanvasToolDef, ToolPointer } from "../scenes-map/tools";
import { type AoeOrigin, aoeOrigin, mapCells, type SnapOptions } from "./aoe-snap";
import { bindAoe, cancelAoe, editTemplate, endOwn, keepOwn, showOwn, useAoe } from "./aoe-store";
import { FreeChip } from "./free-chip";
import {
  type AoeSettings,
  clearConfirmEnabled,
  clearCounts,
  clearInput,
  clearScopeCount,
  clearTitle,
  endEdit,
  type GridPoint,
  gestureTemplate,
  gridPoint,
  handleAt,
  keptView,
  movedOrigin,
  originHit,
  snapSize,
  snapWidth,
  type TemplateView,
  templateUpdate,
} from "./templates";

const SHAPE_ICONS: Record<TemplateShape, typeof CircleIcon> = {
  cone: TriangleIcon,
  sphere: CircleIcon,
  cylinder: CylinderIcon,
  cube: SquareIcon,
  line: SlashIcon,
};

/** The latest pointer event (a Ctrl press re-applies it without a move, FR-SCN-43). */
let last: ToolPointer | null = null;

const keptById = (id: string) => useAoe.getState().editable.find((t) => t.id === id) ?? null;

/** #375: the shown scene's tokens and map cells, Ctrl per event (FR-SCN-43). */
const snapOptions = (e: ToolPointer): SnapOptions => ({
  free: e.ctrl,
  tokens: useAoe.getState().tokens,
  bounds: mapCells({ ...e.grid, mapWidth: e.scene.mapWidth, mapHeight: e.scene.mapHeight }),
});

/** The last placement's raw press point: a panel shape change re-snaps the ephemeral's origin. */
let placed: { press: GridPoint; snap: SnapOptions } | null = null;

/** Shows the placement's ephemeral and highlights its origin cells (#375). */
function place(e: ToolPointer, press: GridPoint, angle: number): void {
  const snap = snapOptions(e);
  const origin = aoeOrigin(useAoe.getState().settings.shape, press, snap);
  placed = { press, snap };
  if (!sameCell(useAoe.getState().originCell, origin)) useAoe.setState({ originCell: origin.cell });
  const { settings } = useAoe.getState();
  showOwn(e.scene.id, gestureTemplate(settings, origin, e, e.grid, angle, e.ctrl, press));
}

const sameCell = (a: AoeOrigin["cell"], b: AoeOrigin | null) =>
  a?.col === b?.cell?.col && a?.row === b?.cell?.row && a?.n === b?.cell?.n;

function down(e: ToolPointer): void {
  bindAoe(e.signal, e.intent);
  last = e;
  const st = useAoe.getState();
  const p = gridPoint(e.grid, e.x, e.y);
  const onScene = st.editable.filter((t) => t.sceneId === e.scene.id);
  // FR-SCN-45: the selected template's end handle first, then any editable origin.
  const selected = onScene.find((t) => t.id === st.selectedId);
  if (selected && handleAt(selected, p, true) === "end") {
    useAoe.setState({ gesture: { kind: "end", id: selected.id, template: keptView(selected) } });
    return;
  }
  const kept = originHit(onScene, p);
  if (kept) {
    useAoe.setState({
      selectedId: kept.id,
      gesture: { kind: "move", id: kept.id, press: p, at: null },
    });
    return;
  }
  const angle = st.own?.template.angle ?? 0;
  useAoe.setState({ selectedId: null, gesture: { kind: "place", press: p, angle } });
  place(e, p, angle);
}

function move(e: ToolPointer): void {
  last = e;
  const g = useAoe.getState().gesture;
  if (!g) return;
  const p = gridPoint(e.grid, e.x, e.y);
  if (g.kind === "move") {
    const kept = keptById(g.id);
    if (!kept) return;
    const at = movedOrigin(kept.shape, g.press, p, snapOptions(e));
    if (at?.x !== g.at?.x || at?.y !== g.at?.y) {
      useAoe.setState({ gesture: { ...g, at: at && { x: at.x, y: at.y } } });
    }
    if (!sameCell(useAoe.getState().originCell, at)) {
      useAoe.setState({ originCell: at?.cell ?? null });
    }
    return;
  }
  if (g.kind === "end") {
    const kept = keptById(g.id);
    if (!kept) return;
    const template = endEdit(keptView(kept), p, e.ctrl);
    if (template.angle !== g.template.angle || template.size !== g.template.size) {
      useAoe.setState({ gesture: { ...g, template } });
    }
    return;
  }
  place(e, g.press, g.angle);
}

function up(e: ToolPointer): void {
  move(e);
  const g = useAoe.getState().gesture;
  useAoe.setState({ gesture: null, originCell: null });
  if (!g || g.kind === "place") return;
  const kept = keptById(g.id);
  if (!kept) return;
  const after: TemplateView =
    g.kind === "end" ? g.template : { ...keptView(kept), ...(g.at ?? {}) };
  const patch = templateUpdate(kept.id, kept, after);
  if (patch) e.intent(S.updateTemplate, patch).catch(toastReject);
}

/** FR-SCN-43: Ctrl pressed / released without a move re-applies the gesture. */
export function aoeCtrl(ctrl: boolean): void {
  if (last && last.ctrl !== ctrl && useAoe.getState().gesture) move({ ...last, ctrl });
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

/**
 * A panel change reshapes the ephemeral in place (same angle; same origin, re-snapped from the
 * press when the shape changes, #375: a cube's corner on a vertex, the others on a cell centre).
 */
export function applySettings(patch: Partial<AoeSettings>): void {
  const settings = { ...useAoe.getState().settings, ...patch };
  useAoe.setState({ settings });
  const own = useAoe.getState().own;
  if (!own) return;
  const t = own.template;
  const origin =
    placed && settings.shape !== t.shape ? aoeOrigin(settings.shape, placed.press, placed.snap) : t;
  const next: TemplateView = {
    ...t,
    x: origin.x,
    y: origin.y,
    shape: settings.shape,
    size: settings.size,
    width: settings.shape === "line" ? settings.width : null,
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
  const step = TEMPLATE_ANGLE.step;
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
      {isDm && sceneId && <ClearTemplates sceneId={sceneId} />}
      <p className="text-muted-foreground text-xs">
        {selected
          ? "Drag the origin to move it, the end handle to aim or resize."
          : `${shape === "cube" ? "Drag from a grid corner" : "Drag from a square"} to aim. ${TEMPLATE_SIZE.min}–${TEMPLATE_SIZE.max} ft${shape === "line" ? `, width ${TEMPLATE_WIDTH.min}–${TEMPLATE_WIDTH.max} ft` : ""}.`}
      </p>
      <p data-testid="scn-aoe-hint" className="text-muted-foreground text-xs">
        Ctrl: free placement
      </p>
      <FreeChip enabled onCtrl={aoeCtrl} />
    </div>
  );
}

/**
 * FR-SCN-44: "Clear templates on this scene" (DM): an AlertDialog "Clear N DM templates on this
 * scene?" with "Also players' kept templates (M)" unticked; Confirm (disabled while the chosen
 * scope holds 0 or while not live) sends `scn.clearTemplates`; Cancel / Esc send nothing.
 */
function ClearTemplates({ sceneId }: { sceneId: string }) {
  const [open, setOpen] = useState(false);
  const [players, setPlayers] = useState(false);
  const live = useLive();
  const byId = useSync((s) => s.store.records[AOE_TEMPLATE_TYPE]) as
    | Record<string, TemplateRecordView>
    | undefined;
  const counts = useMemo(() => clearCounts(Object.values(byId ?? {}), sceneId), [byId, sceneId]);
  const n = clearScopeCount(counts, players);
  const openDialog = (o: boolean) => {
    setOpen(o);
    if (o) setPlayers(false);
  };
  return (
    <>
      <Button
        size="sm"
        variant="ghost"
        className="justify-start text-xs"
        data-testid="scn-aoe-clear-all"
        onClick={() => openDialog(true)}
      >
        Clear templates on this scene
      </Button>
      <Dialog open={open} onOpenChange={openDialog}>
        <DialogContent role="alertdialog" className="max-w-sm" data-testid="scn-aoe-clear-dialog">
          <DialogTitle>{clearTitle(counts.dm)}</DialogTitle>
          <DialogDescription>Kept templates only; templates being placed stay.</DialogDescription>
          <div className="flex items-center gap-2">
            <Checkbox
              id="scn-aoe-clear-players"
              data-testid="scn-aoe-clear-players"
              data-count={counts.players}
              checked={players}
              onCheckedChange={(v) => setPlayers(v === true)}
            />
            <Label htmlFor="scn-aoe-clear-players" className="text-sm">
              Also players' kept templates ({counts.players})
            </Label>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              data-testid="scn-aoe-clear-cancel"
              onClick={() => openDialog(false)}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              data-testid="scn-aoe-clear-confirm"
              data-count={n}
              disabled={!clearConfirmEnabled(n, live)}
              onClick={() => {
                openDialog(false);
                editTemplate(S.clearTemplates, clearInput(sceneId, players));
                useAoe.setState({ selectedId: null });
              }}
            >
              Clear {n}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
