// "Paste" button (FR-ASSET-71): reads images straight from the system clipboard with the async
// Clipboard API, so the DM needn't focus a field and press Ctrl+V. DOM-free: the clipboard is passed
// in, so `bun test` drives it with plain objects.
import { ATTACH_TYPES } from "./queue";

/** The parts of a ClipboardItem the reader uses. */
export interface ClipboardItemLike {
  readonly types: readonly string[];
  getType(type: string): Promise<Blob>;
}

/** The parts of `navigator.clipboard` the reader uses. */
export interface ClipboardLike {
  read?(): Promise<readonly ClipboardItemLike[]>;
}

export type ClipboardRead =
  | { kind: "images"; files: File[] }
  /** The clipboard holds no image (text, nothing, an unsupported format). */
  | { kind: "empty" }
  /** The browser or the DM refused clipboard access. */
  | { kind: "denied" };

export const NO_CLIPBOARD_IMAGE = "No image on the clipboard";
export const CLIPBOARD_DENIED = "Clipboard access blocked: allow it for this site, or press Ctrl+V";

/** The browser's clipboard if it can read images (a secure context: https or 127.0.0.1), else null. */
export function browserClipboard(): ClipboardLike | null {
  const c = typeof navigator === "undefined" ? undefined : navigator.clipboard;
  return c && typeof c.read === "function" ? c : null;
}

const EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/svg+xml": "svg",
};

/** One image per clipboard item, in the first supported format the item offers. */
export async function readClipboardImages(clip: ClipboardLike): Promise<ClipboardRead> {
  if (!clip.read) return { kind: "denied" };
  let items: readonly ClipboardItemLike[];
  try {
    items = await clip.read();
  } catch {
    // NotAllowedError (permission refused or prompt dismissed), or a read with nothing readable.
    return { kind: "denied" };
  }
  const files: File[] = [];
  for (const item of items) {
    const type = item.types.find((t) => ATTACH_TYPES.includes(t));
    if (!type) continue;
    try {
      const blob = await item.getType(type);
      files.push(new File([blob], `pasted.${EXT[type] ?? "png"}`, { type }));
    } catch {
      // The item vanished meanwhile (clipboard changed): skip it.
    }
  }
  return files.length > 0 ? { kind: "images", files } : { kind: "empty" };
}
