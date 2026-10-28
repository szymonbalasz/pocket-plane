// The hit looks (VFX §7.2, FR-VFX-18): one per damage type, healing, untyped and glance. Each
// draws on the over pass in map px around the target's drawn centre, inside 1.6 × its footprint
// at the largest scale (every point within `reach(f)` = 0.5 × side × scale ≤ 0.78 × side), lasts
// 0.4–1.4 s and stays subtle: no screen flash, no camera move. `f.random` is re-seeded by the cue
// id each frame (FR-VFX-14), so a look's scatter is the same on every frame and every load.
import type { HitLookKey } from "@shared/spell-fx/cue";
import { ease } from "./aura-types";
import type { HitLook, HitLookFrame } from "./hit-looks";
import { seededRandom } from "./prng";
import { dot, type Rgb } from "./sprites";

const TAU = Math.PI * 2;

/** The look's largest distance from the centre (map px). */
const reach = (f: HitLookFrame) => f.size * 0.5 * f.scale;
const progress = (f: HitLookFrame, duration: number) => Math.min(1, Math.max(0, f.t / duration));

function ring(
  ctx: CanvasRenderingContext2D,
  rgb: Rgb,
  x: number,
  y: number,
  r: number,
  width: number,
  a: number,
  from = 0,
  to = TAU,
) {
  if (r <= 0 || a <= 0) return;
  ctx.globalAlpha = Math.min(1, a);
  ctx.strokeStyle = `rgb(${rgb})`;
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.arc(x, y, r, from, to);
  ctx.stroke();
}

function line(
  ctx: CanvasRenderingContext2D,
  rgb: Rgb,
  pts: readonly (readonly [number, number])[],
  width: number,
  a: number,
) {
  if (pts.length < 2 || a <= 0) return;
  ctx.globalAlpha = Math.min(1, a);
  ctx.strokeStyle = `rgb(${rgb})`;
  ctx.lineWidth = width;
  ctx.lineCap = "round";
  ctx.beginPath();
  pts.forEach(([x, y], i) => {
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();
}

/** Clamps a point to `max` from (cx, cy). */
function clampTo(cx: number, cy: number, x: number, y: number, max: number): [number, number] {
  const d = Math.hypot(x - cx, y - cy);
  if (d <= max || d === 0) return [x, y];
  return [cx + ((x - cx) / d) * max, cy + ((y - cy) / d) * max];
}

interface LookDef extends HitLook {
  /** Particles while it plays (FR-VFX-29 budget). */
  particles: number;
}

function look(
  key: HitLookKey,
  duration: number,
  particles: number,
  draw: (ctx: CanvasRenderingContext2D, f: HitLookFrame, p: number, R: number) => void,
): LookDef {
  return {
    key,
    duration,
    particles,
    draw(ctx, f) {
      draw(ctx, f, progress(f, duration), reach(f));
      ctx.globalAlpha = 1;
    },
  };
}

/** Sprites flying out from the centre: `n`, seeded angles, out to `out` × R, radius `size` × R. */
function burst(
  ctx: CanvasRenderingContext2D,
  f: HitLookFrame,
  R: number,
  rgb: Rgb,
  n: number,
  out: number,
  size: number,
  alpha: number,
  fall = 0,
) {
  for (let i = 0; i < n; i++) {
    const a = f.random() * TAU;
    const d = (0.4 + 0.6 * f.random()) * out * R;
    const r = size * R * (0.6 + 0.4 * f.random());
    const [x, y] = clampTo(
      f.x,
      f.y,
      f.x + Math.cos(a) * d,
      f.y + Math.sin(a) * d + fall * R,
      R - r,
    );
    dot(ctx, rgb, x, y, r, alpha);
  }
}

const acid = look("acid", 0.9, 14, (ctx, f, p, R) => {
  // Droplets splash out and fall; the token fizzes.
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (f.random() - 0.5) * Math.PI * 1.4;
    const v = 0.35 + 0.35 * f.random();
    const r = R * 0.08;
    const x = f.x + Math.cos(a) * v * R * ease(p);
    const y = f.y + Math.sin(a) * v * R * ease(p) + 0.45 * R * p * p;
    const [cx, cy] = clampTo(f.x, f.y, x, y, R - r);
    dot(ctx, "120, 220, 60", cx, cy, r, 0.9 * (1 - p));
  }
  for (let i = 0; i < 4; i++) {
    const on = Math.sin(p * 18 + f.random() * TAU) > 0;
    const x = f.x + (f.random() - 0.5) * R * 0.6;
    const y = f.y + (f.random() - 0.5) * R * 0.6;
    if (on) dot(ctx, "190, 255, 140", x, y, R * 0.06, 0.7 * (1 - p));
  }
});

const bludgeoning = look("bludgeoning", 0.6, 10, (ctx, f, p, R) => {
  // Dust puff and impact lines on the struck side (facing the attacker); a small shake.
  const ix = f.x - Math.cos(f.angle) * R * 0.4;
  const iy = f.y - Math.sin(f.angle) * R * 0.4;
  const shake = Math.sin(p * 60) * R * 0.03 * (1 - p);
  for (let i = 0; i < 8; i++) {
    const a = f.angle + Math.PI + (f.random() - 0.5) * 2;
    const d = R * 0.3 * ease(p) * (0.5 + 0.5 * f.random());
    const r = R * (0.1 + 0.08 * p);
    const [x, y] = clampTo(f.x, f.y, ix + Math.cos(a) * d, iy + Math.sin(a) * d, R - r);
    dot(ctx, "170, 150, 120", x, y, r, 0.5 * (1 - p));
  }
  for (let i = 0; i < 4; i++) {
    const a = f.angle + Math.PI + (i - 1.5) * 0.45;
    const r0 = R * (0.1 + 0.15 * p);
    const r1 = r0 + R * 0.2;
    line(
      ctx,
      "235, 225, 210",
      [
        [ix + Math.cos(a) * r0 + shake, iy + Math.sin(a) * r0],
        [ix + Math.cos(a) * r1 + shake, iy + Math.sin(a) * r1],
      ],
      R * 0.04,
      0.8 * (1 - p),
    );
  }
});

const cold = look("cold", 1, 12, (ctx, f, p, R) => {
  // Ice shards grow from the rim in a pale mist.
  burst(ctx, f, R, "200, 230, 255", 6, 0.55, 0.22, 0.35 * (1 - p));
  const grow = ease(Math.min(1, p * 2.5));
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * TAU + f.random() * 0.4;
    const base = R * 0.85;
    const tip = base - R * 0.45 * grow;
    const w = 0.12;
    ctx.globalAlpha = 0.85 * (1 - ease(Math.max(0, (p - 0.6) / 0.4)));
    ctx.fillStyle = "rgb(215, 240, 255)";
    ctx.beginPath();
    ctx.moveTo(f.x + Math.cos(a - w) * base, f.y + Math.sin(a - w) * base);
    ctx.lineTo(f.x + Math.cos(a) * tip, f.y + Math.sin(a) * tip);
    ctx.lineTo(f.x + Math.cos(a + w) * base, f.y + Math.sin(a + w) * base);
    ctx.closePath();
    ctx.fill();
  }
});

