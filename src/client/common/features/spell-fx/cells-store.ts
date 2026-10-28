// Show affected cells (FR-VFX-23): client only, this viewer only, per (effect, token). Cleared
// when the aura ends or the scene changes. Never sent.
import { create } from "zustand";

interface CellsState {
  sceneId: string | null;
  /** `<effectId>:<tokenId>` (an aura key) → shown. */
  shown: Readonly<Record<string, true>>;
}

export const useFxCells = create<CellsState>(() => ({ sceneId: null, shown: {} }));

export const cellsShown = (key: string): boolean => useFxCells.getState().shown[key] === true;

export function toggleCells(key: string): void {
  useFxCells.setState((s) => {
    const shown = { ...s.shown };
    if (shown[key]) delete shown[key];
    else shown[key] = true;
    return { shown };
  });
}

/** Drops cells whose aura is gone, or all of them on a scene change. */
export function pruneCells(sceneId: string, auraKeys: ReadonlySet<string>): void {
  const s = useFxCells.getState();
  if (s.sceneId !== sceneId) {
    useFxCells.setState({ sceneId, shown: {} });
    return;
  }
  const gone = Object.keys(s.shown).filter((k) => !auraKeys.has(k));
  if (gone.length === 0) return;
  const shown = { ...s.shown };
  for (const k of gone) delete shown[k];
  useFxCells.setState({ shown });
}
