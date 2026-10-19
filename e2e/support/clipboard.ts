// Synthetic paste and file drop (PARTY §13.1 S5, ASSET §13): clipboard reads are blocked in the
// harness, so a test dispatches a `paste` event carrying a DataTransfer with files (and optional
// plain text), or `dragover` + `drop` with files. A paste the page doesn't prevent gets the
// browser's default text insertion emulated (`insertText`), as a real paste would.
import type { Locator } from "@playwright/test";

/** A file the page builds: a solid-colour PNG drawn on a canvas, or given text bytes. */
export type FileSpec =
  | { png: string; name?: string; size?: number }
  | { name: string; type: string; text: string };

/** Base64 PNG bytes of a solid colour (for `setInputFiles`). */
export async function pngBytes(target: Locator, color: string, size = 8): Promise<Buffer> {
  const b64 = await target.evaluate(
    async (_el, [color, size]) => {
      const c = document.createElement("canvas");
      c.width = c.height = size;
      const g = c.getContext("2d") as CanvasRenderingContext2D;
      g.fillStyle = color;
      g.fillRect(0, 0, size, size);
      const blob = await new Promise<Blob>((r) => c.toBlob((b) => r(b as Blob), "image/png"));
      const bytes = new Uint8Array(await blob.arrayBuffer());
      let s = "";
      for (const byte of bytes) s += String.fromCharCode(byte);
      return btoa(s);
    },
    [color, size] as const,
  );
  return Buffer.from(b64, "base64");
}

/**
 * In the page: builds a DataTransfer of `files` (+ plain `text`) and dispatches a paste on `el`
 * (the default text insertion emulated when not prevented), or dragenter / dragover / drop.
 * Returns whether the paste / drop was prevented (taken by the page).
 */
function dispatch(target: Locator, mode: "paste" | "drop", files: FileSpec[], text: string | null) {
  return target.evaluate(
    async (el, [mode, files, text]) => {
      const dt = new DataTransfer();
      for (const f of files) {
        if ("png" in f) {
          const c = document.createElement("canvas");
          c.width = c.height = f.size ?? 8;
          const g = c.getContext("2d") as CanvasRenderingContext2D;
          g.fillStyle = f.png;
          g.fillRect(0, 0, c.width, c.height);
          const blob = await new Promise<Blob>((r) => c.toBlob((b) => r(b as Blob), "image/png"));
          dt.items.add(new File([blob], f.name ?? "image.png", { type: "image/png" }));
        } else {
          dt.items.add(new File([f.text], f.name, { type: f.type }));
        }
      }
      if (text !== null) dt.setData("text/plain", text);
      if (mode === "paste") {
        (el as HTMLElement).focus();
        const e = new ClipboardEvent("paste", {
          clipboardData: dt,
          bubbles: true,
          cancelable: true,
        });
        el.dispatchEvent(e);
        if (!e.defaultPrevented && text) document.execCommand("insertText", false, text);
        return e.defaultPrevented;
      }
      const at = (type: string) =>
        new DragEvent(type, { dataTransfer: dt, bubbles: true, cancelable: true });
      el.dispatchEvent(at("dragenter"));
      el.dispatchEvent(at("dragover"));
      const drop = at("drop");
      el.dispatchEvent(drop);
      return drop.defaultPrevented;
    },
    [mode, files, text] as const,
  );
}

/** Focuses `target` and pastes `files` (+ plain `text`). Returns whether the page took it. */
export const pasteInto = (target: Locator, files: FileSpec[], text: string | null = null) =>
  dispatch(target, "paste", files, text);

/** Drags `files` over `target` and drops them. Returns whether the drop was taken. */
export const dropOn = (target: Locator, files: FileSpec[]) => dispatch(target, "drop", files, null);
