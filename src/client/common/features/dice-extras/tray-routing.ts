// Tray routes contract (FR-DICEX-102; ADR-0073 decision 3). The registry list lives in
// `./tray-routes` (append-only); this file holds the contract. A `free` Attack / Damage request
// asks the routes in `order`; the first claim sends its own intent, else `dice.roll {purpose}`.
// Pure: no React.
import type {
  DmRollActorRef,
  RollMode,
  RollPurpose,
  StagedPart,
} from "@shared/dice-roll-log/schemas";
import type { RecordStore } from "@shared/protocol/store";
import type { RollRequest } from "../dice-roll-log/roll-control";

/** What a route reads of the tray's `free` request. */
export interface TrayRouteRequest {
  purpose: RollPurpose;
  mode: RollMode;
  /** The tray's label (FR-DICE-11), absent = none. */
  label?: string;
  /** Absent = the roller ("me" / DM). */
  actor?: DmRollActorRef;
}

export type TraySendIntent = (name: string, payload: unknown) => Promise<unknown>;

export interface TrayRouteClaim {
  /** FR-DICEX-100: the roll will be a crit (the tray's badge; the physical form's extra dice). */
  crit: boolean;
  /** Send the route's intent with the staged parts and the roll control's request. */
  send(sendIntent: TraySendIntent, parts: StagedPart[], roll: RollRequest): Promise<unknown>;
}

export interface TrayRoute {
  key: string;
  /** Ascending: asked first. */
  order: number;
  /** Reads only the synced store; null = pass. */
  claim(store: RecordStore, request: TrayRouteRequest): TrayRouteClaim | null;
}

/** FR-DICEX-102: the first route (by `order`) that claims, else null. A throwing route passes. */
export function trayRouteFor(
  routes: readonly TrayRoute[],
  store: RecordStore,
  request: TrayRouteRequest,
): TrayRouteClaim | null {
  for (const r of [...routes].sort((a, b) => a.order - b.order)) {
    try {
      const c = r.claim(store, request);
      if (c) return c;
    } catch (err) {
      console.warn(`tray route ${r.key}: claim() threw`, err);
    }
  }
  return null;
}
