// The FX engine (FR-VFX-11–22, -26, -29; ADR-0071): one per client, one FX clock. It keeps an
// instance per aura (seeded by the effect id), the hit looks playing (seeded by the cue id) and
// the visual-only reactions, and draws the two passes on the `objects` layer's 2D context. It
// reads token positions through `FxView` each frame (own drag, others' previews, shown cells), so
// a drag never re-renders React. Cues play on arrival only (FR-VFX-22). DOM-free.
import { type HitCue, type HitLookKey, hitLooks as pickLooks } from "@shared/spell-fx/cue";
import type { AuraSpec } from "./anchors";
import {
  type AuraFrame,
  type AuraInstance,
  type AuraReaction,
  type AuraRenderer,
  type DrawLevel,
  follow,
  STILL_T,
} from "./aura-types";
import { type HitLook, type HitLookFrame, hitLooks } from "./hit-looks";
import { lookParticles } from "./looks";
import type { FxLevel } from "./prefs";
import { seededRandom } from "./prng";
import { rendererOf } from "./renderers";

const TAU = Math.PI * 2;

/** FR-VFX-29: live particles per client across every aura and look. */
export const PARTICLE_BUDGET = 400;
/** FR-VFX-12: the DM draws a hidden token's aura at the hidden-token opacity (TokensLayer). */
export const HIDDEN_ALPHA = 0.45;

/** A token as drawn now: top-left (map px) and footprint side. */
export interface DrawnBox {
  x: number;
  y: number;
  size: number;
}

export interface FxView {
  /** Map px per 5 ft. */
  cell: number;
  /** Where the token is drawn now, or null when this canvas doesn't draw it. */
  position(tokenId: string): DrawnBox | null;
}

interface Reaction {
  kind: AuraReaction["kind"];
  targetTokenId: string;
  start: number;
}

interface Aura {
  spec: AuraSpec;
  renderer: AuraRenderer;
  inst: AuraInstance;
  /** Lagged centre (Full / Reduced). */
  x: number;
  y: number;
  placed: boolean;
  reactions: Reaction[];
}

export interface PlayingLook {
  /** `<cueId>:<look>`. */
  key: string;
  cueId: string;
  look: HitLookKey;
  tokenId: string;
  scale: number;
  angle: number;
  start: number;
  def: HitLook;
}

/** What React renders as test-ID Groups (VFX §7.3); a new object per structure change. */
export interface FxSnapshot {
  level: FxLevel;
  auras: readonly AuraSpec[];
  looks: readonly PlayingLook[];
}

const NO_VIEW: FxView = { cell: 50, position: () => null };

export class FxEngine {
  private level: FxLevel = "full";
  private view: FxView = NO_VIEW;
  private readonly auras = new Map<string, Aura>();
  private looks: PlayingLook[] = [];
  private now: number;
  private lastStep: number | null = null;
  private snap: FxSnapshot = { level: "full", auras: [], looks: [] };
  private readonly listeners = new Set<() => void>();
  private readonly wakers = new Set<() => void>();
  /** The last cue played, for walkthroughs (`vfx-over` attr `lastHit`). */
  lastHit: string | null = null;

  constructor(private readonly clock: () => number = () => performance.now() / 1000) {
    this.now = clock();
  }

  // ---------- inputs ----------

  setView(view: FxView): void {
    this.view = view;
  }

  setLevel(level: FxLevel): void {
    if (level === this.level) return;
    this.level = level;
    if (level === "off") {
      this.looks = [];
      for (const a of this.auras.values()) a.reactions = [];
    }
    this.changed();
  }

  getLevel(): FxLevel {
    return this.level;
  }

  /** Where this canvas draws the token now (null: not drawn). */
  position(tokenId: string): DrawnBox | null {
    return this.view.position(tokenId);
  }

  /** FR-VFX-11: the auras to draw now; ended ones go within this frame (VFX §11). */
  sync(specs: readonly AuraSpec[]): void {
    const keep = new Set<string>();
    let changed = false;
    for (const spec of specs) {
      keep.add(spec.key);
      const old = this.auras.get(spec.key);
      if (old && sameSpec(old.spec, spec)) {
        if (old.spec.hidden !== spec.hidden || old.spec.cover !== spec.cover) changed = true;
        old.spec = spec;
        continue;
      }
      const renderer = rendererOf(spec.preset.key);
      if (!renderer) continue;
      this.auras.set(spec.key, {
        spec,
        renderer,
        // FR-VFX-14: seeded by the effect id (two tokens of one character share the look).
        inst: renderer.create(spec.effectId, spec.params),
        x: 0,
        y: 0,
        placed: false,
        reactions: old?.reactions ?? [],
      });
      changed = true;
    }
    for (const k of [...this.auras.keys()]) {
      if (keep.has(k)) continue;
      this.auras.delete(k);
      changed = true;
    }
    if (changed || specs.length !== this.snap.auras.length) this.changed();
  }

