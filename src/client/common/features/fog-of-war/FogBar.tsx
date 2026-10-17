// The floating fog bar (FR-FOG-17): the Fog tool's panel beside the rail, open while the tool is
// active (not a Popover, so drawing keeps it open). Mode Reveal | Fog | Explored | Darkness, Shape
// Rectangle | Polygon | Circle, Reveal all, Fog all… (confirm), Undo (Tooltip names the step),
// Remember explored areas (Switch), Forget explored… (confirm), and in Darkness mode Clear
// darkness… (confirm). Works on the viewed scene; disabled while not live (FR-FOG-09). Also the
// keys (polygon, Delete for the selected darkness), the refusal hint, the "Free" chip while Ctrl
// is held during a gesture, and the darkness right-click menu (FR-FOG-42). V3: the View as Select
// (Players + "DM", FR-FOG-43; spinner while the load is in flight) and the DM-only hint "No vision
// set for: ‹names›".

import type { PlayerRecord } from "@shared/campaign-management/schemas";
import {
  FOG_INTENTS,
  FOG_TYPE,
  type FogClearDarknessInput,
  type FogEditKind,
  type FogForgetExploredInput,
  type FogRecord,
  type FogSetAllInput,
  type FogSetExploredInput,
  type FogUndoInput,
} from "@shared/fog-of-war/schemas";
import type { FogLayerShape } from "@shared/fog-of-war/shapes";
import {
  CircleIcon,
  CloudFogIcon,
  EraserIcon,
  EyeIcon,
  Loader2Icon,
  MapIcon,
  MoonIcon,
  PentagonIcon,
  SquareIcon,
  SunIcon,
  Trash2Icon,
  Undo2Icon,
} from "lucide-react";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Button } from "../../components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Switch,
  ToggleGroup,
  ToggleGroupItem,
} from "../../components/ui/menus";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Tooltip,
} from "../../components/ui/overlays";
import { useRecords, useSync } from "../../sync/store";
import { useDefinitions } from "../compendium/definitions";
import { useBaseKeyDown } from "../play-shell/hooks";
import { toastReject, useLive, useMapIntent } from "../scenes-map/intents";
import { type FogShapeMode, gestureKey } from "./gesture";
import { NO_VISION_PREFIX, noVisionDefinitionIds, noVisionNames } from "./no-vision";
import {
  applyFogStep,
  type FogMode,
  removeDarkness,
  setFogMode,
  setFogRejectHandler,
  useFogTool,
} from "./store";
import { setViewAs, useViewAs, VIEW_AS_DM } from "./view-as";

const SHAPE_NAMES = {
  rect: "rectangle",
  polygon: "polygon",
  circle: "circle",
  brush: "brush stroke",
} as const;

/** Sprint-2 kinds (legacy `fog.edit` forms) and Fog all / Reveal all. */
const KIND_LABELS: Partial<Record<FogEditKind, string>> = {
  "reveal-rect": "reveal rectangle",
  "reveal-polygon": "reveal polygon",
  "hide-rect": "fog rectangle",
  "hide-polygon": "fog polygon",
  "reveal-all": "reveal all",
  "fog-all": "fog all",
  "darkness-place": "darkness place",
  "darkness-move": "darkness move",
  "darkness-remove": "darkness remove",
  "darkness-clear": "darkness clear",
};

const shapeKind = (s: FogLayerShape | undefined) =>
  !s
    ? "shape"
    : "rect" in s
      ? "rect"
      : "circle" in s
        ? "circle"
        : "polygon" in s
          ? "polygon"
          : "brush";

/**
 * FR-FOG-17: "Undo: ‹reveal | fog | explored› ‹rectangle | polygon | circle | all›" or "Undo:
 * darkness ‹place | move | remove | clear›". A shape edit appended the record's last shape.
 */
export function undoHint(fog: Pick<FogRecord, "undo" | "shapes"> | undefined): string {
  const undo = fog?.undo;
  if (!undo) return "Nothing to undo";
  const fixed = KIND_LABELS[undo.kind];
  if (fixed) return `Undo: ${fixed}`;
  const op = undo.kind.replace(/-shape$/, "");
  const k = shapeKind(fog.shapes.at(-1));
  return `Undo: ${op} ${k === "shape" ? "shape" : SHAPE_NAMES[k]}`;
}

export const FOG_ALL_TITLE = "Fog the whole scene?";
export const FOG_ALL_TEXT = "Players keep only the party's tokens.";
export const FORGET_TITLE = "Forget explored areas?";
export const FORGET_TEXT = "Players lose the explored map of this scene.";
export const CLEAR_DARKNESS_TITLE = "Clear all darkness?";
export const CLEAR_DARKNESS_TEXT = "Every magical darkness area on this scene is removed.";
const HINT_MS = 1500;

