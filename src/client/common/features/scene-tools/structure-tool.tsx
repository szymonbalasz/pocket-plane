// The Structure tool (DM, FR-SCN-08, -15): a canvas-tools entry with its panel — mode ToggleGroup
// (Wall · Door · Erase) and Undo; Ctrl+Z undoes while the tool is active. Pointer handlers:
// `structure-pointer.ts`. Drawing previews: `StructureEditPreview` on `scn-edit`. Sprint 3: the
// "Free" chip (`scn-free-chip`) follows the cursor over the canvas while Ctrl is held in Wall /
// Door mode (FR-SCN-08).
import { BrickWallIcon, DoorClosedIcon, EraserIcon, PenLineIcon, Undo2Icon } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useStore } from "zustand";
import { Button } from "../../components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "../../components/ui/menus";
import { Tooltip } from "../../components/ui/overlays";
import { ToggleTip } from "../../components/ui/toggle-tip";
import { toastReject, useLive, useMapIntent } from "../scenes-map/intents";
import type { CanvasToolDef } from "../scenes-map/tools";
import { typingTarget } from "../scenes-map/tools";
import { structureCtrl, structurePointer } from "./structure-pointer";
import {
  type StructureMode,
  setStructureMode,
  shownStructure,
  structureTool,
} from "./structure-store";
import { undoLast, useUndoBusy, useUndoDepth } from "./undo-store";

/** FR-SCN-08: the "Free" chip shows in Wall / Door mode while Ctrl is held over the canvas. */
export function freeChipShown(mode: StructureMode, ctrl: boolean, overCanvas: boolean): boolean {
  return ctrl && overCanvas && (mode === "wall" || mode === "door");
}

const overCanvas = (t: EventTarget | null) =>
  (t as Element | null)?.closest?.('[data-testid="map-canvas"]') != null;

/** FR-SCN-08: the "Free" chip at the cursor; Ctrl presses also re-pick the hover point. */
function FreeChip() {
  const mode = useStore(structureTool, (s) => s.mode);
  const [ctrl, setCtrl] = useState(false);
  const [at, setAt] = useState<{ x: number; y: number } | null>(null);
  useEffect(() => {
    const move = (e: PointerEvent) => {
      setCtrl(e.ctrlKey || e.metaKey);
      setAt(overCanvas(e.target) ? { x: e.clientX, y: e.clientY } : null);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key !== "Control" && e.key !== "Meta") return;
      const c = e.type === "keydown";
      setCtrl(c);
      structureCtrl(c);
    };
    const blur = () => {
      setCtrl(false);
      structureCtrl(false);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("keydown", key);
    window.addEventListener("keyup", key);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("keydown", key);
      window.removeEventListener("keyup", key);
      window.removeEventListener("blur", blur);
    };
  }, []);
  if (!at || !freeChipShown(mode, ctrl, true)) return null;
  return createPortal(
    <div
      data-testid="scn-free-chip"
      className="pointer-events-none fixed z-50 rounded-full border bg-background/90 px-2 py-0.5 text-xs font-medium shadow-sm"
      style={{ left: at.x + 14, top: at.y + 14 }}
    >
      Free
    </div>,
    document.body,
  );
}

const MODES: { mode: StructureMode; label: string; hint: string; icon: typeof PenLineIcon }[] = [
  {
    mode: "wall",
    label: "Wall",
    hint: "Click corners, double-click to end; hold Ctrl for a free point",
    icon: PenLineIcon,
  },
  {
    mode: "door",
    label: "Door",
    hint: "Click both ends; hold Ctrl for a free point",
    icon: DoorClosedIcon,
  },
  {
    mode: "erase",
    label: "Erase",
    hint: "Click a wall or door; Ctrl-drag a box",
    icon: EraserIcon,
  },
];

/** FR-SCN-15: undo the shown scene's last structure or prop edit; a reject toasts. */
export function useScnUndo(): { undo(): void; disabled: boolean } {
  const send = useMapIntent();
  const live = useLive();
  const sceneId = useStore(shownStructure, (s) => s.sceneId);
  const depth = useUndoDepth(sceneId);
  const busy = useUndoBusy();
  const undo = useCallback(() => {
    if (!sceneId || !live) return;
    void undoLast(send, sceneId, toastReject);
  }, [send, sceneId, live]);
  return { undo, disabled: !live || busy || depth === 0 };
}

export function StructurePanel() {
  const mode = useStore(structureTool, (s) => s.mode);
  const { undo, disabled } = useScnUndo();
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== "z" || e.shiftKey) return;
      if (typingTarget(e.target)) return;
      e.preventDefault();
      undo();
    };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, [undo]);
  return (
    <div
      data-testid="scn-structure-panel"
      className="flex items-center gap-1 rounded-md border bg-background/90 p-1 shadow-sm backdrop-blur"
    >
      <ToggleGroup
        type="single"
        value={mode}
        onValueChange={(v) => v && setStructureMode(v as StructureMode)}
        aria-label="Structure mode"
      >
        {MODES.map((m) => (
          <ToggleTip key={m.mode} content={`${m.label} — ${m.hint}`}>
            <ToggleGroupItem
              value={m.mode}
              aria-label={m.label}
              data-testid={`scn-structure-mode-${m.mode}`}
            >
              <m.icon />
            </ToggleGroupItem>
          </ToggleTip>
        ))}
      </ToggleGroup>
      <Tooltip content="Undo (Ctrl+Z)">
        <span className="inline-flex">
          <Button
            size="icon"
            variant="ghost"
            className="size-9"
            aria-label="Undo"
            data-testid="scn-undo"
            disabled={disabled}
            onClick={undo}
          >
            <Undo2Icon className="size-4" />
          </Button>
        </span>
      </Tooltip>
      <FreeChip />
    </div>
  );
}

export const structureToolDef: CanvasToolDef = {
  id: "structure",
  label: "Structure",
  icon: BrickWallIcon,
  clients: ["dm"],
  order: 10,
  panel: StructurePanel,
  cursor: "crosshair",
  pointer: structurePointer(toastReject),
};
