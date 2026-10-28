// Signal registry (FR-SYNC-22, ADR-0026). Signals are transient: no bus, DB write, event log,
// snapshot or `seq`. The hub validates (zod + roles), runs the type's `audience` hook if any
// (FR-SYNC-28, ADR-0033), stamps `from` from the connection context and forwards to the other
// live connections of the sender's campaign.
// Server-originated signals (sprint 4, OQ-FOG-58, ADR party vision): a command's result may
// carry signals (`withSignals`); the hub takes them out, sends the ack, then sends each signal
// (`from` = the intent's sender) to the listed players' other live connections, never to a DM,
// at most `rate.perSecond` frames per receiver and `rate.key` within any second: an excess frame
// is dropped, never delayed (nothing is held, so none can follow a later event). Registered with
// `registerServer`; a client sending one gets `unknown_intent`.
// Per-connection server signals (ADR-0071, spell-fx hit cues): `hub.sendServerSignal` sends a
// registered server signal to every live connection of a campaign, DMs included, with the payload
// a feature computes per viewer (null = none); never queued, stored or replayed.
import type { z } from "zod";
import type { Db } from "../db/client";
import type { Role } from "../events/types";

/** Who sent the signal, from the connection context (never the payload). */
export interface SignalSender {
  role: Role;
  playerId?: string;
  campaignId: string;
}

/** Read access for `audience` (the context record visibility / snapshot code gets). No writes. */
export interface SignalRead {
  db: Db;
  activeSceneOf(campaignId: string): string | null;
}

/**
 * `all` = every other live connection of the campaign; `dm` = other live DM connections only;
 * `{players}` (FR-SYNC-28 amended, ADR-0042) = other live DM connections plus those players'.
 */
export type SignalAudience = "all" | "dm" | { players: readonly string[] };

/** A well-formed `audience` result. */
export function validAudience(a: unknown): a is SignalAudience {
  if (a === "all" || a === "dm") return true;
  const p = (a as { players?: unknown } | null)?.players;
  return Array.isArray(p) && p.every((x) => typeof x === "string");
}

/** Whether a receiving connection is in the audience (the sender is skipped by the caller). */
export function reaches(a: SignalAudience, o: { role: Role | null; playerId: string | null }) {
  if (a === "all" || o.role === "dm") return true;
  if (a === "dm") return false;
  return o.playerId !== null && a.players.includes(o.playerId);
}

export interface SignalDef<S extends z.ZodType = z.ZodType> {
  /** `<short feature name>.<verb>`, e.g. `map.ping`. */
  name: string;
  schema: S;
  /** Roles allowed to send. A role not listed → `reject forbidden`, nobody receives it. */
  roles: readonly Role[];
  /**
   * Optional routing hook (FR-SYNC-28, ADR-0033), run once per signal after zod + roles.
   * Synchronous and read-only by convention. Throw `notFound` / `forbidden` / `invalid` to
   * reject: the sender gets the reject, nobody receives the signal. Absent → `"all"`.
   */
  audience?(data: z.infer<S>, sender: SignalSender, read: SignalRead): SignalAudience;
}

export function defineSignal<S extends z.ZodType>(def: SignalDef<S>): SignalDef {
  return def as unknown as SignalDef;
}

/** A server-originated signal type (OQ-FOG-58): carried by an intent result only. */
export interface ServerSignalDef<S extends z.ZodType = z.ZodType> {
  /** `<short feature name>.<what>`, e.g. `fog.sight`. */
  name: string;
  schema: S;
  /** Per receiver: ≤ `perSecond` frames with the same `key` in any 1 s window; excess dropped. */
  rate?: { perSecond: number; key(data: z.infer<S>): string };
}

export function defineServerSignal<S extends z.ZodType>(def: ServerSignalDef<S>): ServerSignalDef {
  return def as unknown as ServerSignalDef;
}

/** One signal a command result carries: payload + the players who may receive it. */
export interface ResultSignal {
  name: string;
  payload: unknown;
  /** Player ids; DMs never receive a server signal. */
  audience: readonly string[];
}

const RESULT_SIGNALS: unique symbol = Symbol("result-signals");

/**
 * A command result carrying signals (OQ-FOG-58). The signals ride a symbol key, so they never
 * reach the wire with the ack (`JSON.stringify` skips symbols); the hub takes them out.
 */
export function withSignals<R extends object>(result: R, signals: readonly ResultSignal[]): R {
  if (signals.length > 0) {
    Object.defineProperty(result, RESULT_SIGNALS, { value: [...signals], enumerable: false });
  }
  return result;
}

/** The signals a command result carries ([] when none). */
export function resultSignals(result: unknown): readonly ResultSignal[] {
  if (typeof result !== "object" || result === null) return [];
  return (result as { [RESULT_SIGNALS]?: ResultSignal[] })[RESULT_SIGNALS] ?? [];
}

export class SignalRegistry {
  private defs = new Map<string, SignalDef>();
  private serverDefs = new Map<string, ServerSignalDef>();

  register(def: SignalDef): void {
    if (this.defs.has(def.name) || this.serverDefs.has(def.name)) {
      throw new Error(`Signal "${def.name}" registered twice`);
    }
    if (def.roles.length === 0) throw new Error(`Signal "${def.name}" has no roles`);
    this.defs.set(def.name, def);
  }

  /** A server-originated signal (never accepted from a client). */
  registerServer(def: ServerSignalDef): void {
    if (this.defs.has(def.name) || this.serverDefs.has(def.name)) {
      throw new Error(`Signal "${def.name}" registered twice`);
    }
    this.serverDefs.set(def.name, def);
  }

  get(name: string): SignalDef | undefined {
    return this.defs.get(name);
  }

  getServer(name: string): ServerSignalDef | undefined {
    return this.serverDefs.get(name);
  }

  names(): string[] {
    return [...this.defs.keys()];
  }
}
