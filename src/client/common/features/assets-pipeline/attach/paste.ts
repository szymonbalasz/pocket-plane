// Clipboard paste and drop rules of the image attach control (FR-ASSET-22, -23). DOM-free: the
// control hands in the event's DataTransfer.

/** A single http(s) URL: trimmed, one token, no whitespace (review #18). */
const SINGLE_URL = /^https?:\/\/\S+$/i;

export type PasteAction =
  /** preventDefault; the images join the queue. */
  | "upload"
  /** The browser's normal text paste; no upload. */
  | "text"
  /** No image and no text: nothing. */
  | "none";

/**
 * Plain text present → text, except when it is a single URL and there is an image (some browsers'
 * "Copy image" adds the image URL as text/plain): then the image wins and the URL isn't pasted.
 */
export function pasteAction(plainText: string, imageCount: number): PasteAction {
  const text = plainText.trim();
  if (imageCount === 0) return text ? "text" : "none";
  if (!text || SINGLE_URL.test(text)) return "upload";
  return "text";
}

const pad = (n: number) => String(n).padStart(2, "0");

/** "Pasted image 2026-10-19 14:05" (local time). */
export function pastedName(d: Date): string {
  const day = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  return `Pasted image ${day} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** The parts of a DataTransfer the rules read. */
export interface TransferLike {
  readonly types: readonly string[];
  readonly files: ArrayLike<File>;
  readonly items?: ArrayLike<{ kind: string; type: string; getAsFile(): File | null }>;
  getData(format: string): string;
}

/** The transfer's files: `items` first (clipboard images), else `files`. */
export function transferFiles(dt: TransferLike): File[] {
  const fromItems = Array.from(dt.items ?? [])
    .filter((i) => i.kind === "file")
    .map((i) => i.getAsFile())
    .filter((f): f is File => f !== null);
  return fromItems.length > 0 ? fromItems : Array.from(dt.files);
}

/** Image files (`image/*`) of a paste; other files don't count as images. */
export const clipboardImages = (dt: TransferLike) =>
  transferFiles(dt).filter((f) => f.type.startsWith("image/"));

/** A drag that carries files (the outline and the drop only react to these). */
export const carriesFiles = (dt: Pick<TransferLike, "types">) =>
  Array.from(dt.types).includes("Files");
