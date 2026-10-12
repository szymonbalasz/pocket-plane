// Command layer (ADR-0016, FR-SYNC-13/16, FR-CAMP-20): validate → authorize → mutate +
// event-log append in one transaction → commit → domain events on the bus (synchronous).
import type { DomainEventDef } from "@shared/events";
import { z } from "zod";
import type { Db, Tx } from "../db/client";
import type { EventBus } from "../events/bus";
import { appendEventLog } from "../events/log";
import type { Actor, DomainEvent, Role } from "../events/types";
import type { Logger } from "../log";
import type { CommandContext } from "./context";
import { CommandError, forbidden, zodIssues } from "./errors";

export interface CommandEnv {
  tx: Tx;
  ctx: CommandContext;
  actor: Actor;
  /** Queue a domain event; validated + logged in this transaction, dispatched after commit. */
  emit(event: DomainEvent): void;
}

export interface CommandDef<S extends z.ZodType = z.ZodType, R = unknown> {
  /** `<feature>.<verb>` */
  name: string;
  input: S;
  /** Default `["dm"]` (FR-SYNC-13). */
  roles?: readonly Role[];
  /** Ownership check for player-writable commands; throw `forbidden`. Runs inside the tx. */
  authorize?(input: z.output<S>, env: CommandEnv): void;
  execute(input: z.output<S>, env: CommandEnv): R;
}

export function defineCommand<S extends z.ZodType, R>(def: CommandDef<S, R>): CommandDef<S, R> {
  return def;
}

export interface RunOptions {
  actor: Actor;
  /** Seeded context during fixture load / tests; real otherwise. */
  ctx?: CommandContext;
  intentId?: string | null;
  originConnId?: string | null;
}

export type CommandResult<C> = C extends CommandDef<z.ZodType, infer R> ? R : never;

export class Commands {
  private defs = new Map<string, CommandDef>();
  private eventDefs = new Map<string, DomainEventDef>();

  constructor(
    private readonly db: Db,
    private readonly bus: EventBus,
    private readonly defaultCtx: () => CommandContext,
    private readonly log: Logger,
  ) {}

  register(def: CommandDef): void {
    if (this.defs.has(def.name)) throw new Error(`Command "${def.name}" registered twice`);
    this.defs.set(def.name, def);
  }

  registerEvent(def: DomainEventDef): void {
    if (this.eventDefs.has(def.type)) throw new Error(`Event "${def.type}" registered twice`);
    this.eventDefs.set(def.type, def);
  }

  has(name: string): boolean {
    return this.defs.has(name);
  }

  names(): string[] {
    return [...this.defs.keys()];
  }

  /** Synchronous: listeners (incl. the broadcaster) have run when this returns. */
  run<C extends CommandDef>(def: C, input: z.input<C["input"]>, opts: RunOptions): CommandResult<C>;
  run(name: string, input: unknown, opts: RunOptions): unknown;
  run(nameOrDef: string | CommandDef, rawInput: unknown, opts: RunOptions): unknown {
    const name = typeof nameOrDef === "string" ? nameOrDef : nameOrDef.name;
    const def = this.defs.get(name);
    if (!def) throw new CommandError("unknown_intent", `Unknown command "${name}"`);

    const roles = def.roles ?? ["dm"];
    if (opts.actor.role !== "system" && !roles.includes(opts.actor.role)) throw forbidden();

    const parsed = def.input.safeParse(rawInput);
    if (!parsed.success) {
      throw new CommandError("invalid", "Invalid input", zodIssues(parsed.error));
    }

    const ctx = opts.ctx ?? this.defaultCtx();
    const intentId = opts.intentId ?? null;
    const events: DomainEvent[] = [];

    let result: unknown;
    try {
      result = this.db.transaction((tx) => {
        const env: CommandEnv = { tx, ctx, actor: opts.actor, emit: (e) => events.push(e) };
        def.authorize?.(parsed.data, env);
        const r = def.execute(parsed.data, env);
        for (const e of events) {
          const ed = this.eventDefs.get(e.type);
          if (!ed) throw new Error(`Unregistered domain event "${e.type}"`);
          e.payload = ed.payload.parse(e.payload);
          if (ed.logged) appendEventLog(tx, ctx, e, { actor: opts.actor, intentId });
        }
        return r;
      });
    } catch (err) {
      if (err instanceof CommandError) throw err;
      this.log.error(`command ${name} failed`, err);
      throw new CommandError("internal", "Internal error");
    }

    for (const e of events) {
      this.bus.dispatch({
        event: e,
        meta: { actor: opts.actor, intentId, originConnId: opts.originConnId ?? null },
      });
    }
    return result;
  }
}

export const IdSchema = z.string().min(1).max(64);
