// Show / Hide affected cells (FR-VFX-23): one item per aura with a radius on the token ("Show
// affected cells", or "Show cells: Spirit Guardians" when several), test ID
// `vfx-token-menu-cells` (`data-record-id` = effect id, `data-state` = `show` | `hide`). The DM
// gets them in the token menu (registry FR-MAP-29); players have no token menu, so a right-click
// on such a token opens this small menu (FR-MAP-71 step 4: the `vfx-under` entry's
// `contextMenu`), a DOM island like scene-tools' TemplateMenu.
import { useContext, useEffect, useSyncExternalStore } from "react";
import { createRoot } from "react-dom/client";
import { create } from "zustand";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../../components/ui/menus";
import { SyncContext, type SyncStore } from "../../sync/store";
import { toggleCells, useFxCells } from "./cells-store";
import { fxEngine } from "./engine";

interface MenuState {
  open: { tokenId: string; at: { x: number; y: number } } | null;
}

const useCellsMenu = create<MenuState>(() => ({ open: null }));

export const openCellsMenu = (open: NonNullable<MenuState["open"]>) =>
  useCellsMenu.setState({ open });
export const closeCellsMenu = () => useCellsMenu.setState({ open: null });

/** The auras with a radius anchored on `tokenId` the viewer sees now. */
export function useCellAuras(tokenId: string) {
  const engine = fxEngine();
  const snap = useSyncExternalStore(engine.subscribe, engine.snapshot, engine.snapshot);
  if (snap.level === "off") return [];
  return snap.auras.filter((a) => a.tokenId === tokenId && a.radiusFt !== null);
}

/** The menu items for one token (DM token menu and the player's menu). */
export function CellsMenuItems({ tokenId, onDone }: { tokenId: string; onDone?: () => void }) {
  const auras = useCellAuras(tokenId);
  const shown = useFxCells((s) => s.shown);
  return auras.map((a) => {
    const on = shown[a.key] === true;
    const label =
      auras.length === 1
        ? `${on ? "Hide" : "Show"} affected cells`
        : `${on ? "Hide" : "Show"} cells: ${a.preset.label}`;
    return (
      <DropdownMenuItem
        key={a.key}
        data-testid="vfx-token-menu-cells"
        data-record-id={a.effectId}
        data-state={on ? "hide" : "show"}
        onSelect={() => {
          toggleCells(a.key);
          onDone?.();
        }}
      >
        {label}
      </DropdownMenuItem>
    );
  });
}

function CellsMenu() {
  const open = useCellsMenu((s) => s.open);
  const auras = useCellAuras(open?.tokenId ?? "");
  const gone = open !== null && auras.length === 0;
  useEffect(() => {
    if (gone) closeCellsMenu();
  }, [gone]);
  return (
    <DropdownMenu
      open={open !== null && !gone}
      onOpenChange={(o) => !o && closeCellsMenu()}
      modal={false}
    >
      <DropdownMenuTrigger asChild>
        <span
          aria-hidden
          className="pointer-events-none fixed size-px"
          style={{ left: open?.at.x ?? 0, top: open?.at.y ?? 0 }}
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        data-testid="vfx-token-menu"
        onContextMenu={(e) => e.preventDefault()}
      >
        {open && <CellsMenuItems tokenId={open.tokenId} onDone={closeCellsMenu} />}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Mounts the player's cells menu in its own root while the canvas lives (rendered from Konva). */
export function useCellsMenuIsland(enabled: boolean): void {
  const sync: SyncStore | null = useContext(SyncContext);
  useEffect(() => {
    if (!enabled || !sync || typeof document === "undefined") return;
    const el = document.createElement("div");
    document.body.appendChild(el);
    const root = createRoot(el);
    root.render(
      <SyncContext.Provider value={sync}>
        <CellsMenu />
      </SyncContext.Provider>,
    );
    return () => {
      closeCellsMenu();
      setTimeout(() => {
        root.unmount();
        el.remove();
      });
    };
  }, [enabled, sync]);
}
