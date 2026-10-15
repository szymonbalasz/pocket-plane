// Props tool (DM, FR-SCN-06, -15–17; SCN §7): rail entry, panel ("Choose image…" + Undo) and the
// prop menu (right-click a prop: Rotate 90°, Hide / Reveal, Lock / Unlock, To front / To back,
// Duplicate, Image…, Delete). Ctrl+Z undoes while the tool is active. The asset picker itself is
// DM code: the DM host opens it when `picking` is set (`@dm/features/scene-tools/props-host`).
import type { AssetRecord } from "@shared/assets-pipeline/schemas";
import type { ScenePropRecord } from "@shared/scene-tools/schemas";
import {
  ArrowDownToLineIcon,
  ArrowUpToLineIcon,
  BoxIcon,
  CopyIcon,
  EyeIcon,
  EyeOffIcon,
  ImageIcon,
  LockIcon,
  RotateCwIcon,
  Trash2Icon,
  Undo2Icon,
  UnlockIcon,
} from "lucide-react";
import { useEffect, useRef } from "react";
import { Button } from "../../components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../../components/ui/menus";
import { useSync } from "../../sync/store";
import { AssetImg } from "../assets-pipeline/AssetImg";
import { toastReject, useLive, useMapIntent } from "../scenes-map/intents";
import type { CanvasToolDef } from "../scenes-map/tools";
import { typingTarget } from "../scenes-map/tools";
import {
  duplicate,
  PROPS_TOOL_ID,
  propPointer,
  remove,
  rotateChange,
  setHidden,
  updatePropFields,
  usePropTool,
  zChange,
} from "./prop-tool";
import { type Send, undoLast, usePropUndo } from "./prop-undo";

/** Undo for the shown scene; a rejected inverse drops its entry and shows a Toast (FR-SCN-15). */
function useUndo(send: Send) {
  const sceneId = usePropTool((s) => s.sceneId);
  const depth = usePropUndo((s) => (sceneId ? (s.stacks[sceneId]?.length ?? 0) : 0));
  const run = () => {
    if (sceneId) undoLast(send, sceneId).catch(toastReject);
  };
  return { depth, run };
}

function PropMenu({ send, live }: { send: Send; live: boolean }) {
  const menu = usePropTool((s) => s.menu);
  const props = usePropTool((s) => s.props);
  const p = props.find((x) => x.id === menu?.propId) ?? null;
  const close = () => usePropTool.setState({ menu: null });
  const run = (fn: (p: ScenePropRecord) => Promise<unknown>) => () => {
    close();
    if (p) fn(p).catch(toastReject);
  };
  const front = p ? zChange(props, p, "front") : null;
  const back = p ? zChange(props, p, "back") : null;
  return (
    <DropdownMenu
      open={p !== null && live}
      onOpenChange={(o) => {
        if (!o) close();
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
      <DropdownMenuContent align="start" data-testid="scn-prop-menu" data-record-id={p?.id}>
        {p && (
          <>
            <DropdownMenuItem
              data-testid="scn-prop-menu-rotate"
              onSelect={run((x) => updatePropFields(send, x, rotateChange(x)))}
            >
              <RotateCwIcon /> Rotate 90°
            </DropdownMenuItem>
            <DropdownMenuItem
              data-testid="scn-prop-menu-hide"
              onSelect={run((x) => setHidden(send, x, !x.hidden))}
            >
              {p.hidden ? <EyeIcon /> : <EyeOffIcon />} {p.hidden ? "Reveal" : "Hide"}
            </DropdownMenuItem>
            <DropdownMenuItem
              data-testid="scn-prop-menu-lock"
              onSelect={run((x) => updatePropFields(send, x, { locked: !x.locked }))}
            >
              {p.locked ? <UnlockIcon /> : <LockIcon />} {p.locked ? "Unlock" : "Lock"}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              data-testid="scn-prop-menu-front"
              disabled={!front}
              onSelect={run((x) => updatePropFields(send, x, front ?? {}))}
            >
              <ArrowUpToLineIcon /> To front
            </DropdownMenuItem>
            <DropdownMenuItem
              data-testid="scn-prop-menu-back"
              disabled={!back}
              onSelect={run((x) => updatePropFields(send, x, back ?? {}))}
            >
              <ArrowDownToLineIcon /> To back
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              data-testid="scn-prop-menu-duplicate"
              onSelect={run((x) =>
                duplicate(send, x).then((id) => usePropTool.setState({ selectedId: id })),
              )}
            >
              <CopyIcon /> Duplicate
            </DropdownMenuItem>
            <DropdownMenuItem
              data-testid="scn-prop-menu-image"
              onSelect={() => {
                close();
                usePropTool.setState({ picking: { kind: "image", propId: p.id } });
              }}
            >
              <ImageIcon /> Image…
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              data-testid="scn-prop-menu-delete"
              variant="destructive"
              onSelect={run((x) => remove(send, x))}
            >
              <Trash2Icon /> Delete
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function PropsPanel() {
  const send = useMapIntent();
  const live = useLive();
  const imageId = usePropTool((s) => s.imageId);
  const image = useSync((s) =>
    imageId ? (s.store.records.asset?.[imageId] as AssetRecord | undefined) : undefined,
  );
  const undo = useUndo(send);
  const undoRef = useRef(undo);
  undoRef.current = undo;
  // FR-SCN-15: Ctrl+Z while the tool is active (not while typing in a field).
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== "z" || e.shiftKey) return;
      if (typingTarget(e.target)) return;
      e.preventDefault();
      undoRef.current.run();
    };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, []);
  return (
    <div
      data-testid="scn-tool-props"
      className="flex w-56 flex-col gap-2 rounded-md border bg-background/95 p-2 text-sm shadow-sm backdrop-blur"
    >
      <div className="flex items-center gap-2">
        <div className="flex size-10 shrink-0 items-center justify-center rounded border bg-muted">
          {imageId ? (
            <AssetImg
              id={imageId}
              file="thumb"
              alt={image?.name ?? "Prop image"}
              className="size-9"
            />
          ) : (
            <ImageIcon className="size-4 text-muted-foreground" />
          )}
        </div>
        <span
          data-testid="scn-prop-image-name"
          className="min-w-0 flex-1 truncate text-muted-foreground"
        >
          {imageId ? (image?.name ?? "Image") : "No image"}
        </span>
      </div>
      <Button
        size="sm"
        variant="outline"
        data-testid="scn-prop-image"
        disabled={!live}
        onClick={() => usePropTool.setState({ picking: { kind: "place" } })}
      >
        Choose image…
      </Button>
      <p className="text-xs text-muted-foreground">
        {imageId
          ? "Click a cell to place it. Click a prop to select, drag to move, corners to resize; right-click for more."
          : "Choose an image, then click a cell. Right-click a prop for more."}
      </p>
      <Button
        size="sm"
        variant="ghost"
        data-testid="scn-undo"
        disabled={!live || undo.depth === 0}
        onClick={undo.run}
      >
        <Undo2Icon /> Undo
      </Button>
      <PropMenu send={send} live={live} />
    </div>
  );
}

/** Rail entry (FR-SCN-06): DM only; a drawing tool, so tokens ignore left-press meanwhile. */
export const propsTool: CanvasToolDef = {
  id: PROPS_TOOL_ID,
  label: "Props",
  icon: BoxIcon,
  clients: ["dm"],
  order: 20,
  panel: PropsPanel,
  cursor: "default",
  pointer: propPointer(toastReject),
};
