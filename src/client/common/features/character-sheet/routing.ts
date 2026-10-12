// Sheet roll routing (FR-CHAR-16, #135) and intent helpers (FR-CHAR-12). Pure: no React.
// The registry list lives in `./roll-routes` (append-only); this file holds the contract.
import { CHAR_ROLL, type CharRollIntent, type CharRollKind } from "@shared/character-sheet/schemas";
import type { ManualEntry, RollMode } from "@shared/dice-roll-log/schemas";
import type { RecordStore } from "@shared/protocol/store";
import { IntentRejected } from "../../sync/connection";

/** What the shared roll control hands the sheet (FR-DICE-24). */
export interface RollRouteInput {
  mode: RollMode;
  /** One per expression: initiative 1, attack 2 (to-hit, damage). */
  manual?: ManualEntry[];
  /** DM override only. */
  public?: boolean;
}

export type SendIntent = (name: string, payload: unknown) => Promise<unknown>;

/** A route's answer for one `(characterId, kind)`: it sends its own intent. */
export interface RollRouteClaim {
  /** Badge on the sheet while claimed, e.g. "In combat". */
  badge: string;
  /** Damage expressions after a natural 20, for the manual popover (combat only). */
  critExpressions?: readonly string[];
  /** Send the route's intent from the same input, dropping fields it doesn't take. */
  send(sendIntent: SendIntent, input: RollRouteInput): Promise<unknown>;
}

/**
 * One registry entry. `claim` reads only the synced store (e.g. "a started encounter has this
 * PC as an active combatant") and returns null to pass. First claim wins, in list order.
 */
export interface RollRoute {
  name: string;
  claim(store: RecordStore, characterId: string, kind: CharRollKind): RollRouteClaim | null;
}

/** FR-CHAR-16: the first route that claims, else null (→ `char.roll`). A throwing route passes. */
export function routeFor(
  routes: readonly RollRoute[],
  store: RecordStore,
  characterId: string,
  kind: CharRollKind,
): RollRouteClaim | null {
  for (const r of routes) {
    try {
      const c = r.claim(store, characterId, kind);
      if (c) return c;
    } catch (err) {
      console.warn(`roll route ${r.name}: claim() threw`, err);
    }
  }
  return null;
}

/** `char.roll` payload from the roll control's input; only fields that are set. */
export function charRollPayload(
  characterId: string,
  kind: CharRollKind,
  input: RollRouteInput,
): CharRollIntent {
  const p: CharRollIntent = { characterId, kind, mode: input.mode };
  if (input.manual) p.manual = input.manual;
  if (input.public !== undefined) p.public = input.public;
  return p;
}

/** FR-CHAR-16: routed intent if a route claims, else `char.roll`. */
export function sendSheetRoll(
  sendIntent: SendIntent,
  claim: RollRouteClaim | null,
  characterId: string,
  kind: CharRollKind,
  input: RollRouteInput,
): Promise<unknown> {
  if (claim) return claim.send(sendIntent, input);
  return sendIntent(CHAR_ROLL, charRollPayload(characterId, kind, input));
}

export const CONNECTION_LOST = "Connection lost \u2014 check the game log / HP before trying again";

/** FR-CHAR-12: Toast text for a failed intent. */
export function intentErrorText(err: unknown): string {
  if (err instanceof IntentRejected) {
    if (err.code === "disconnected") return CONNECTION_LOST;
    const issue = (err.issues as { message?: string }[] | undefined)?.[0]?.message;
    return issue ?? err.message;
  }
  return err instanceof Error ? err.message : "Something went wrong";
}

/**
 * FR-CHAR-12: one intent in flight per control. `run` starts `fn` unless one is running
 * (a double click sends one intent) and reports whether it started.
 */
export function createInFlight(onChange: (busy: boolean) => void) {
  let busy = false;
  return {
    get busy() {
      return busy;
    },
    run(fn: () => Promise<unknown>, onError: (err: unknown) => void): boolean {
      if (busy) return false;
      busy = true;
      onChange(true);
      let p: Promise<unknown>;
      try {
        p = fn();
      } catch (err) {
        p = Promise.reject(err);
      }
      p.catch(onError).finally(() => {
        busy = false;
        onChange(false);
      });
      return true;
    },
  };
}
