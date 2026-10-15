// The Structure tool (DM, FR-SCN-08, -15): a canvas-tools entry with its panel — mode ToggleGroup
// (Wall · Door · Erase) and Undo; Ctrl+Z undoes while the tool is active. Pointer handlers:
// `structure-pointer.ts`. Drawing previews: `StructureEditPreview` on `scn-edit`.
import { BrickWallIcon, DoorClosedIcon, EraserIcon, PenLineIcon, Undo2Icon } from "lucide-react";
import { useCallback, useEffect } from "react";
import { useStore } from "zustand";
import { Button } from "../../components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "../../components/ui/menus";
import { Tooltip } from "../../components/ui/overlays";
import { ToggleTip } from "../../components/ui/toggle-tip";
import { toastReject, useLive, useMapIntent } from "../scenes-map/intents";
import type { CanvasToolDef } from "../scenes-map/tools";
import { typingTarget } from "../scenes-map/tools";
import { structurePointer } from "./structure-pointer";
import {
  type StructureMode,
  setStructureMode,
  shownStructure,
  structureTool,
} from "./structure-store";
import { undoLast, useUndoBusy, useUndoDepth } from "./undo-store";

const MODES: { mode: StructureMode; label: string; hint: string; icon: typeof PenLineIcon }[] = [
  { mode: "wall", label: "Wall", hint: "Click corners, double-click to end", icon: PenLineIcon },
  { mode: "door", label: "Door", hint: "Click both ends", icon: DoorClosedIcon },
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