const MODES: { value: FogMode; label: string; tip: string; icon: ReactNode }[] = [
  { value: "reveal", label: "Reveal", tip: "Reveal — clear fog for players", icon: <EyeIcon /> },
  { value: "fog", label: "Fog", tip: "Fog — hide map and records", icon: <CloudFogIcon /> },
  {
    value: "explored",
    label: "Explored",
    tip: "Explored — map shown, tokens hidden",
    icon: <MapIcon />,
  },
  {
    value: "darkness",
    label: "Darkness",
    tip: "Darkness — magical darkness; click one to select, drag to move",
    icon: <MoonIcon />,
  },
];
const SHAPES: { value: FogShapeMode; label: string; tip: string; icon: ReactNode }[] = [
  {
    value: "rect",
    label: "Rectangle",
    tip: "Rectangle — drag corner to corner (Ctrl: free)",
    icon: <SquareIcon />,
  },
  {
    value: "polygon",
    label: "Polygon",
    tip: "Polygon — click corners (Ctrl: free); Enter or the first corner closes",
    icon: <PentagonIcon />,
  },
  {
    value: "circle",
    label: "Circle",
    tip: "Circle — press the centre, drag the radius (Ctrl: free)",
    icon: <CircleIcon />,
  },
];

/** FR-FOG-19: the refusal Tooltip ("Edges can't cross"), at the click, for a moment. */
function GestureHintTip() {
  const hint = useFogTool((s) => s.hint);
  useEffect(() => {
    if (!hint) return;
    const id = setTimeout(() => {
      if (useFogTool.getState().hint?.n === hint.n) useFogTool.setState({ hint: null });
    }, HINT_MS);
    return () => clearTimeout(id);
  }, [hint]);
  if (!hint) return null;
  return createPortal(
    <div
      role="tooltip"
      data-testid="fog-hint"
      className="pointer-events-none fixed z-50 rounded-md bg-primary px-2 py-1 text-xs text-primary-foreground shadow-sm"
      style={{ left: hint.at.x + 12, top: hint.at.y + 12 }}
    >
      {hint.text}
    </div>,
    document.body,
  );
}

/** FOG §7: a "Free" chip at the cursor while Ctrl is held during a gesture. */
function FreeChip() {
  const show = useFogTool(
    (s) =>
      s.gesture.free &&
      ((s.gesture.draft !== null && !s.gesture.pending) ||
        (s.gesture.move !== null && !s.gesture.move.pending)),
  );
  const at = useFogTool((s) => s.cursor);
  if (!show || !at) return null;
  return createPortal(
    <div
      data-testid="fog-free"
      className="pointer-events-none fixed z-50 rounded-sm bg-secondary px-1.5 py-0.5 text-[11px] text-secondary-foreground shadow-sm"
      style={{ left: at.x + 14, top: at.y - 24 }}
    >
      Free
    </div>,
    document.body,
  );
}

