// The 3D throw renderer (FR-DICEX-14, -15, -20, -23, -33, -34, -41, -44; ADR-0044, ADR-0048), in
// the lazy chunk only. Settles each throw headless in its arena first (settle.ts), then plays the
// recorded motion with three.js. **One WebGL canvas per page**, in the dice layer (fixed,
// full-viewport, topmost): every running throw is an arena of it with its own scene, camera,
// viewport and scissor rect (the screen arena = the viewport; the zone = its free-area rect; a
// popup's PiP = its slot, scissored to the popup's visible rect each frame; the look editor's
// preview die), drawn in one render loop that runs only while a throw moves. Pixel ratio ≤ 1.5.
import type { DiceLook, DiceMaterial } from "@shared/dice-extras/looks";
import type { DieShape } from "@shared/dice-extras/throw";
import {
  BufferGeometry,
  CanvasTexture,
  DirectionalLight,
  Float32BufferAttribute,
  Group,
  HemisphereLight,
  type Material,
  Mesh,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  OrthographicCamera,
  PCFShadowMap,
  PlaneGeometry,
  Scene,
  ShadowMaterial,
  SRGBColorSpace,
  type Texture,
  Vector3,
  WebGLRenderer,
} from "three";
import { type Arena, pixelRatioOf } from "../arena";
import { dieMesh, drawAtlas, drawD4 } from "./faces";
import {
  geometryOf,
  type LabelKind,
  labelKindOf,
  multiply,
  type Quat,
  upFace,
  uprightTurn,
  yaw,
} from "./geometry";
import { poseAt, type Simulation, STEP_HZ, settleLabels, simulate } from "./settle";

export interface Die3D {
  key: string;
  shape: DieShape;
  d100?: "tens" | "units";
  /** The server value (a d100 part: its tens / units). */
  value: number;
  kept: boolean;
  look: DiceLook;
}

export interface RestInfo {
  /** `upFace` per die key, read from the rendered mesh at rest (`data-settled`). */
  settled: Record<string, number>;
  /** Die centre per key in CSS px from the arena rect's top-left (MOD / offered labels). */
  at: Record<string, { x: number; y: number }>;
  /** Median frame time of the throw; null when too few frames to judge (FR-DICEX-23). */
  medianFrameMs: number | null;
}

/** A rect in viewport CSS px. */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface PlayOptions {
  /** The dice layer element (FR-DICEX-33): the page's one canvas lives in it. */
  layer: HTMLElement;
  /** The arena's rect in viewport CSS px, read every frame (a resize scales the running arena). */
  rect(): Rect;
  /**
   * FR-DICEX-41 (B26): the scissor, read every frame (a PiP: its popup's visible rect, minus a
   * dialog over it); null = draw nothing this frame. Default: the rect.
   */
  clip?(): Rect | null;
  /** The simulation's arena (world units), fixed for the throw (FR-DICEX-34). */
  arena: Arena;
  /** The camera's extents (world units) fitted to the rect; default the arena. */
  view?: Arena;
  /**
   * FR-DICEX-46 b: per die, where it rests (CSS px from the rect's top-left; null = where the
   * simulation leaves it): the recorded motion is shifted there over the throw and each die turns
   * about the vertical so its value ends upright, so the dice tumble into their cells (the up
   * face and value unchanged).
   */
  cells?: readonly ({ x: number; y: number } | null)[];
  /** The motion plays within this (ms; the recording sped up). Default: real time. */
  maxMs?: number;
  /** FR-DICEX-44: no shadows above 2.5 MP. */
  shadows: boolean;
  dice: readonly Die3D[];
  seed: number;
  onRest(info: RestInfo): void;
  /** The WebGL context was lost mid-throw: the caller draws flat (DICEX §11). */
  onLost(): void;
  /**
   * FR-DICEX-41 (B26) miniature: at rest, the arena's visible pixels are copied in the same task
   * as the frame that rendered them (no `preserveDrawingBuffer`) and handed here; the dice then
   * leave the shared canvas.
   */
  onStill?(still: Still): void;
}

