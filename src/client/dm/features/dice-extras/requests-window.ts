// DM `dicex.requests` window (FR-DICEX-86, -88; FR-SHELL-112 (1), seams S3): launcher "Requests"
// after "Dice"; 360 × 460, useful 360 × 400 (composer folded + a 6-row card; fits the 412 band at
// 1280×720), min 300 × 320; top-right (fewer FR-SHELL-115 replay problems than top-left). Badge =
// open requests (the launcher's dot while one is open); the "new" dot while minimised when a
// target answers, declines or misses. The body is a lazy chunk (DICEX §12).
import { ROLL_REQUEST_TYPE } from "@shared/dice-extras/request-names";
import type { RollRequestRecord } from "@shared/dice-extras/requests";
import type { RecordStore } from "@shared/protocol/store";
import { DICEX_REQUESTS_KIND } from "@ui/features/dice-extras/window-kind";
import { defineWindow } from "@ui/features/play-shell/registry";
import { lazyChunk } from "@ui/lib/lazy-chunk";
import { ListChecksIcon } from "lucide-react";
import { createElement, Suspense } from "react";

const Body = lazyChunk(
  () =>
    import("@ui/features/dice-extras/RequestsWindow").then((m) => ({ default: m.RequestsWindow })),
  "window",
);

function LazyRequestsWindow() {
  return createElement(Suspense, { fallback: null }, createElement(Body));
}

const rows = (store: RecordStore) =>
  Object.values(store.records[ROLL_REQUEST_TYPE] ?? {}) as RollRequestRecord[];

/** FR-DICEX-88: open requests (the launcher's badge while any is open). */
export const openRequests = (store: RecordStore): number =>
  rows(store).filter((r) => r.state === "open").length;

/** FR-SHELL-38: targets that left `open` in the open requests (a "new" dot while minimised). */
export const requestActivity = (store: RecordStore): number =>
  rows(store)
    .filter((r) => r.state === "open")
    .reduce((n, r) => n + r.targets.filter((t) => t.state !== "open").length, 0);

export const requestsWindow = defineWindow({
  kind: DICEX_REQUESTS_KIND,
  title: "Roll requests",
  clients: ["dm"],
  defaultSize: { w: 360, h: 460 },
  usefulSize: { w: 360, h: 400 },
  minSize: { w: 300, h: 320 },
  defaultPosition: { anchor: "top-right" },
  defaultOpen: false,
  launcher: { icon: ListChecksIcon, label: "Requests", order: 46 },
  badge: openRequests,
  activity: requestActivity,
  component: LazyRequestsWindow,
});