  /**
   * FR-VFX-19–22, -16: plays a cue's looks on its target (and a lash from a `hitOnAnchor` aura on
   * it toward the attacker). Off, or a target this canvas doesn't draw → dropped. True if played.
   */
  playCue(cue: HitCue): boolean {
    if (this.level === "off") return false;
    const target = this.view.position(cue.targetTokenId);
    if (!target) return false;
    const picks = pickLooks(cue);
    if (picks.length === 0) return false;
    const attacker = cue.attackerTokenId ? this.view.position(cue.attackerTokenId) : null;
    const angle = attacker
      ? Math.atan2(
          target.y + target.size / 2 - (attacker.y + attacker.size / 2),
          target.x + target.size / 2 - (attacker.x + attacker.size / 2),
        )
      : seededRandom(cue.id)() * TAU;
    const now = this.clock();
    for (const p of picks) {
      const def = hitLooks[p.key];
      if (!def) continue;
      this.looks.push({
        key: `${cue.id}:${p.key}`,
        cueId: cue.id,
        look: p.key,
        tokenId: cue.targetTokenId,
        scale: p.scale,
        angle,
        start: now,
        def,
      });
      this.lastHit = `${cue.id}:${p.key}`;
    }
    if (cue.kind === "damage" && attacker && cue.attackerTokenId) {
      for (const a of this.auras.values()) {
        if (a.spec.tokenId !== cue.targetTokenId) continue;
        if (!a.spec.preset.reactions?.includes("hitOnAnchor")) continue;
        a.reactions.push({ kind: "lash", targetTokenId: cue.attackerTokenId, start: now });
      }
    }
    this.enforceBudget();
    this.changed();
    return true;
  }

  /** FR-VFX-15: the aura `key` strikes the token `targetTokenId` (the caller picked it). */
  strike(key: string, targetTokenId: string): void {
    if (this.level === "off") return;
    const a = this.auras.get(key);
    if (!a) return;
    a.reactions.push({ kind: "strike", targetTokenId, start: this.clock() });
    this.wake();
  }

  // ---------- clock ----------

  /** Advances the FX clock to `now` (seconds): lag, particle respawns, ended looks / reactions. */
  step(now: number = this.clock()): void {
    const dt = this.lastStep === null ? 0 : Math.min(0.1, Math.max(0, now - this.lastStep));
    this.lastStep = now;
    this.now = now;
    const level = this.drawLevel();
    for (const a of this.auras.values()) {
      const box = this.view.position(a.spec.tokenId);
      if (!box) continue;
      const cx = box.x + box.size / 2;
      const cy = box.y + box.size / 2;
      if (!a.placed || level === "still") {
        a.x = cx;
        a.y = cy;
      } else {
        const k = follow(dt, a.renderer.lagSeconds);
        a.x += (cx - a.x) * k;
        a.y += (cy - a.y) * k;
      }
      const f = this.frame(a, box, level ?? "still");
      if (!a.placed) {
        a.inst.reset(f);
        a.placed = true;
      } else if (level && level !== "still") a.inst.step(dt, f);
      a.reactions = a.reactions.filter((r) => now - r.start < a.renderer.reactionSeconds);
    }
    const before = this.looks.length;
    this.looks = this.looks.filter((l) => now - l.start < l.def.duration);
    if (this.looks.length !== before) this.changed();
  }

  /** Something moves: an aura at Full / Reduced, a look, a reaction (FR-VFX-26, VFX §12). */
  animating(onScreen: (b: DrawnBox) => boolean = () => true): boolean {
    if (this.level === "off") return false;
    if (this.looks.some((l) => this.visible(l.tokenId, onScreen))) return true;
    const level = this.drawLevel();
    for (const a of this.auras.values()) {
      if (!this.visible(a.spec.tokenId, onScreen, a.spec.radiusFt)) continue;
      if (level !== "still" || a.reactions.length > 0) return true;
    }
    return false;
  }

  /** FR-VFX-29: live particles now. */
  particles(): number {
    const level = this.drawLevel();
    if (!level) return 0;
    let n = 0;
    for (const a of this.auras.values()) n += a.inst.particles(level);
    for (const l of this.looks) n += lookParticles(l.look);
    return n;
  }

