// Fog undo / redo from the bar and the keys (FR-FOG-07, -17, -56; OQ-FOG-53). The server holds
// the stack (depth 50, survives reload); the client sends `fog.undo` / `fog.redo` guarded by the
// `fog` record's `undo` / `redo` entry id. Steps run one at a time in order: each reads the record
// after the previous one's event (events reach the store before their ack), so Ctrl+Z pressed
// twice quickly undoes two strokes instead of racing the guard. Keys (Fog tool active, focus not
// in a text field: `useBaseKeyDown`): Ctrl+Z = drop the open polygon draft's last vertex, else
// Undo; Ctrl+Shift+Z / Ctrl+Y = Redo (Cmd on macOS). DOM-free.
import {
  FOG_INTENTS,
  type FogRecord,
  type FogRedoInput,
  type FogUndoInput,
} from "@shared/fog-of-war/schemas";

export type HistoryStep = "undo" | "redo";
export type HistoryAction = HistoryStep | "vertex";

interface KeyLike {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}

/** FR-FOG-17: what a key press does; null = not a history key. */
export function historyKey(e: KeyLike, polygonOpen: boolean): HistoryAction | null {
  if (!(e.ctrlKey || e.metaKey) || e.altKey) return null;
  const k = e.key.toLowerCase();
  if (k === "y" && !e.shiftKey) return "redo";
  if (k !== "z") return null;
  if (e.shiftKey) return "redo";
  return polygonOpen ? "vertex" : "undo";
}

export interface HistoryTarget {
  sceneId: string;
  /** The scene's `fog` record now (read when the step runs). */
  read: () => FogRecord | undefined;
  intent: (name: string, input: FogUndoInput | FogRedoInput) => Promise<unknown>;
  onReject: (err: unknown) => void;
}

/** Steps waiting to run, at most this many (a held key can't queue a whole stack). */
export const HISTORY_QUEUE_MAX = 8;

let chain: Promise<void> = Promise.resolve();
let queued = 0;

/** Runs one undo / redo after those already queued; false when nothing to do or queue full. */
export function stepHistory(which: HistoryStep, t: HistoryTarget): boolean {
  if (queued >= HISTORY_QUEUE_MAX) return false;
  if (queued === 0 && !(which === "undo" ? t.read()?.undo : t.read()?.redo)) return false;
  queued += 1;
  chain = chain.then(async () => {
    try {
      const fog = t.read();
      const entry = which === "undo" ? fog?.undo : fog?.redo;
      if (!entry) return;
      const input = { sceneId: t.sceneId, expectedEditId: entry.editId };
      await t.intent(which === "undo" ? FOG_INTENTS.undo : FOG_INTENTS.redo, input);
    } catch (err) {
      t.onReject(err);
    } finally {
      queued -= 1;
    }
  });
  return true;
}

/** Tests: wait for the queue to drain. */
export const historyIdle = (): Promise<void> => chain;