/** Rested dice copied off the shared canvas, at their rect (viewport CSS px). */
export interface Still {
  canvas: HTMLCanvasElement;
  rect: Rect;
  /** FR-DICEX-46 a (hand-off): each die alone (drawn without its neighbours) at its box, by key. */
  dice?: Record<string, Still>;
  /** FR-DICEX-46 a: per die key, the screen turn (radians, clockwise) standing its value upright. */
  turns?: Record<string, number>;
}

export interface PlayHandle {
  /** FR-DICEX-18: jump to the final pose (reports rest if not yet). */
  snap(): void;
  /**
   * FR-DICEX-35 / -41: snap if needed, then copy the rested dice (cropped to them) into a 2D
   * canvas in the same task as the frame that rendered them (no `preserveDrawingBuffer`), and
   * take them off the shared canvas. Null once released or when nothing could be copied.
   */
  handoff(): Still | null;
  stop(): void;
}

/** FR-DICEX-24 materials, the default looks' and every look D2 stores. */
const MATERIAL: Record<DiceMaterial, (map: Texture) => Material> = {
  plastic: (map) => new MeshStandardMaterial({ map, roughness: 0.42, metalness: 0 }),
  metal: (map) => new MeshStandardMaterial({ map, roughness: 0.3, metalness: 0.6 }),
  glass: (map) =>
    new MeshPhysicalMaterial({
      map,
      roughness: 0.08,
      metalness: 0,
      clearcoat: 1,
      clearcoatRoughness: 0.05,
      transparent: true,
      opacity: 0.82,
    }),
  stone: (map) => new MeshStandardMaterial({ map, roughness: 0.92, metalness: 0 }),
};

/** A look's material over a face texture (also the look editor's preview, FR-DICEX-27). */
export const materialOf = (look: DiceLook, map: Texture): Material => MATERIAL[look.material](map);

/** Dropped dice at rest (FR-DICEX-13: dimmed). */
const DROPPED_OPACITY = 0.38;
/** FR-DICEX-23 needs this many frames to judge. */
const MIN_FRAMES = 10;
const TEXTURE_CACHE = 48;
/** Camera height (straight down; orthographic, so a die's height doesn't change its size). */
const EYE = 40;

interface Play {
  scene: Scene;
  camera: OrthographicCamera;
  rect(): Rect;
  clip?(): Rect | null;
  arena: Arena;
  /** The camera's extents (default `arena`). */
  view?: Arena;
  /** Last fitted rect size (a resize refits the camera, FR-DICEX-34). */
  fitted: { w: number; h: number };
  moving(): boolean;
  /** Advance the motion to `time`; false once at rest. */
  tick(time: number): boolean;
  /** Runs right after each draw, in the same task (the still capture). */
  drawn?(): void;
  lost(): void;
}

interface Stage {
  renderer: WebGLRenderer;
  layer: HTMLElement;
  plays: Set<Play>;
  looping: boolean;
  lost: boolean;
  size: { w: number; h: number };
}

let stage: Stage | null = null;
const textures = new Map<string, CanvasTexture>();
const materials = new Map<string, Material>();

function texture(key: string, draw: () => HTMLCanvasElement): CanvasTexture {
  const hit = textures.get(key);
  if (hit) return hit;
  const t = new CanvasTexture(draw());
  t.colorSpace = SRGBColorSpace;
  t.anisotropy = 4;
  textures.set(key, t);
  if (textures.size > TEXTURE_CACHE) {
    const [oldest] = textures.keys();
    if (oldest !== undefined) {
      textures.get(oldest)?.dispose();
      textures.delete(oldest);
      materials.get(oldest)?.dispose();
      materials.delete(oldest);
    }
  }
  return t;
}

function material(key: string, look: DiceLook, map: Texture): Material {
  let m = materials.get(key);
  if (!m) {
    m = MATERIAL[look.material](map);
    materials.set(key, m);
  }
  return m;
}

const viewportOf = (layer: HTMLElement) => ({
  w: Math.max(1, layer.clientWidth || globalThis.innerWidth || 1),
  h: Math.max(1, layer.clientHeight || globalThis.innerHeight || 1),
});