  // ---------- drawing ----------

  drawUnder(ctx: CanvasRenderingContext2D): void {
    const level = this.drawLevel();
    if (!level) return;
    for (const a of this.auras.values()) {
      const f = this.drawFrame(a, level);
      if (f) a.inst.under(ctx, f);
    }
    ctx.globalAlpha = 1;
  }

  drawOver(ctx: CanvasRenderingContext2D): void {
    const level = this.drawLevel();
    if (!level) return;
    for (const a of this.auras.values()) {
      const f = this.drawFrame(a, level);
      if (!f) continue;
      const reactions: AuraReaction[] = [];
      for (const r of a.reactions) {
        const to = this.view.position(r.targetTokenId);
        if (!to) continue;
        reactions.push({
          kind: r.kind,
          toX: to.x + to.size / 2,
          toY: to.y + to.size / 2,
          age: Math.max(0, this.now - r.start),
        });
      }
      a.inst.over(ctx, f, reactions);
    }
    for (const l of this.looks) {
      const box = this.view.position(l.tokenId);
      if (!box) continue;
      const f: HitLookFrame = {
        x: box.x + box.size / 2,
        y: box.y + box.size / 2,
        size: box.size,
        angle: l.angle,
        scale: l.scale,
        random: seededRandom(l.key),
        t: Math.max(0, this.now - l.start),
      };
      l.def.draw(ctx, f);
    }
    ctx.globalAlpha = 1;
  }

  // ---------- React ----------

  snapshot = (): FxSnapshot => this.snap;

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };

  /** The loop's wake-up (anything new may animate). */
  onWake(fn: () => void): () => void {
    this.wakers.add(fn);
    return () => {
      this.wakers.delete(fn);
    };
  }

  wake(): void {
    for (const fn of [...this.wakers]) fn();
  }

  // ---------- internals ----------

  private drawLevel(): DrawLevel | null {
    return this.level === "off" ? null : this.level;
  }

  private visible(
    tokenId: string,
    onScreen: (b: DrawnBox) => boolean,
    radiusFt: number | null = null,
  ): boolean {
    const b = this.view.position(tokenId);
    if (!b) return false;
    const pad = radiusFt === null ? b.size * 0.3 : (radiusFt / 5) * this.view.cell;
    return onScreen({ x: b.x - pad, y: b.y - pad, size: b.size + pad * 2 });
  }

  private frame(a: Aura, box: DrawnBox, level: DrawLevel): AuraFrame {
    const still = level === "still";
    return {
      x: still ? box.x + box.size / 2 : a.x,
      y: still ? box.y + box.size / 2 : a.y,
      size: box.size,
      cell: this.view.cell,
      radius: ((a.spec.radiusFt ?? 0) / 5) * this.view.cell + box.size / 2,
      t: still ? STILL_T : this.now,
      level,
      alpha: a.spec.hidden ? HIDDEN_ALPHA : 1,
      cover: a.spec.cover,
    };
  }

  /** The frame to draw `a` at now; Still is a pure function of (seed, params, position). */
  private drawFrame(a: Aura, level: DrawLevel): AuraFrame | null {
    const box = this.view.position(a.spec.tokenId);
    if (!box) return null;
    if (!a.placed || level === "still") {
      // Not stepped yet, or Still: drawn at the token itself, particles snapped (FR-VFX-14).
      const f = this.frame({ ...a, x: box.x + box.size / 2, y: box.y + box.size / 2 }, box, level);
      if (level === "still") a.inst.reset(f);
      else {
        a.x = f.x;
        a.y = f.y;
        a.inst.reset(f);
        a.placed = true;
      }
      return f;
    }
    return this.frame(a, box, level);
  }

  /** FR-VFX-29: past the budget, the oldest looks end early. */
  private enforceBudget(): void {
    while (this.looks.length > 0 && this.particles() > PARTICLE_BUDGET) this.looks.shift();
  }

  private changed(): void {
    this.snap = {
      level: this.level,
      auras: [...this.auras.values()].map((a) => a.spec),
      looks: [...this.looks],
    };
    for (const fn of [...this.listeners]) fn();
    this.wake();
  }
}

const sameSpec = (a: AuraSpec, b: AuraSpec) =>
  a.preset.key === b.preset.key && JSON.stringify(a.params) === JSON.stringify(b.params);

let page: FxEngine | null = null;
/** The page's one FX engine and clock (VFX §12: one requestAnimationFrame per client). */
export const fxEngine = (): FxEngine => {
  page ??= new FxEngine();
  return page;
};
