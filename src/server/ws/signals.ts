// Signal registry (FR-SYNC-22, ADR-0026). Signals are transient: no bus, DB, event log,
// snapshot or `seq`. The hub validates (zod + roles), stamps `from` from the connection
// context and forwards to every other live connection of the sender's campaign.
import type { z } from "zod";
import type { Role } from "../events/types";

export interface SignalDef<S extends z.ZodType = z.ZodType> {
  /** `<short feature name>.<verb>`, e.g. `map.ping`. */
  name: string;
  schema: S;
  /** Roles allowed to send. A role not listed → `reject forbidden`, nobody receives it. */
  roles: readonly Role[];
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
