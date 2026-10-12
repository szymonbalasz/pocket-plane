// Client image loader (FR-ASSET-16), both clients. URLs come only from asset IDs in records
// (ADR-0023); the element works for DOM (`src`) and Konva (`image`).
import { type AssetFile, assetPath } from "@shared/assets-pipeline/schemas";
import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";
import { useSync } from "../../sync/store";
import { ImageCache, type ImageState } from "./image-cache";

export type { ImageState };

/** `/api/assets/:id/:file` (FR-ASSET-11). */
export const assetUrl = (id: string, file: AssetFile) => assetPath(id, file);

const cache = new ImageCache<HTMLImageElement>(() => {
  const img = new Image();
  img.decoding = "async";
  return img;
});

/**
 * Retries `error` loads once after each reconnect snapshot (live after not live). Call it
 * in one component per client root; `useAssetImage` calls it too, idempotently.
 */
export function useAssetReconnectRetry(): void {
  const state = useSync((s) => s.state);
  const prev = useRef(state);
  useEffect(() => {
    if (state === "live" && prev.current !== "live") cache.retryErrors();
    prev.current = state;
  }, [state]);
}

export interface AssetImage {
  state: ImageState | "none";
  image: HTMLImageElement | null;
  url: string | null;
}

/** `id` null → `none` (no image set). One load per URL, shared by every consumer. */
export function useAssetImage(id: string | null | undefined, file: AssetFile): AssetImage {
  useAssetReconnectRetry();
  const url = id ? assetUrl(id, file) : null;
  const subscribe = useCallback(
    (fn: () => void) => (url ? cache.subscribe(url, fn) : () => {}),
    [url],
  );
  const getState = useCallback(() => (url ? cache.get(url).state : "none"), [url]);
  const state = useSyncExternalStore(subscribe, getState, getState);
  const image = url && state === "ready" ? (cache.peek(url)?.image ?? null) : null;
  return { state, image, url };
}