function createStage(layer: HTMLElement): Stage {
  const renderer = new WebGLRenderer({
    antialias: true,
    alpha: true,
    powerPreference: "low-power",
  });
  renderer.setPixelRatio(pixelRatioOf(globalThis.devicePixelRatio));
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = PCFShadowMap;
  renderer.autoClear = false;
  const canvas = renderer.domElement;
  canvas.style.cssText = "position:absolute;inset:0;display:block;pointer-events:none";
  canvas.setAttribute("aria-hidden", "true");
  const s: Stage = {
    renderer,
    layer,
    plays: new Set(),
    looping: false,
    lost: false,
    size: { w: 0, h: 0 },
  };
  canvas.addEventListener("webglcontextlost", (e) => {
    e.preventDefault();
    s.lost = true;
    for (const p of [...s.plays]) p.lost();
  });
  // A resize clears the canvas: draw the arenas again (rested dice stay put).
  globalThis.addEventListener?.("resize", () => {
    if (stage === s && !s.lost && !s.looping) draw(s);
  });
  return s;
}

/** The page's stage in `layer`, created (or re-created after a lost context) on demand. */
function stageIn(layer: HTMLElement): Stage {
  if (stage && (stage.lost || stage.layer !== layer)) {
    stage.renderer.setAnimationLoop(null);
    stage.renderer.dispose();
    stage.renderer.domElement.remove();
    stage = null;
  }
  if (!stage) stage = createStage(layer);
  const canvas = stage.renderer.domElement;
  if (canvas.parentElement !== layer) layer.appendChild(canvas);
  return stage;
}

/** The camera's half extents for an arena letterboxed into a `w` × `h` rect. */
function extents(arena: Arena, w: number, h: number) {
  let halfW = arena.x;
  let halfH = arena.z;
  const aspect = w / Math.max(1, h);
  if (aspect > halfW / halfH) halfW = halfH * aspect;
  else halfH = halfW / aspect;
  return { halfW, halfH };
}

/** Fit the arena into a rect (letterboxed), straight down: screen x = world x, down = +z. */
function fit(camera: OrthographicCamera, arena: Arena, w: number, h: number) {
  const { halfW, halfH } = extents(arena, w, h);
  camera.left = -halfW;
  camera.right = halfW;
  camera.top = halfH;
  camera.bottom = -halfH;
  camera.updateProjectionMatrix();
}

/** Clear the whole canvas, then draw every arena into its own viewport + scissor rect. */
function draw(s: Stage) {
  const { renderer } = s;
  const vp = viewportOf(s.layer);
  if (vp.w !== s.size.w || vp.h !== s.size.h) {
    renderer.setSize(vp.w, vp.h);
    s.size = vp;
  }
  renderer.setScissorTest(false);
  renderer.setViewport(0, 0, vp.w, vp.h);
  renderer.clear();
  for (const p of s.plays) {
    const r = p.rect();
    if (r.w < 1 || r.h < 1) continue;
    if (r.w !== p.fitted.w || r.h !== p.fitted.h) {
      fit(p.camera, p.view ?? p.arena, r.w, r.h);
      p.fitted = { w: r.w, h: r.h };
    }
    const c = p.clip ? p.clip() : r;
    if (!c || c.w < 1 || c.h < 1) continue;
    // WebGL viewports count from the bottom.
    renderer.setViewport(r.x, vp.h - r.y - r.h, r.w, r.h);
    renderer.setScissor(c.x, vp.h - c.y - c.h, c.w, c.h);
    renderer.setScissorTest(true);
    renderer.render(p.scene, p.camera);
  }
  renderer.setScissorTest(false);
  for (const p of [...s.plays]) p.drawn?.();
}

/** One loop for every arena; it stops once nothing moves (FR-DICEX-23: idle = no frames). */
function loop(s: Stage) {
  if (s.looping) return;
  s.looping = true;
  s.renderer.setAnimationLoop((time) => {
    let moving = false;
    for (const p of [...s.plays]) if (p.moving() && p.tick(time)) moving = true;
    draw(s);
    if (!moving) {
      s.looping = false;
      s.renderer.setAnimationLoop(null);
    }
  });
}

function median(xs: number[]): number | null {
  if (xs.length < MIN_FRAMES) return null;
  const sorted = [...xs].sort((a, b) => a - b);
  const m = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? (sorted[m] as number)
    : ((sorted[m - 1] as number) + (sorted[m] as number)) / 2;
}

