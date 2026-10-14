// Signal registry (FR-SYNC-22, ADR-0026). Signals are transient: no bus, DB write, event log,
// snapshot or `seq`. The hub validates (zod + roles), runs the type's `audience` hook if any
// (FR-SYNC-28, ADR-0033), stamps `from` from the connection context and forwards to the other
// live connections of the sender's campaign.
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

/** `all` = every other live connection of the campaign; `dm` = other live DM connections only. */
export type SignalAudience = "all" | "dm";

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

export class SignalRegistry {
  private defs = new Map<string, SignalDef>();

  register(def: SignalDef): void {
    if (this.defs.has(def.name)) throw new Error(`Signal "${def.name}" registered twice`);
    if (def.roles.length === 0) throw new Error(`Signal "${def.name}" has no roles`);
    this.defs.set(def.name, def);
  }

  get(name: string): SignalDef | undefined {
    return this.defs.get(name);
  }

  names(): string[] {
    return [...this.defs.keys()];
  }
}