const fire = look("fire", 0.9, 18, (ctx, f, p, R) => {
  // A flare and rising embers.
  const flare = Math.sin(Math.min(1, p * 2.2) * Math.PI);
  dot(ctx, "255, 140, 40", f.x, f.y, R * (0.45 + 0.2 * flare), 0.55 * flare);
  dot(ctx, "255, 220, 120", f.x, f.y, R * 0.25, 0.7 * flare);
  for (let i = 0; i < 14; i++) {
    const x0 = (f.random() - 0.5) * R * 0.9;
    const rise = (0.3 + 0.5 * f.random()) * R;
    const life = Math.min(1, Math.max(0, p * 1.3 - f.random() * 0.3));
    const r = R * 0.06;
    const [x, y] = clampTo(
      f.x,
      f.y,
      f.x + x0 + Math.sin(life * 6 + i) * R * 0.05,
      f.y + R * 0.2 - rise * life,
      R - r,
    );
    dot(ctx, i % 3 ? "255, 160, 50" : "255, 230, 140", x, y, r, 0.9 * Math.sin(life * Math.PI));
  }
});

function hexagon(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, rot: number) {
  ctx.beginPath();
  for (let i = 0; i <= 6; i++) {
    const a = rot + (i / 6) * TAU;
    const px = x + Math.cos(a) * r;
    const py = y + Math.sin(a) * r;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
}

const force = look("force", 0.7, 0, (ctx, f, p, R) => {
  // Two hexagonal ripples.
  for (const lag of [0, 0.25]) {
    const q = Math.max(0, Math.min(1, (p - lag) / (1 - lag)));
    if (q <= 0) continue;
    ctx.globalAlpha = 0.75 * (1 - q);
    ctx.strokeStyle = "rgb(170, 190, 255)";
    ctx.lineWidth = R * 0.05;
    hexagon(ctx, f.x, f.y, R * (0.25 + 0.65 * ease(q)), f.angle);
    ctx.stroke();
  }
});

const lightning = look("lightning", 0.6, 0, (ctx, f, p, R) => {
  // Forked bolts flickering across.
  const step = Math.floor(p * 12);
  const jitter = seededRandom(Math.floor(f.random() * 1e9) + step);
  const visible = step % 3 !== 2;
  if (!visible) return;
  for (let b = 0; b < 2; b++) {
    const a = f.angle + (b === 0 ? 0 : Math.PI / 2) + (jitter() - 0.5) * 0.6;
    const pts: [number, number][] = [];
    for (let k = 0; k <= 6; k++) {
      const u = (k / 6) * 2 - 1;
      const off = k === 0 || k === 6 ? 0 : (jitter() - 0.5) * R * 0.3;
      pts.push(
        clampTo(
          f.x,
          f.y,
          f.x + Math.cos(a) * u * R * 0.8 - Math.sin(a) * off,
          f.y + Math.sin(a) * u * R * 0.8 + Math.cos(a) * off,
          R * 0.95,
        ),
      );
    }
    line(ctx, "150, 190, 255", pts, R * 0.08, 0.45 * (1 - p));
    line(ctx, "240, 245, 255", pts, R * 0.03, 0.95 * (1 - p * 0.7));
  }
});

const necrotic = look("necrotic", 1.2, 14, (ctx, f, p, R) => {
  // Life drawn in (first half), then lifted away as green wisps.
  for (let i = 0; i < 12; i++) {
    const a = f.random() * TAU;
    const start = (0.6 + 0.2 * f.random()) * R;
    const r = R * 0.07;
    if (p < 0.5) {
      const q = ease(p / 0.5);
      const d = start * (1 - q);
      dot(ctx, "190, 40, 60", f.x + Math.cos(a) * d, f.y + Math.sin(a) * d, r, 0.7 * (1 - q * 0.5));
    } else {
      const q = (p - 0.5) / 0.5;
      const [x, y] = clampTo(
        f.x,
        f.y,
        f.x + Math.cos(a) * R * 0.25 + Math.sin(q * 5 + i) * R * 0.08,
        f.y - q * R * 0.6,
        R - r,
      );
      dot(ctx, "120, 230, 130", x, y, r * 1.3, 0.6 * (1 - q));
    }
  }
});

const piercing = look("piercing", 0.5, 8, (ctx, f, p, R) => {
  // A streak through the token along the attack, sparks at the exit.
  const c = Math.cos(f.angle);
  const s = Math.sin(f.angle);
  const head = -0.75 + 1.5 * ease(Math.min(1, p * 1.8));
  const tail = Math.max(-0.75, head - 0.8);
  line(
    ctx,
    "245, 240, 230",
    [
      [f.x + c * tail * R, f.y + s * tail * R],
      [f.x + c * head * R, f.y + s * head * R],
    ],
    R * 0.05,
    0.9 * (1 - p * 0.6),
  );
  if (p > 0.4) {
    const q = (p - 0.4) / 0.6;
    const ex = f.x + c * 0.6 * R;
    const ey = f.y + s * 0.6 * R;
    for (let i = 0; i < 6; i++) {
      const a = f.angle + (f.random() - 0.5) * 1.6;
      const d = R * 0.15 * ease(q);
      const r = R * 0.04;
      const [x, y] = clampTo(f.x, f.y, ex + Math.cos(a) * d, ey + Math.sin(a) * d, R - r);
      dot(ctx, "255, 220, 150", x, y, r, 0.9 * (1 - q));
    }
  }
});

const poison = look("poison", 1.2, 12, (ctx, f, p, R) => {
  // A murky green cloud drifts off.
  for (let i = 0; i < 10; i++) {
    const a = f.random() * TAU;
    const d = f.random() * R * 0.3;
    const r = R * (0.16 + 0.1 * ease(p));
    const [x, y] = clampTo(
      f.x,
      f.y,
      f.x + Math.cos(a) * d + R * 0.15 * p,
      f.y + Math.sin(a) * d - R * 0.3 * p,
      R - r,
    );
    dot(ctx, i % 2 ? "90, 130, 50" : "120, 160, 60", x, y, r, 0.45 * Math.sin(Math.PI * p));
  }
});

const psychic = look("psychic", 0.9, 0, (ctx, f, p, R) => {
  // Pink rings closing in.
  for (let i = 0; i < 3; i++) {
    const q = Math.max(0, Math.min(1, (p - i * 0.15) / 0.7));
    if (q <= 0 || q >= 1) continue;
    ring(
      ctx,
      "255, 130, 210",
      f.x,
      f.y,
      R * (0.9 - 0.75 * ease(q)),
      R * 0.04,
      0.8 * Math.sin(q * Math.PI),
    );
  }
});

const radiant = look("radiant", 0.8, 10, (ctx, f, p, R) => {
  // Golden rays and a flash.
  const flash = Math.sin(Math.min(1, p * 2) * Math.PI);
  dot(ctx, "255, 240, 190", f.x, f.y, R * 0.45, 0.6 * flash);
  const len = ease(Math.min(1, p * 1.8));
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * TAU + f.random() * 0.2;
    line(
      ctx,
      "255, 215, 110",
      [
        [f.x + Math.cos(a) * R * 0.2, f.y + Math.sin(a) * R * 0.2],
        [f.x + Math.cos(a) * R * (0.2 + 0.7 * len), f.y + Math.sin(a) * R * (0.2 + 0.7 * len)],
      ],
      R * 0.035,
      0.8 * (1 - p),
    );
  }
});