/** FR-FOG-42: the darkness right-click menu (Remove). */
function DarknessMenu() {
  const menu = useFogTool((s) => s.menu);
  return (
    <DropdownMenu
      open={menu !== null}
      onOpenChange={(o) => {
        if (!o) useFogTool.setState({ menu: null });
      }}
      modal={false}
    >
      <DropdownMenuTrigger asChild>
        <span
          aria-hidden
          className="pointer-events-none fixed size-px"
          style={{ left: menu?.at.x ?? 0, top: menu?.at.y ?? 0 }}
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        collisionPadding={8}
        data-testid="fog-darkness-menu"
        data-record-id={menu?.id}
      >
        <DropdownMenuItem
          data-testid="fog-darkness-menu-remove"
          onSelect={() => {
            if (menu) removeDarkness(menu.id);
          }}
        >
          <Trash2Icon className="size-4" />
          Remove
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function Confirm({
  open,
  onOpenChange,
  testId,
  title,
  text,
  action,
  disabled,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  testId: string;
  title: string;
  text: string;
  action: string;
  disabled: boolean;
  onConfirm: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent role="alertdialog" className="max-w-sm" data-testid={`${testId}-dialog`}>
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>{text}</DialogDescription>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            data-testid={`${testId}-confirm`}
            disabled={disabled}
            onClick={() => {
              onOpenChange(false);
              onConfirm();
            }}
          >
            {action}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * FR-FOG-17 / -43: View as Select (Players + "DM"). Picking a player loads that player's rows on
 * the viewed scene (the fog layer keeps the pair); a spinner shows until the ack.
 */
function ViewAsSelect({ disabled }: { disabled: boolean }) {
  const players = useRecords<PlayerRecord>("player");
  const sorted = useMemo(
    () => [...players].sort((a, b) => a.name.localeCompare(b.name)),
    [players],
  );
  const playerId = useViewAs((s) => s.playerId);
  const loading = useSync((s) => s.viewAs.loading !== null);
  const value = playerId ?? VIEW_AS_DM;
  return (
    <Select value={value} onValueChange={(v) => setViewAs(v === VIEW_AS_DM ? null : v)}>
      {/* The Tooltip sits on a wrapper: its `data-state` would overwrite the Select's. */}
      <Tooltip content="View as — the scene as that player sees it">
        <span className="inline-flex">
          <SelectTrigger
            aria-label="View as"
            data-testid="fog-view-as"
            data-value={value}
            data-loading={loading || undefined}
            disabled={disabled}
            className="h-8 min-w-28"
          >
            {loading ? (
              <Loader2Icon className="size-4 animate-spin" />
            ) : (
              <EyeIcon className="size-4" />
            )}
            <SelectValue />
          </SelectTrigger>
        </span>
      </Tooltip>
      <SelectContent>
        <SelectItem value={VIEW_AS_DM} data-testid="fog-view-as-option" data-value={VIEW_AS_DM}>
          DM
        </SelectItem>
        {sorted.map((p) => (
          <SelectItem key={p.id} value={p.id} data-testid="fog-view-as-option" data-value={p.id}>
            {p.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** FR-FOG-17: "No vision set for: ‹names›" (DM only; hidden when every owned token has senses). */
function NoVisionHint({ sceneId }: { sceneId: string | null }) {
  const records = useSync((s) => s.store.records);
  // FR-CMP-16: an owned token of an imported definition reads it through `useDefinitions`.
  const defIds = useMemo(
    () => (sceneId === null ? [] : noVisionDefinitionIds(records, sceneId)),
    [records, sceneId],
  );
  const definitions = useDefinitions(defIds).byId;
  const names = useMemo(
    () => (sceneId === null ? [] : noVisionNames(records, sceneId, definitions)),
    [records, sceneId, definitions],
  );
  if (names.length === 0) return null;
  return (
    // Under the bar, not in it (the bar keeps one row); text only, so the map takes the pointer.
    <div
      data-testid="fog-no-vision"
      className="pointer-events-none absolute top-full left-0 mt-1 max-w-full rounded-md bg-background/85 px-2 py-1 text-xs text-muted-foreground shadow-sm backdrop-blur"
      role="note"
    >
      {NO_VISION_PREFIX}
      {names.join(", ")}
    </div>
  );
}

type Confirming = "fog-all" | "forget" | "clear-darkness" | null;

export function FogBar() {
  const live = useLive();
  const intent = useMapIntent();
  const sceneId = useFogTool((s) => s.sceneId);
  const mode = useFogTool((s) => s.mode);
  const shape = useFogTool((s) => s.shape);
  const fog = useSync((s) =>
    sceneId === null ? undefined : s.store.records[FOG_TYPE]?.[sceneId],
  ) as FogRecord | undefined;
  const undo = fog?.undo ?? null;
  const off = !live || sceneId === null;
  const [confirming, setConfirming] = useState<Confirming>(null);

  useEffect(() => setFogRejectHandler(toastReject), []);
  useBaseKeyDown((e) => {
    if (!live || e.repeat) return;
    const step = gestureKey(useFogTool.getState().gesture, e.key);
    if (!step) return;
    e.preventDefault();
    applyFogStep(step, null);
  });

  type BarInput =
    | FogSetAllInput
    | FogUndoInput
    | FogSetExploredInput
    | FogForgetExploredInput
    | FogClearDarknessInput;
  const run = (name: string, input: BarInput) => {
    intent(name, input).catch(toastReject);
  };
  const setAll = (fogged: boolean) => {
    if (sceneId !== null) run(FOG_INTENTS.setAll, { sceneId, fogged });
  };
  const undoOff = off || undo === null;
  const undoButton = (
    <Button
      size="icon"
      variant="ghost"
      className="size-8"
      aria-label="Undo"
      data-testid="fog-undo"
      data-depth={undo?.n ?? 0}
      disabled={undoOff}
      onClick={() => {
        if (sceneId !== null && undo)
          run(FOG_INTENTS.undo, { sceneId, expectedEditId: undo.editId });
      }}
    >
      <Undo2Icon className="size-4" />
    </Button>
  );
  const explored = fog?.explored ?? false;
  const sep = <div className="mx-0.5 h-6 w-px bg-border" />;

  return (
    <div
      data-testid="fog-bar"
      data-disabled={off}
      className="relative flex max-w-[min(62rem,calc(100vw-7rem))] flex-wrap items-center gap-1 rounded-md border bg-background/85 p-1 shadow-sm backdrop-blur"
    >
      {/* Each item sits in a span: the Tooltip trigger's `data-state` would hide the item's "on". */}
      <ToggleGroup
        type="single"
        value={mode}
        disabled={off}
        onValueChange={(v) => v && setFogMode({ mode: v as FogMode })}
        aria-label="Fog mode"
      >
        {MODES.map((m) => (
          <Tooltip key={m.value} content={m.tip}>
            <span className="inline-flex">
              <ToggleGroupItem
                value={m.value}
                aria-label={m.label}
                data-testid={`fog-mode-${m.value}`}
              >
                {m.icon}
              </ToggleGroupItem>
            </span>
          </Tooltip>
        ))}
      </ToggleGroup>
      {sep}
      <ToggleGroup
        type="single"
        value={shape}
        disabled={off}
        onValueChange={(v) => v && setFogMode({ shape: v as FogShapeMode })}
        aria-label="Fog shape"
      >
        {SHAPES.map((s) => (
          <Tooltip key={s.value} content={s.tip}>
            <span className="inline-flex">
              <ToggleGroupItem
                value={s.value}
                aria-label={s.label}
                data-testid={`fog-shape-${s.value}`}
              >
                {s.icon}
              </ToggleGroupItem>
            </span>
          </Tooltip>
        ))}
      </ToggleGroup>
      {sep}
      <Button
        size="sm"
        variant="ghost"
        data-testid="fog-reveal-all"
        disabled={off}
        onClick={() => setAll(false)}
      >
        <SunIcon className="size-4" />
        Reveal all
      </Button>
      <Button
        size="sm"
        variant="ghost"
        data-testid="fog-fog-all"
        disabled={off}
        onClick={() => setConfirming("fog-all")}
      >
        <CloudFogIcon className="size-4" />
        Fog all…
      </Button>
      <Tooltip content={undoHint(fog)}>
        {/* A disabled button gets no pointer events: the wrapper carries the tooltip. */}
        {undoOff ? <span className="inline-flex">{undoButton}</span> : undoButton}
      </Tooltip>
      {mode === "darkness" && (
        <Button
          size="sm"
          variant="ghost"
          data-testid="fog-clear-darkness"
          disabled={off || (fog?.darkness.length ?? 0) === 0}
          onClick={() => setConfirming("clear-darkness")}
        >
          <Trash2Icon className="size-4" />
          Clear darkness…
        </Button>
      )}
      {sep}
      <div className="flex items-center gap-1.5 px-1 text-xs">
        <Switch
          id="fog-explored-toggle"
          data-testid="fog-explored-toggle"
          checked={explored}
          disabled={off}
          onCheckedChange={(on) => {
            if (sceneId !== null) run(FOG_INTENTS.setExplored, { sceneId, on });
          }}
        />
        <label htmlFor="fog-explored-toggle">Remember explored areas</label>
      </div>
      <Tooltip content="Forget explored…">
        <Button
          size="icon"
          variant="ghost"
          className="size-8"
          aria-label="Forget explored"
          data-testid="fog-forget-explored"
          disabled={off}
          onClick={() => setConfirming("forget")}
        >
          <EraserIcon className="size-4" />
        </Button>
      </Tooltip>
      {sep}
      <ViewAsSelect disabled={off} />
      <NoVisionHint sceneId={sceneId} />
      <Confirm
        open={confirming === "fog-all"}
        onOpenChange={(o) => setConfirming(o ? "fog-all" : null)}
        testId="fog-fog-all"
        title={FOG_ALL_TITLE}
        text={FOG_ALL_TEXT}
        action="Fog all"
        disabled={off}
        onConfirm={() => setAll(true)}
      />
      <Confirm
        open={confirming === "forget"}
        onOpenChange={(o) => setConfirming(o ? "forget" : null)}
        testId="fog-forget-explored"
        title={FORGET_TITLE}
        text={FORGET_TEXT}
        action="Forget"
        disabled={off}
        onConfirm={() => {
          if (sceneId !== null) run(FOG_INTENTS.forgetExplored, { sceneId });
        }}
      />
      <Confirm
        open={confirming === "clear-darkness"}
        onOpenChange={(o) => setConfirming(o ? "clear-darkness" : null)}
        testId="fog-clear-darkness"
        title={CLEAR_DARKNESS_TITLE}
        text={CLEAR_DARKNESS_TEXT}
        action="Clear darkness"
        disabled={off}
        onConfirm={() => {
          if (sceneId !== null) run(FOG_INTENTS.clearDarkness, { sceneId });
        }}
      />
      <GestureHintTip />
      <FreeChip />
      <DarknessMenu />
    </div>
  );
}
