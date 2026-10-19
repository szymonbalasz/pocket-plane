// Paste and drop handlers of the image attach control (FR-ASSET-22, -23), on the target's native
// events. DOM-free: they take the event's parts, so `bun test` drives them with plain objects.
import {
  carriesFiles,
  clipboardImages,
  pasteAction,
  pastedName,
  type TransferLike,
  transferFiles,
} from "./paste";
import { type AttachQueue, noMoreImages } from "./queue";

export interface AttachGate {
  queue: AttachQueue;
  /** The caller's free slots, max − count (the queue subtracts its own). */
  free: number;
  max: number;
  /** Host form busy. */
  disabled: boolean;
  now(): Date;
}

interface EventLike {
  preventDefault(): void;
}

/**
 * FR-ASSET-22: no plain text (or a single URL) + ≥ 1 image → preventDefault, the images join the
 * queue as "Pasted image ‹date›"; the text field never changes. No slot / disabled → refused with
 * "No more images (‹max›)", text untouched. Anything else → the browser's own paste.
 */
export function handlePaste(e: EventLike & { clipboardData: TransferLike | null }, g: AttachGate) {
  const dt = e.clipboardData;
  if (!dt) return;
  const images = clipboardImages(dt);
  if (pasteAction(dt.getData("text/plain"), images.length) !== "upload") return;
  e.preventDefault();
  if (g.disabled || g.free - g.queue.pending <= 0) {
    g.queue.refuse(noMoreImages(g.max));
    return;
  }
  const name = pastedName(g.now());
  g.queue.add(
    images.map((file) => ({ file, name })),
    g.free,
    g.max,
  );
}

/** FR-ASSET-23: a drag with files may drop here (outline); other drags are left alone. */
export function handleDragOver(e: EventLike & { dataTransfer: TransferLike | null }): boolean {
  if (!e.dataTransfer || !carriesFiles(e.dataTransfer)) return false;
  e.preventDefault();
  return true;
}

/** FR-ASSET-23: dropped files join the queue; non-file drops are ignored. */
export function handleDrop(e: EventLike & { dataTransfer: TransferLike | null }, g: AttachGate) {
  const dt = e.dataTransfer;
  if (!dt || !carriesFiles(dt)) return;
  // Always: the browser must not open the dropped file instead.
  e.preventDefault();
  if (g.disabled) return;
  g.queue.add(
    transferFiles(dt).map((file) => ({ file })),
    g.free,
    g.max,
  );
}
