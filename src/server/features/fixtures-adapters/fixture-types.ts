// Fixture and bundle format (FR-FIX-12–15). Fixture modules live in `fixtures/` (AGENTS §9.3).
import type { z } from "zod";
import type { CommandDef } from "../../commands/commands";
import type { ImportBatch } from "./import-pipeline";

/** Records created by earlier fixtures, by fixture key (FR-FIX-14). */
export interface Refs {
  ids(fixtureKey: string, recordType: string): string[];
  id(fixtureKey: string, recordType: string, index?: number): string;
}

export interface SetupStep {
  command: string;
  /** A function input may be async; the loader awaits it before running the command. */
  input: unknown | ((refs: Refs) => unknown | Promise<unknown>);
  /**
   * The player who sends it: a loaded fixture's key whose `player` record is the actor (e.g.
   * `"player-1"`); absent = the DM (CBT §13.1 `late-hit-ruled`: "as player-1").
   */
  as?: string;
}

interface FixtureBase {
  key: string;
  /** Required fixture keys (applied first). */
  requires: readonly string[];
  /** Spec that owns the record shapes. */
  ownerSpec: string;
  /** Files under `fixtures/assets/`, ingested via the asset store (FR-FIX-17). */
  assets?: readonly string[];
}

export interface SetupFixture extends FixtureBase {
  kind: "setup";
  steps: readonly SetupStep[];
}

export interface ReferenceFixture extends FixtureBase {
  kind: "reference";
  batch: ImportBatch;
}

export type Fixture = SetupFixture | ReferenceFixture;

export interface Bundle {
  name: string;
  /** Other bundles; every bundle except `base` includes `base` (FR-FIX-15). */
  includes: readonly string[];
  fixtures: readonly string[];
}

export interface FixtureLibrary {
  fixtures: readonly Fixture[];
  bundles: readonly Bundle[];
}

/** A typed setup step: input checked against the command's schema at compile time. */
export function step<C extends CommandDef>(
  command: C,
  input: z.input<C["input"]> | ((refs: Refs) => z.input<C["input"]> | Promise<z.input<C["input"]>>),
  opts: { as?: string } = {},
): SetupStep {
  return { command: command.name, input, ...(opts.as !== undefined ? { as: opts.as } : {}) };
}

export const defineFixture = <F extends Fixture>(f: F): F => f;
export const defineBundle = (b: Bundle): Bundle => b;
