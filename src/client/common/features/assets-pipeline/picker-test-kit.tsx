// Test helpers for the image picker and its hosts (ASSET §13.1, FR-ASSET-48): a fake sync store
// holding `asset` records, a static render inside it, and element-tree helpers that find the
// picker element a host returns (Dialogs render in a portal, which a static render skips). Tests
// only.
import { afterAll, beforeAll } from "bun:test";
import { type AssetRecord, pickerOrder } from "@shared/assets-pipeline/schemas";
import { matchImages } from "@shared/assets-pipeline/search";
import { emptyStore, type RecordStore } from "@shared/protocol/store";
import { TooltipProvider } from "@ui/components/ui/overlays";
import { SyncContext, type SyncState } from "@ui/sync/store";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createStore } from "zustand";
import { AssetPicker, type AssetPickerProps } from "./AssetPicker";
import type { UploadOutcome } from "./upload";
import { type AttachUploader, AttachUploaderProvider } from "./uploader";

/** Thumbnails load through `Image` (AssetImg): a no-op stand-in for the file's tests. */
export function stubImageForFile(): void {
  const had = "Image" in globalThis;
  beforeAll(() => {
    if (!had)
      (globalThis as { Image?: unknown }).Image = class {
        decoding = "";
        src = "";
        onload = null;
        onerror = null;
      };
  });
  afterAll(() => {
    if (!had) delete (globalThis as { Image?: unknown }).Image;
  });
}

export interface FakeSyncOptions {
  state?: SyncState["state"];
  /** Extra records by type (merged over the assets). */
  records?: Record<string, Record<string, unknown>>;
  /** Called by `connection.sendIntent`. */
  sendIntent?(name: string, payload: unknown): Promise<unknown>;
}

export function fakeSync(assets: readonly AssetRecord[], opts: FakeSyncOptions = {}) {
  const records = {
    asset: Object.fromEntries(assets.map((a) => [a.id, a])),
    ...opts.records,
  } as RecordStore["records"];
  return createStore<SyncState>()(
    () =>
      ({
        state: opts.state ?? "live",
        everLive: true,
        store: { ...emptyStore(), records, you: { role: "dm" } },
        connection: { sendIntent: opts.sendIntent ?? (async () => ({})) },
      }) as unknown as SyncState,
  );
}

/** A DM uploader that records each request and answers `ok` with the first asset. */
export function fakeUploader(answer: AssetRecord) {
  const sent: { name: string; opts: Parameters<AttachUploader["upload"]>[1] }[] = [];
  const uploader: AttachUploader = {
    async upload(file, opts) {
      sent.push({ name: file.name, opts });
      return { kind: "ok", outcome: "created", asset: answer } satisfies UploadOutcome;
    },
  };
  return { uploader, sent };
}

/** Static render inside a fake store (+ an uploader: the DM client). */
export function renderInSync(
  node: ReactNode,
  assets: readonly AssetRecord[],
  opts: FakeSyncOptions & { uploader?: AttachUploader | null } = {},
): string {
  const inner =
    opts.uploader === null ? (
      node
    ) : (
      <AttachUploaderProvider
        value={opts.uploader ?? fakeUploader(assets[0] as AssetRecord).uploader}
      >
        {node}
      </AttachUploaderProvider>
    );
  return renderToStaticMarkup(
    <SyncContext.Provider value={fakeSync(assets, opts)}>
      <TooltipProvider delayDuration={0} skipDelayDuration={0}>
        {inner}
      </TooltipProvider>
    </SyncContext.Provider>,
  );
}

/**
 * Renders `component(props)` inside a fake store and returns the element tree it returned
 * (hooks attach to the capturing wrapper), so a test can find a picker inside a closed portal.
 */
export function captureTree<P>(
  component: (props: P) => ReactNode,
  props: P,
  assets: readonly AssetRecord[],
  opts: FakeSyncOptions = {},
): ReactNode {
  let tree: ReactNode = null;
  function Capture() {
    tree = component(props);
    return null;
  }
  renderInSync(<Capture />, assets, opts);
  return tree;
}

/** Depth-first: the first element of `type` in an element tree (children props only). */
export function findElement<P>(
  node: ReactNode,
  type: (props: P) => ReactNode,
): ReactElement<P> | null {
  if (Array.isArray(node)) {
    for (const n of node) {
      const hit = findElement(n, type);
      if (hit) return hit;
    }
    return null;
  }
  if (!isValidElement(node)) return null;
  if (node.type === type) return node as ReactElement<P>;
  return findElement((node.props as { children?: ReactNode }).children, type);
}

/** The opening tag of the first element with `data-testid="id"`. */
export const tagOf = (html: string, id: string) =>
  html.match(new RegExp(`<[a-z]+[^>]*data-testid="${id}"[^>]*>`))?.[0] ?? "";

/** Every `data-record-id` of the picker's items, in grid order. */
export const itemIds = (html: string) =>
  [...html.matchAll(/data-testid="asset-picker-item"[^>]*data-record-id="([^"]+)"/g)].map(
    (m) => m[1] as string,
  );

/**
 * FR-ASSET-48 host check: the picker element a host renders, rendered inline over `assets` with
 * the host's own props. Returns its markup and the names "Gob el" leaves in that picker.
 */
export function hostPicker(props: AssetPickerProps, assets: readonly AssetRecord[]) {
  const html = renderInSync(<AssetPicker {...props} />, assets);
  const shown = new Set(itemIds(html));
  const ordered = [...assets].sort(pickerOrder).filter((a) => shown.has(a.id));
  return { html, gobEl: matchImages(ordered, "Gob el").map((a) => a.name) };
}