const slashing = look("slashing", 0.6, 0, (ctx, f, p, R) => {
  // Two crescent cuts across the token.
  for (let k = 0; k < 2; k++) {
    const q = Math.max(0, Math.min(1, (p - k * 0.2) / 0.6));
    if (q <= 0) continue;
    const off = (k === 0 ? -1 : 1) * R * 0.18;
    const nx = -Math.sin(f.angle);
    const ny = Math.cos(f.angle);
    const cx = f.x + nx * off - Math.cos(f.angle) * R * 0.35;
    const cy = f.y + ny * off - Math.sin(f.angle) * R * 0.35;
    const from = f.angle - 0.9;
    const to = from + 1.8 * ease(Math.min(1, q * 1.6));
    ring(ctx, "250, 245, 240", cx, cy, R * 0.55, R * 0.05, 0.9 * (1 - q * 0.8), from, to);
  }
});

const thunder = look("thunder", 0.7, 0, (ctx, f, p, R) => {
  // Shock rings and a shake.
  const shake = Math.sin(p * 70) * R * 0.04 * (1 - p);
  for (const lag of [0, 0.2]) {
    const q = Math.max(0, Math.min(1, (p - lag) / (1 - lag)));
    if (q <= 0) continue;
    ring(
      ctx,
      "200, 210, 255",
      f.x + shake,
      f.y,
      R * (0.2 + 0.7 * ease(q)),
      R * 0.06 * (1 - q),
      0.8 * (1 - q),
    );
  }
});