/** An arena's scene: lights, the shadow floor (when shadows are on) and a straight-down camera. */
function arenaScene(arena: Arena, shadows: boolean) {
  const scene = new Scene();
  scene.add(new HemisphereLight(0xffffff, 0x8a8a96, 1.6));
  const sun = new DirectionalLight(0xffffff, 2.2);
  sun.position.set(-4, 14, 6);
  sun.castShadow = shadows;
  sun.shadow.mapSize.width = 1024;
  sun.shadow.mapSize.height = 1024;
  sun.shadow.camera.left = -arena.x - 1;
  sun.shadow.camera.right = arena.x + 1;
  sun.shadow.camera.top = arena.z + 1;
  sun.shadow.camera.bottom = -arena.z - 1;
  sun.shadow.camera.updateProjectionMatrix();
  sun.shadow.bias = -0.002;
  scene.add(sun);
  const own: { dispose(): void }[] = [sun]; // its shadow map
  if (shadows) {
    const plane = new PlaneGeometry(arena.x * 2 + 2, arena.z * 2 + 2).rotateX(-Math.PI / 2);
    const shade = new ShadowMaterial({ opacity: 0.28 });
    const floor = new Mesh(plane, shade);
    floor.receiveShadow = true;
    scene.add(floor);
    own.push(plane, shade);
  }
  const camera = new OrthographicCamera(-arena.x, arena.x, arena.z, -arena.z, 0.1, 100);
  camera.position.set(0, EYE, 0);
  camera.up.set(0, 0, -1);
  camera.lookAt(0, 0, 0);
  return { scene, camera, own };
}

/** Die centre in CSS px from the rect's top-left. */
function project(m: Mesh, camera: OrthographicCamera, r: Rect) {
  const v = new Vector3(m.position.x, m.position.y, m.position.z).project(camera);
  return { x: ((v.x + 1) / 2) * r.w, y: ((1 - v.y) / 2) * r.h };
}

/** Ease in-out (cubic). */
const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

/** Per die: its cell minus where the simulation rests it (world x / z), or null. */
function cellShifts(
  o: PlayOptions,
  sim: Simulation,
  last: number,
): ({ x: number; z: number } | null)[] | null {
  if (!o.cells) return null;
  const r = o.rect();
  const { halfW, halfH } = extents(o.view ?? o.arena, r.w, r.h);
  return o.dice.map((_, i) => {
    const c = o.cells?.[i];
    if (!c) return null;
    const { p } = poseAt(sim, i, last);
    // Screen x = world x, down = +z, the rect's centre at the origin.
    const x = (c.x / Math.max(1, r.w)) * 2 * halfW - halfW;
    const z = (c.y / Math.max(1, r.h)) * 2 * halfH - halfH;
    return { x: x - p[0], z: z - p[2] };
  });
}

/**
 * FR-DICEX-15 / -34: simulate in the arena, relabel, play on the page's one canvas. Throws when
 * WebGL can't start (the caller draws flat).
 */
