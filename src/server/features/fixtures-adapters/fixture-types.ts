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
  input: unknown | ((refs: Refs) => unknown);
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
  input: z.input<C["input"]> | ((refs: Refs) => z.input<C["input"]>),
): SetupStep {
  return { command: command.name, input };
}

export const defineFixture = <F extends Fixture>(f: F): F => f;
export const defineBundle = (b: Bundle): Bundle => b;
