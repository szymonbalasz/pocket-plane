// The 3D throw renderer (FR-DICEX-14, -15, -20, -23; ADR-0044), in the lazy chunk only. Settles
// the throw headless first (settle.ts), then plays the recorded motion with three.js. One
// renderer per page, reused across throws; the render loop runs only while a throw moves.
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
  WebGLRenderer,
} from "three";
import { dieMesh, drawAtlas, drawD4 } from "./faces";
import { geometryOf, type LabelKind, labelKindOf, type Quat, upFace } from "./geometry";
import { ARENA, poseAt, STEP_HZ, settleLabels, simulate } from "./settle";

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
  /** Die centre per key in canvas CSS px (labels for MOD / offered dice). */
  at: Record<string, { x: number; y: number }>;
  /** Median frame time of the throw; null when too few frames to judge (FR-DICEX-23). */
  medianFrameMs: number | null;
}

export interface PlayOptions {
  host: HTMLElement;
  width: number;
  height: number;
  dice: readonly Die3D[];
  seed: number;
  onRest(info: RestInfo): void;
  /** The WebGL context was lost mid-throw: the caller draws flat (DICEX §11). */
  onLost(): void;
}

export interface PlayHandle {
  stop(): void;
}

/** FR-DICEX-21 materials, the default looks' and every look D2 stores. */
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

/** Dropped dice at rest (FR-DICEX-13: dimmed). */
const DROPPED_OPACITY = 0.38;
/** FR-DICEX-23 needs this many frames to judge. */
const MIN_FRAMES = 10;
const TEXTURE_CACHE = 24;

interface Stage {
  renderer: WebGLRenderer;
  scene: Scene;
  camera: OrthographicCamera;
  lost: boolean;
}

let stage: Stage | null = null;
let active: { onLost(): void } | null = null;
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

function createStage(): Stage {
  const renderer = new WebGLRenderer({
    antialias: true,
    alpha: true,
    powerPreference: "low-power",
  });
  renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio || 1, 2));
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = PCFShadowMap;
  const canvas = renderer.domElement;
  canvas.style.display = "block";
  const s: Stage = {
    renderer,
    scene: new Scene(),
    camera: new OrthographicCamera(-ARENA.x, ARENA.x, ARENA.z, -ARENA.z, 0.1, 100),
    lost: false,
  };
  canvas.addEventListener("webglcontextlost", (e) => {
    e.preventDefault();
    s.lost = true;
    active?.onLost();
  });
  s.scene.add(new HemisphereLight(0xffffff, 0x8a8a96, 1.6));
  const sun = new DirectionalLight(0xffffff, 2.2);
  sun.position.set(-4, 14, 6);
  sun.castShadow = true;
  sun.shadow.mapSize.width = 1024;
  sun.shadow.mapSize.height = 1024;
  sun.shadow.camera.left = -ARENA.x - 1;
  sun.shadow.camera.right = ARENA.x + 1;
  sun.shadow.camera.top = ARENA.z + 1;
  sun.shadow.camera.bottom = -ARENA.z - 1;
  sun.shadow.camera.updateProjectionMatrix();
  sun.shadow.bias = -0.002;
  s.scene.add(sun);
  const floor = new Mesh(
    new PlaneGeometry(ARENA.x * 2 + 2, ARENA.z * 2 + 2).rotateX(-Math.PI / 2),
    new ShadowMaterial({ opacity: 0.28 }),
  );
  floor.receiveShadow = true;
  s.scene.add(floor);
  // Slightly tilted top-down view: up-faces read straight on.
  s.camera.position.set(0, 30, 5);
  s.camera.lookAt(0, 0, 0);
  return s;
}

/** Fit the fixed arena into the canvas (letterboxed), so every viewport sees the same tumble. */
function fit(camera: OrthographicCamera, width: number, height: number) {
  let halfW = ARENA.x * 1.04;
  let halfH = ARENA.z * 1.08;
  const aspect = width / Math.max(1, height);
  if (aspect > halfW / halfH) halfW = halfH * aspect;
  else halfH = halfW / aspect;
  camera.left = -halfW;
  camera.right = halfW;
  camera.top = halfH;
  camera.bottom = -halfH;
  camera.updateProjectionMatrix();
}

function median(xs: number[]): number | null {
  if (xs.length < MIN_FRAMES) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? (s[m] as number) : ((s[m - 1] as number) + (s[m] as number)) / 2;
}

/**
 * FR-DICEX-15: simulate, relabel, play. Throws when WebGL can't start (the caller draws flat).
 */
export function playThrow(o: PlayOptions): PlayHandle {
  if (stage?.lost) stage.renderer.dispose();
  if (!stage || stage.lost) stage = createStage();
  const s = stage;
  const { renderer, scene, camera } = s;
  renderer.setSize(o.width, o.height);
  fit(camera, o.width, o.height);
  o.host.appendChild(renderer.domElement);

  const kinds = o.dice.map((d) => labelKindOf(d.shape, d.d100));
  const sim = simulate(
    o.dice.map((d, i) => ({ shape: d.shape, kind: kinds[i] as LabelKind })),
    o.seed,
  );
  const labels = settleLabels(
    sim,
    o.dice.map((d) => d.value),
  );
  const group = new Group();
  const own: { dispose(): void }[] = [];
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
    mesh.castShadow = true;
    group.add(mesh);
    return mesh;
  });
  scene.add(group);

  const pose = (f: number) => {
    meshes.forEach((m, i) => {
      const { p, q } = poseAt(sim, i, f);
      m.position.set(p[0], p[1], p[2]);
      m.quaternion.set(q[0], q[1], q[2], q[3]);
    });
  };

  let start: number | null = null;
  let prev: number | null = null;
  const deltas: number[] = [];
  let stopped = false;
  const last = sim.frameCount - 1;

  const rest = () => {
    renderer.setAnimationLoop(null);
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
    renderer.render(scene, camera);
    const settled: Record<string, number> = {};
    const at: Record<string, { x: number; y: number }> = {};
    o.dice.forEach((d, i) => {
      const m = meshes[i] as Mesh;
      const q: Quat = [m.quaternion.x, m.quaternion.y, m.quaternion.z, m.quaternion.w];
      settled[d.key] = upFace(geometryOf(d.shape), labels[i] as number[], q);
      const v = m.position.clone().project(camera);
      at[d.key] = { x: ((v.x + 1) / 2) * o.width, y: ((1 - v.y) / 2) * o.height };
    });
    o.onRest({ settled, at, medianFrameMs: median(deltas) });
  };

  const me = { onLost: () => !stopped && o.onLost() };
  active = me;
  pose(0);
  renderer.setAnimationLoop((time) => {
    if (stopped) return;
    if (start === null) start = time;
    if (prev !== null) deltas.push(time - prev);
    prev = time;
    const f = ((time - start) / 1000) * STEP_HZ;
    if (f >= last) {
      rest();
      return;
    }
    pose(f);
    renderer.render(scene, camera);
  });

  return {
    stop() {
      if (stopped) return;
      stopped = true;
      if (active === me) active = null;
      renderer.setAnimationLoop(null);
      scene.remove(group);
      for (const x of own) x.dispose();
      if (renderer.domElement.parentElement === o.host) o.host.removeChild(renderer.domElement);
    },
  };
}
