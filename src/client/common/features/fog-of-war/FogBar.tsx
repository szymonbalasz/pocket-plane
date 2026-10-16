// The floating fog bar (FR-FOG-17): the Fog tool's panel beside the rail, open while the tool is
// active (not a Popover, so drawing keeps it open). Reveal | Hide, Rectangle | Polygon, Reveal all,
// Fog all… (confirm), Undo (Tooltip names the step). Works on the viewed scene; disabled while not
// live (FR-FOG-09). Also the polygon keys (FR-FOG-19, via `useBaseKeyDown`) and the refusal hint.
import {
  FOG_INTENTS,
  FOG_TYPE,
  type FogEditKind,
  type FogRecord,
  type FogSetAllInput,
  type FogUndoInput,
} from "@shared/fog-of-war/schemas";
import {
  CloudFogIcon,
  EyeIcon,
  EyeOffIcon,
  PentagonIcon,
  SquareIcon,
  SunIcon,
  Undo2Icon,
} from "lucide-react";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Button } from "../../components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "../../components/ui/menus";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
  Tooltip,
} from "../../components/ui/overlays";
import { useSync } from "../../sync/store";
import { useBaseKeyDown } from "../play-shell/hooks";
import { toastReject, useLive, useMapIntent } from "../scenes-map/intents";
import { type FogShapeMode, gestureKey } from "./gesture";
import { applyFogStep, setFogMode, setFogRejectHandler, useFogTool } from "./store";

/** FR-FOG-17: "Undo: ‹reveal | hide› ‹rectangle | polygon | all›". */
export const UNDO_LABELS: Record<FogEditKind, string> = {
  "reveal-rect": "reveal rectangle",
  "reveal-polygon": "reveal polygon",
  "hide-rect": "hide rectangle",
  "hide-polygon": "hide polygon",
  "reveal-all": "reveal all",
  "fog-all": "hide all",
  // FOG v2 kinds (FR-FOG-17); written from V1 on.
  "reveal-shape": "reveal shape",
  "fog-shape": "fog shape",
  "explored-shape": "explored shape",
  "darkness-place": "darkness place",
  "darkness-move": "darkness move",
  "darkness-remove": "darkness remove",
  "darkness-clear": "darkness clear",
};

export function undoHint(undo: FogRecord["undo"]): string {
  return undo ? `Undo: ${UNDO_LABELS[undo.kind]}` : "Nothing to undo";
}

export const FOG_ALL_TITLE = "Fog the whole scene?";
export const FOG_ALL_TEXT = "Players keep only the party's tokens.";
const HINT_MS = 1500;

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

export function FogBar() {
  const live = useLive();
  const intent = useMapIntent();
  const sceneId = useFogTool((s) => s.sceneId);
  const op = useFogTool((s) => s.op);
  const shape = useFogTool((s) => s.shape);
  const fog = useSync((s) =>
    sceneId === null ? undefined : s.store.records[FOG_TYPE]?.[sceneId],
  ) as FogRecord | undefined;
  const undo = fog?.undo ?? null;
  const off = !live || sceneId === null;
  const [confirming, setConfirming] = useState(false);

  useEffect(() => setFogRejectHandler(toastReject), []);
  useBaseKeyDown((e) => {
    if (!live || e.repeat) return;
    const step = gestureKey(useFogTool.getState().gesture, e.key);
    if (!step) return;
    e.preventDefault();
    applyFogStep(step, null);
  });

  const run = (name: string, input: FogSetAllInput | FogUndoInput) => {
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

  return (
    <div
      data-testid="fog-bar"
      data-disabled={off}
      className="flex items-center gap-1 rounded-md border bg-background/85 p-1 shadow-sm backdrop-blur"
    >
      {/* Each item sits in a span: the Tooltip trigger's `data-state` would hide the item's "on". */}
      <ToggleGroup
        type="single"
        value={op}
        disabled={off}
        onValueChange={(v) => v && setFogMode({ op: v as "reveal" | "hide" })}
        aria-label="Fog mode"
      >
        <Tooltip content="Reveal — clear fog for players">
          <span className="inline-flex">
            <ToggleGroupItem value="reveal" aria-label="Reveal" data-testid="fog-mode-reveal">
              <EyeIcon />
            </ToggleGroupItem>
          </span>
        </Tooltip>
        <Tooltip content="Hide — cover with fog">
          <span className="inline-flex">
            <ToggleGroupItem value="hide" aria-label="Hide" data-testid="fog-mode-hide">
              <EyeOffIcon />
            </ToggleGroupItem>
          </span>
        </Tooltip>
      </ToggleGroup>
      <div className="mx-0.5 h-6 w-px bg-border" />
      <ToggleGroup
        type="single"
        value={shape}
        disabled={off}
        onValueChange={(v) => v && setFogMode({ shape: v as FogShapeMode })}
        aria-label="Fog shape"
      >
        <Tooltip content="Rectangle — drag cell to cell">
          <span className="inline-flex">
            <ToggleGroupItem value="rect" aria-label="Rectangle" data-testid="fog-shape-rect">
              <SquareIcon />
            </ToggleGroupItem>
          </span>
        </Tooltip>
        <Tooltip content="Polygon — click corners; Enter or the first corner closes">
          <span className="inline-flex">
            <ToggleGroupItem value="polygon" aria-label="Polygon" data-testid="fog-shape-polygon">
              <PentagonIcon />
            </ToggleGroupItem>
          </span>
        </Tooltip>
      </ToggleGroup>
      <div className="mx-0.5 h-6 w-px bg-border" />
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
        onClick={() => setConfirming(true)}
      >
        <CloudFogIcon className="size-4" />
        Fog all…
      </Button>
      <Tooltip content={undoHint(undo)}>
        {/* A disabled button gets no pointer events: the wrapper carries the tooltip. */}
        {undoOff ? <span className="inline-flex">{undoButton}</span> : undoButton}
      </Tooltip>
      <Dialog open={confirming} onOpenChange={setConfirming}>
        <DialogContent role="alertdialog" className="max-w-sm" data-testid="fog-fog-all-dialog">
          <DialogTitle>{FOG_ALL_TITLE}</DialogTitle>
          <DialogDescription>{FOG_ALL_TEXT}</DialogDescription>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirming(false)}>
              Cancel
            </Button>
            <Button
              data-testid="fog-fog-all-confirm"
              disabled={off}
              onClick={() => {
                setConfirming(false);
                setAll(true);
              }}
            >
              Fog all
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <GestureHintTip />
    </div>
  );
}
