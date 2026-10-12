import type { z } from "zod";

/** A domain event type: name, zod payload, logged? undoable? (ADR-0016, ADR-0021). */
export interface DomainEventDef<N extends string = string, S extends z.ZodType = z.ZodType> {
  type: N;
  payload: S;
  /** Appended to the event log in the commit's transaction. */
  logged: boolean;
  /** MVP: combat damage/healing only (ADR-0016). */
  undoable: boolean;
}

/** True for `defineEvent` results (event modules may also export enums and payload schemas). */
export function isDomainEventDef(v: unknown): v is DomainEventDef {
  if (typeof v !== "object" || v === null) return false;
  const d = v as Partial<DomainEventDef>;
  return (
    typeof d.type === "string" &&
    typeof d.logged === "boolean" &&
    typeof d.undoable === "boolean" &&
    typeof d.payload === "object"
  );
}

export function defineEvent<N extends string, S extends z.ZodType>(
  def: DomainEventDef<N, S>,
): DomainEventDef<N, S> {
  return def;
}