export function playThrow(o: PlayOptions): PlayHandle {
  const s = stageIn(o.layer);
  const { scene, camera, own } = arenaScene(o.arena, o.shadows);

  const kinds = o.dice.map((d) => labelKindOf(d.shape, d.d100));
  const sim = simulate(
    o.dice.map((d, i) => ({ shape: d.shape, kind: kinds[i] as LabelKind })),
    o.seed,
    o.arena,
  );
  const labels = settleLabels(
    sim,
    o.dice.map((d) => d.value),
  );
  const group = new Group();
  const meshes = o.dice.map((d, i) => {
    const g = geometryOf(d.shape);
    const l = labels[i] as number[];
    const kind = kinds[i] as LabelKind;
    const { positions, normals, uvs } = dieMesh(g, l, kind);
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
    geometry.setAttribute("normal", new Float32BufferAttribute(normals, 3));
    geometry.setAttribute("uv", new Float32BufferAttribute(uvs, 2));
    own.push(geometry);
    const lookKey = `${d.look.body}${d.look.pips}${d.look.material}`;
    let mat: Material;
    if (d.shape === "d4") {
      // Per die: its corner labels are this die's own.
      const t = new CanvasTexture(drawD4(g, l, d.look));
      t.colorSpace = SRGBColorSpace;
      mat = MATERIAL[d.look.material](t);
      own.push(t, mat);
    } else {
      const key = `${kind}${lookKey}`;
      mat = material(
        key,
        d.look,
        texture(key, () => drawAtlas(kind, d.shape, d.look)),
      );
    }
    const mesh = new Mesh(geometry, mat);
    mesh.castShadow = o.shadows;
    group.add(mesh);
    return mesh;
  });
  scene.add(group);

  const last = sim.frameCount - 1;
  // FR-DICEX-46 b: each die's shift from where the simulation rests it to its cell (world units),
  // eased in over the throw; orientations stay the recording's.
  const shifts = cellShifts(o, sim, last);
  const turns = o.cells
    ? o.dice.map((d, i) => uprightTurn(geometryOf(d.shape), poseAt(sim, i, last).q))
    : null;
  const pose = (f: number) => {
    const k = ease(Math.min(1, f / Math.max(1, last)));
    meshes.forEach((m, i) => {
      const { p, q: q0 } = poseAt(sim, i, f);
      const d = shifts?.[i];
      const t = turns?.[i];
      const q = t ? multiply(yaw(t * k), q0) : q0;
      m.position.set(p[0] + (d ? d.x * k : 0), p[1], p[2] + (d ? d.z * k : 0));
      m.quaternion.set(q[0], q[1], q[2], q[3]);
    });
  };
  const speed = o.maxMs ? Math.max(1, ((last / STEP_HZ) * 1000) / o.maxMs) : 1;

  let start: number | null = null;
  let prev: number | null = null;
  const deltas: number[] = [];
  let released = false;
  let rested = false;

  const rest = () => {
    rested = true;
    pose(last);
    meshes.forEach((m, i) => {
      if (o.dice[i]?.kept) return;
      const dim = m.material.clone();
      dim.transparent = true;
      dim.opacity = DROPPED_OPACITY;
      dim.depthWrite = false;
      m.material = dim;
      own.push(dim);
    });
    const r = o.rect();
    const settled: Record<string, number> = {};
    const at: Record<string, { x: number; y: number }> = {};
    o.dice.forEach((d, i) => {
      const m = meshes[i] as Mesh;
      const q: Quat = [m.quaternion.x, m.quaternion.y, m.quaternion.z, m.quaternion.w];
      settled[d.key] = upFace(geometryOf(d.shape), labels[i] as number[], q);
      at[d.key] = project(m, camera, r);
    });
    o.onRest({ settled, at, medianFrameMs: median(deltas) });
  };

  const play: Play = {
    scene,
    camera,
    rect: o.rect,
    ...(o.clip && { clip: o.clip }),
    arena: o.arena,
    ...(o.view && { view: o.view }),
    fitted: { w: 0, h: 0 },
    moving: () => !rested && !released,
    tick(time) {
      if (start === null) start = time;
      if (prev !== null) deltas.push(time - prev);
      prev = time;
      const f = ((time - start) / 1000) * STEP_HZ * speed;
      if (f >= last) {
        rest();
        return false;
      }
      pose(f);
      return true;
    },
    lost: () => {
      if (!released) o.onLost();
    },
  };

  const release = () => {
    if (released) return;
    released = true;
    s.plays.delete(play);
    scene.remove(group);
    for (const x of own) x.dispose();
  };

  // FR-DICEX-41: a miniature's still, copied right after the draw that rendered it at rest.
  const onStill = o.onStill;
  if (onStill) {
    play.drawn = () => {
      if (!rested || released || s.lost) return;
      const box = o.clip ? o.clip() : o.rect();
      const still = box ? copy(s, box) : null;
      release();
      draw(s); // take the dice off the shared canvas
      if (still) onStill(still);
    };
  }

  s.plays.add(play);
  pose(0);
  draw(s);
  loop(s);
  return {
    snap() {
      if (released || rested) return;
      rest();
      if (!s.lost) draw(s);
    },
    handoff() {
      if (released) return null;
      if (!rested) rest();
      let still: Still | null = null;
      if (!s.lost) {
        draw(s);
        // Copied in the same task as the render, so the drawing buffer still holds the frame.
        const r = o.rect();
        const box = crop(r, camera, meshes, o.dice);
        still = copy(s, box);
        if (still) {
          // FR-DICEX-46 a: each die drawn alone and copied at its box, so a neighbour resting
          // close never shows in its cell.
          const dice: Record<string, Still> = {};
          const turns: Record<string, number> = {};
          meshes.forEach((m, i) => {
            const d = o.dice[i] as Die3D;
            const q: Quat = [m.quaternion.x, m.quaternion.y, m.quaternion.z, m.quaternion.w];
            // A world turn θ about +Y shows on screen (x right, z down) as −θ.
            turns[d.key] = -uprightTurn(geometryOf(d.shape), q);
            for (const [j, other] of meshes.entries()) other.visible = j === i;
            draw(s);
            const alone = copy(s, crop(r, camera, [m], [d]));
            if (alone) dice[d.key] = alone;
          });
          for (const m of meshes) m.visible = true;
          still.dice = dice;
          still.turns = turns;
        }
      }
      release();
      if (!s.lost) draw(s);
      return still;
    },
    stop() {
      release();
      if (!s.lost) draw(s);
    },
  };
}