const healing = look("healing", 1.2, 14, (ctx, f, p, R) => {
  // Green motes and small crosses rising.
  for (let i = 0; i < 10; i++) {
    const x0 = (f.random() - 0.5) * R;
    const delay = f.random() * 0.4;
    const q = Math.max(0, Math.min(1, (p - delay) / 0.6));
    const r = R * 0.06;
    const [x, y] = clampTo(f.x, f.y, f.x + x0 * 0.8, f.y + R * 0.4 - q * R * 0.9, R - r);
    const a = Math.sin(q * Math.PI);
    if (i % 3 === 0) {
      const c = R * 0.07;
      line(
        ctx,
        "150, 255, 160",
        [
          [x - c, y],
          [x + c, y],
        ],
        R * 0.03,
        0.9 * a,
      );
      line(
        ctx,
        "150, 255, 160",
        [
          [x, y - c],
          [x, y + c],
        ],
        R * 0.03,
        0.9 * a,
      );
    } else dot(ctx, "110, 230, 120", x, y, r, 0.8 * a);
  }
});

const untyped = look("untyped", 0.5, 0, (ctx, f, p, R) => {
  // One white impact ring.
  ring(
    ctx,
    "245, 245, 245",
    f.x,
    f.y,
    R * (0.25 + 0.6 * ease(p)),
    R * 0.05 * (1 - p * 0.5),
    0.85 * (1 - p),
  );
});

const glance = look("glance", 0.6, 0, (ctx, f, p, R) => {
  // A dull grey ring that stops short.
  const q = ease(Math.min(1, p * 2));
  const fade = p < 0.5 ? 0.7 : 0.7 * (1 - (p - 0.5) / 0.5);
  ring(
    ctx,
    "150, 150, 150",
    f.x,
    f.y,
    R * (0.25 + 0.3 * q),
    R * 0.045,
    fade,
    f.angle + 0.6,
    f.angle + TAU - 0.6,
  );
});

/** Every look, keyed (the registry lines in `hit-looks.ts` take them from here). */
export const LOOKS = {
  acid,
  bludgeoning,
  cold,
  fire,
  force,
  lightning,
  necrotic,
  piercing,
  poison,
  psychic,
  radiant,
  slashing,
  thunder,
  healing,
  untyped,
  glance,
} satisfies Record<HitLookKey, LookDef>;

/** FR-VFX-29: particles a playing look holds (0 for line-only looks). */
export const lookParticles = (key: HitLookKey): number => LOOKS[key].particles;
