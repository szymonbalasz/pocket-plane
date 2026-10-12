// The ID / token / clock seam (ADR-0022, AGENTS §9.3). The only place commands get
// IDs, secret tokens and "now". Real by default; seeded only on disposable data.
import { createHash, randomBytes, randomUUID } from "node:crypto";

export interface Clock {
  /** Epoch ms. */
  now(): number;
  /** ISO-8601 UTC, the stored timestamp format. */
  iso(): string;
}

export interface IdSource {
  /** UUID v4 format, real or seeded. */
  next(): string;
}

export interface TokenSource {
  /** 128 bits, base64url (22 chars). */
  next(): string;
}

/**
 * Dice engine (FR-DICE-03, #137): the random-js engine contract the dice library takes.
 * `next()` returns a uniformly distributed signed 32-bit integer.
 */
export interface DiceEngine {
  next(): number;
}

export interface CommandContext {
  ids: IdSource;
  tokens: TokenSource;
  clock: Clock;
  /** The only source of dice randomness; roll via `rollDice(ctx.dice, …)` (`./dice`). */
  dice: DiceEngine;
}

export const systemClock: Clock = {
  now: () => Date.now(),
  iso: () => new Date().toISOString(),
};

export function fixedClock(at: string | number): Clock {
  const ms = typeof at === "number" ? at : Date.parse(at);
  if (Number.isNaN(ms)) throw new Error(`Invalid fixed clock instant: ${at}`);
  const iso = new Date(ms).toISOString();
  return { now: () => ms, iso: () => iso };
}

/** Manually advanced clock for tests (FR-SYNC-26). */
export function manualClock(start = Date.parse("2026-01-01T00:00:00Z")) {
  let ms = start;
  return {
    now: () => ms,
    iso: () => new Date(ms).toISOString(),
    advance(by: number) {
      ms += by;
    },
    set(to: number) {
      ms = to;
    },
  };
}

export function formatUuid(bytes: Uint8Array): string {
  const b = Uint8Array.from(bytes.subarray(0, 16));
  b[6] = ((b[6] ?? 0) & 0x0f) | 0x40;
  b[8] = ((b[8] ?? 0) & 0x3f) | 0x80;
  const h = Buffer.from(b).toString("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** Int32 engine over a byte source, 4 bytes per draw (little-endian, signed). */
function int32Engine(bytes: () => Uint8Array): DiceEngine {
  let buf: Buffer = Buffer.alloc(0);
  let at = 0;
  return {
    next() {
      if (at + 4 > buf.length) {
        const b = bytes();
        buf = Buffer.from(b.buffer, b.byteOffset, b.byteLength);
        at = 0;
      }
      const v = buf.readInt32LE(at);
      at += 4;
      return v;
    },
  };
}

/** Real dice: CSPRNG (FR-DICE-03). The running server always uses this. */
export function realDice(): DiceEngine {
  return int32Engine(() => randomBytes(256));
}

export function realContext(clock: Clock = systemClock): CommandContext {
  return {
    ids: { next: () => randomUUID() },
    tokens: { next: () => randomBytes(16).toString("base64url") },
    clock,
    dice: realDice(),
  };
}

/** Deterministic byte stream: SHA-256 in counter mode over (seed, key, stream). */
function seededStream(seed: string, key: string, stream: string): () => Uint8Array {
  let counter = 0;
  return () => {
    const h = createHash("sha256");
    h.update(`${seed}\u0000${key}\u0000${stream}\u0000${counter++}`);
    return h.digest().subarray(0, 16);
  };
}

export class SeedNotAllowedError extends Error {
  override name = "SeedNotAllowedError";
}

export const FIXTURE_SEED = "pocket-plane-fixtures-v1";
/** One instant for every load (FR-FIX-08). */
export const FIXTURE_INSTANT = "2026-01-01T00:00:00.000Z";

export interface SeededOptions {
  /** Must be true: the data dir is flagged disposable (or a test's own temp dir). */
  disposable: boolean;
  /** Reseeded per fixture key so adding a fixture never shifts another's IDs. */
  key: string;
  seed?: string;
  clock?: Clock;
}

function refuseUnlessDisposable(disposable: boolean, what: string): void {
  if (!disposable) {
    throw new SeedNotAllowedError(
      `Seeded ${what} need a disposable data dir (PP_DATA_DISPOSABLE=1).`,
    );
  }
}

/**
 * Seeded dice engine (FR-DICE-03): deterministic per `(seed, key)`, its own stream so dice
 * draws never shift IDs or tokens. Same disposable guard as the seeded context (ADR-0022).
 */
export function seededDice(opts: { disposable: boolean; key: string; seed?: string }): DiceEngine {
  refuseUnlessDisposable(opts.disposable, "dice");
  return int32Engine(seededStream(opts.seed ?? FIXTURE_SEED, opts.key, "dice"));
}

/** IDs, tokens and dice reseeded from `(seed, key)`; the fixture loader calls it per fixture key. */
export function seededContext(opts: SeededOptions): CommandContext {
  refuseUnlessDisposable(opts.disposable, "IDs/tokens/dice");
  const seed = opts.seed ?? FIXTURE_SEED;
  const idBytes = seededStream(seed, opts.key, "ids");
  const tokenBytes = seededStream(seed, opts.key, "tokens");
  return {
    ids: { next: () => formatUuid(idBytes()) },
    tokens: { next: () => Buffer.from(tokenBytes()).toString("base64url") },
    clock: opts.clock ?? fixedClock(FIXTURE_INSTANT),
    dice: seededDice({ disposable: opts.disposable, key: opts.key, seed }),
  };
}