/**
 * A still arena on the page's one canvas (FR-DICEX-27: the look editor's preview die), drawn on
 * demand, never looping: `redraw` after its rect moved or its scene changed.
 */
export function addStillArena(
  layer: HTMLElement,
  a: { scene: Scene; camera: OrthographicCamera; arena: Arena; rect(): Rect },
): { redraw(): void; remove(): void } {
  const s = stageIn(layer);
  const play: Play = {
    scene: a.scene,
    camera: a.camera,
    rect: a.rect,
    arena: a.arena,
    fitted: { w: 0, h: 0 },
    moving: () => false,
    tick: () => false,
    lost: () => {},
  };
  s.plays.add(play);
  const redraw = () => {
    if (stage === s && !s.lost && !s.looping) draw(s);
  };
  redraw();
  return {
    redraw,
    remove() {
      s.plays.delete(play);
      redraw();
    },
  };
}

/** The rested dice's bounding box (viewport CSS px), inside the arena rect. */
function crop(r: Rect, camera: OrthographicCamera, meshes: Mesh[], dice: readonly Die3D[]): Rect {
  const perUnit = r.w / Math.max(1e-6, camera.right - camera.left);
  let x0 = Number.POSITIVE_INFINITY;
  let y0 = Number.POSITIVE_INFINITY;
  let x1 = Number.NEGATIVE_INFINITY;
  let y1 = Number.NEGATIVE_INFINITY;
  meshes.forEach((m, i) => {
    const c = project(m, camera, r);
    const half = geometryOf((dice[i] as Die3D).shape).radius * perUnit * 1.25;
    x0 = Math.min(x0, r.x + c.x - half);
    y0 = Math.min(y0, r.y + c.y - half);
    x1 = Math.max(x1, r.x + c.x + half);
    y1 = Math.max(y1, r.y + c.y + half);
  });
  if (!Number.isFinite(x0)) return { ...r, w: 0, h: 0 };
  const x = Math.max(r.x, Math.floor(x0));
  const y = Math.max(r.y, Math.floor(y0));
  return {
    x,
    y,
    w: Math.min(r.x + r.w, Math.ceil(x1)) - x,
    h: Math.min(r.y + r.h, Math.ceil(y1)) - y,
  };
}

/** `box` of the shared canvas into a new 2D canvas placed at `box`. */
function copy(s: Stage, box: Rect): Still | null {
  if (box.w < 1 || box.h < 1) return null;
  const src = s.renderer.domElement;
  const ratio = src.width / Math.max(1, s.size.w);
  const canvas = src.ownerDocument.createElement("canvas");
  canvas.width = Math.max(1, Math.round(box.w * ratio));
  canvas.height = Math.max(1, Math.round(box.h * ratio));
  canvas.style.cssText = `position:absolute;display:block;left:${box.x}px;top:${box.y}px;width:${box.w}px;height:${box.h}px`;
  canvas
    .getContext("2d")
    ?.drawImage(
      src,
      Math.round(box.x * ratio),
      Math.round(box.y * ratio),
      canvas.width,
      canvas.height,
      0,
      0,
      canvas.width,
      canvas.height,
    );
  return { canvas, rect: box };
}
