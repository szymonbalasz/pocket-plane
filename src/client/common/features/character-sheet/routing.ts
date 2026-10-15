// Sheet roll routing (FR-CHAR-16, #135) and intent helpers (FR-CHAR-12). Pure: no React.
// The registry list lives in `./roll-routes` (append-only); this file holds the contract.
import {
  CHAR_ROLL,
  SHEET_ROLL_KINDS,
  type SheetRollIntent,
  type SheetRollKind,
} from "@shared/character-sheet/schemas";
import type { ManualEntry, RollMode } from "@shared/dice-roll-log/schemas";
import type { Ability, Skill } from "@shared/entities/schemas";
import type { RecordStore } from "@shared/protocol/store";
import { IntentRejected } from "../../sync/connection";

/** What the shared roll control hands the sheet (FR-DICE-24). */
export interface RollRouteInput {
  mode: RollMode;
  /** One per expression: attack (Attack + damage) 2 (to-hit, damage); toHit, damage, … 1. */
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
  /**
   * FR-CHAR-24: the sheet renders no button (nor public switch) for this kind; Initiative shows
   * a muted "Initiative set". The badge stays.
   */
  hidden?: boolean;
  /** Send the route's intent from the same input, dropping fields it doesn't take. */
  send(sendIntent: SendIntent, input: RollRouteInput): Promise<unknown>;
}

/** FR-CHARX-24: the row a routed roll names (attack / damage rows, spell rows); none = first. */
export type RollRouteRef =
  | { attackId: string; spellId?: never }
  | { spellId: string; attackId?: never };

/**
 * One registry entry. `claim` reads only the synced store (e.g. "a started encounter has this
 * PC as an active combatant") and returns null to pass. First claim wins, in list order.
 * `ref` (FR-CHARX-24) names the sheet row; a route that sends its own intent passes it on.
 */
export interface RollRoute {
  name: string;
  claim(
    store: RecordStore,
    characterId: string,
    kind: SheetRollKind,
    ref?: RollRouteRef,
  ): RollRouteClaim | null;
}

/** The route ref of a sheet roll's row (attack or spell), else none. */
export function routeRef(ref: SheetRollRef | undefined): RollRouteRef | undefined {
  if (ref?.attackId !== undefined) return { attackId: ref.attackId };
  if (ref?.spellId !== undefined) return { spellId: ref.spellId };
  return undefined;
}

/** FR-CHAR-16: the first route that claims, else null (→ `char.roll`). A throwing route passes. */
export function routeFor(
  routes: readonly RollRoute[],
  store: RecordStore,
  characterId: string,
  kind: SheetRollKind,
  ref?: RollRouteRef,
): RollRouteClaim | null {
  for (const r of routes) {
    try {
      const c = r.claim(store, characterId, kind, ref);
      if (c) return c;
    } catch (err) {
      console.warn(`roll route ${r.name}: claim() threw`, err);
    }
  }
  return null;
}

/**
 * FR-CHAR-24: what the sheet renders for a roll kind: the roll button (with its DM public
 * switch), "Initiative set" for a hidden Initiative, or nothing for another hidden kind.
 */
export function rollActionView(
  claim: RollRouteClaim | null,
  kind: SheetRollKind,
): "button" | "locked" | "none" {
  if (!claim?.hidden) return "button";
  return kind === "initiative" ? "locked" : "none";
}

/**
 * FR-CHAR-16: the header badge iff a route claims at least one kind for this character (combat:
 * initiative, attack); the first such claim's badge. Null = plain sheet.
 */
export function sheetBadge(
  routes: readonly RollRoute[],
  store: RecordStore,
  characterId: string,
): string | null {
  for (const kind of SHEET_ROLL_KINDS) {
    const c = routeFor(routes, store, characterId, kind);
    if (c) return c.badge;
  }
  return null;
}

/** The row a `char.roll` names (FR-CHARX-20): an ability, a skill, an attack or a spell row. */
export interface SheetRollRef {
  ability?: Ability;
  skill?: Skill;
  attackId?: string;
  spellId?: string;
}

/** `char.roll` payload from the roll control's input; only fields that are set. */
export function charRollPayload(
  characterId: string,
  kind: SheetRollKind,
  input: RollRouteInput,
  ref?: Ability | SheetRollRef,
): SheetRollIntent {
  const r: SheetRollRef = typeof ref === "string" ? { ability: ref } : (ref ?? {});
  const p: SheetRollIntent = { characterId, kind, mode: input.mode };
  if (r.ability) p.ability = r.ability;
  if (r.skill) p.skill = r.skill;
  if (r.attackId) p.attackId = r.attackId;
  if (r.spellId) p.spellId = r.spellId;
  if (input.manual) p.manual = input.manual;
  if (input.public !== undefined) p.public = input.public;
  return p;
}

/** FR-CHAR-16: routed intent if a route claims, else `char.roll` (+ its ability / row ref). */
export function sendSheetRoll(
  sendIntent: SendIntent,
  claim: RollRouteClaim | null,
  characterId: string,
  kind: SheetRollKind,
  input: RollRouteInput,
  ref?: Ability | SheetRollRef,
): Promise<unknown> {
  if (claim) return claim.send(sendIntent, input);
  return sendIntent(CHAR_ROLL, charRollPayload(characterId, kind, input, ref));
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
