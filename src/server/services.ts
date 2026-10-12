// Server composition: DB, bus, command layer, registries. One instance per server / test.
import type { DomainEventDef } from "@shared/events";
import { domainEvents } from "@shared/events";
import type { z } from "zod";
import { type CommandDef, Commands, type CommitHook } from "./commands/commands";
import { type Clock, type CommandContext, realContext, systemClock } from "./commands/context";
import type { Config } from "./config";
import type { Db } from "./db/client";
import { EventBus, type Listener } from "./events/bus";
import { features } from "./features";
import { ImportRegistry } from "./features/fixtures-adapters/import-pipeline";
import type { Logger } from "./log";
import type { HubApi } from "./ws/hub";
import { type ActiveSceneResolver, type AnyRecordType, RecordRegistry } from "./ws/records";
import { type SignalDef, SignalRegistry } from "./ws/signals";

/** Resolvers campaign-management provides to live-sync (CAMP §9, protocol §2). */
export interface CredentialResolvers {
  /** REST: secret only (CON-15). */
  checkDmSecret(value: string): "ok" | "invalid" | "throttled";
  verifyDmCredential(
    value: string,
  ): { campaignId: string } | "invalid" | "throttled" | "noActiveCampaign";
  resolvePlayerLink(
    token: string,
  ): { campaignId: string; playerId: string; campaignActive: boolean } | null;
}

export interface Services {
  config: Config;
  db: Db;
  log: Logger;
  /** Real clock for the hub and throttle; injectable in tests (FR-SYNC-26). */
  clock: Clock;
  bus: EventBus;
  commands: Commands;
  records: RecordRegistry;
  /** Command names callable as WS intents. */
  intents: Set<string>;
  /** Transient signals (FR-SYNC-22, ADR-0026). */
  signals: SignalRegistry;
  auth: CredentialResolvers;
  /** Import pipeline kinds + definition store (entities plugs in here, CON-03). */
  imports: ImportRegistry;
  /** Set once the WS hub exists (after registration). */
  hub: HubApi | null;
}

export interface Registrar {
  services: Services;
  command<S extends z.ZodType, R>(def: CommandDef<S, R>, opts?: { intent?: boolean }): void;
  event(def: DomainEventDef): void;
  recordType(def: AnyRecordType): void;
  signal(def: SignalDef): void;
  /** The campaign's active scene for the `scene` scope gate (CON-22); one provider. */
  activeScene(resolver: ActiveSceneResolver): void;
  listener(name: string, fn: Listener): void;
  /** Post-commit, pre-listener cache refresh (CON-23). */
  afterCommit(name: string, fn: CommitHook): void;
  provideAuth(resolvers: CredentialResolvers): void;
}

export interface Feature {
  name: string;
  register(r: Registrar): void;
}

export interface ServicesOptions {
  config: Config;
  db: Db;
  log: Logger;
  clock?: Clock;
  /** Default command context factory; real (CSPRNG + clock) unless a test overrides it. */
  ctx?: () => CommandContext;
}

const missingAuth: CredentialResolvers = {
  checkDmSecret: () => "invalid",
  verifyDmCredential: () => "invalid",
  resolvePlayerLink: () => null,
};

export function createServices(opts: ServicesOptions): Services {
  const clock = opts.clock ?? systemClock;
  const bus = new EventBus(opts.log);
  const ctxFactory = opts.ctx ?? (() => realContext(clock));
  const commands = new Commands(opts.db, bus, ctxFactory, opts.log);
  const services: Services = {
    config: opts.config,
    db: opts.db,
    log: opts.log,
    clock,
    bus,
    commands,
    records: new RecordRegistry(),
    intents: new Set(),
    signals: new SignalRegistry(),
    auth: missingAuth,
    hub: null,
    imports: new ImportRegistry(),
  };
  for (const e of domainEvents) commands.registerEvent(e);

  const registrar: Registrar = {
    services,
    command(def, o) {
      commands.register(def as unknown as CommandDef);
      if (o?.intent) services.intents.add(def.name);
    },
    event: (def) => commands.registerEvent(def),
    recordType: (def) => services.records.register(def),
    signal: (def) => services.signals.register(def),
    activeScene: (fn) => services.records.provideActiveScene(fn),
    listener: (name, fn) => bus.subscribe(name, fn),
    afterCommit: (name, fn) => commands.afterCommit(name, fn),
    provideAuth(r) {
      services.auth = r;
    },
  };
  for (const f of features) f.register(registrar);
  return services;
}
