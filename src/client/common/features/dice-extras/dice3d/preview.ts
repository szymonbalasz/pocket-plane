// The look editor's live preview die (FR-DICEX-27), in the lazy chunk: one d20 at rest with its
// 20 up, in the draft look, drawn as a still arena of the page's one canvas on the dice layer
// (FR-DICEX-41: one WebGL context per page) at its placeholder's rect. Drawn on demand, no render
// loop; a throw arriving while the editor is open plays beside it in the same loop. Also the
// tray's stills (FR-DICEX-48): the staged dice copied into the tray's own 2D canvas.
import type { DiceLook } from "@shared/dice-extras/looks";
import type { DieShape } from "@shared/dice-extras/throw";
import {
  BufferGeometry,
  CanvasTexture,
  DirectionalLight,
  Float32BufferAttribute,
  HemisphereLight,
  type Material,
  Mesh,
  OrthographicCamera,
  Scene,
  SRGBColorSpace,
} from "three";
import { dieMesh, drawAtlas } from "./faces";
import {
  defaultLabels,
  geometryOf,
  type LabelKind,
  labelKindOf,
  multiply,
  type Quat,
  rotationBetween,
  type Vec3,
} from "./geometry";
import {
  addStillArena,
  cancelStillOf,
  drawStill,
  materialOf,
  type Rect,
  type StillScene,
  stillMaterial,
} from "./renderer";
import { stillPose } from "./stills";

export interface PreviewHandle {
  /** Redraw in another look. */
  update(look: DiceLook): void;
  /** Draw again at the placeholder's rect (it moved: the popover opened or scrolled). */
  redraw(): void;
  stop(): void;
}

/** `layer` = the dice layer element; `rect()` = the placeholder's rect. Throws without WebGL. */
export function previewDie(layer: HTMLElement, rect: () => Rect, look: DiceLook): PreviewHandle {
  const scene = new Scene();
  scene.add(new HemisphereLight(0xffffff, 0x8a8a96, 1.6));
  const sun = new DirectionalLight(0xffffff, 2.2);
  sun.position.set(-4, 14, 6);
  scene.add(sun);

  const g = geometryOf("d20");
  const kind = labelKindOf("d20");
  const labels = defaultLabels(g, kind);
  const { positions, normals, uvs } = dieMesh(g, labels, kind);
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new Float32BufferAttribute(normals, 3));
  geometry.setAttribute("uv", new Float32BufferAttribute(uvs, 2));
  const mesh = new Mesh(geometry);
  // The 20 face up, turned a little about +Y so the die reads as a solid.
  const top = labels.indexOf(20);
  const up = rotationBetween(g.normals[top] as Vec3, [0, 1, 0]);
  const turn: Quat = [0, Math.sin(0.35), 0, Math.cos(0.35)];
  const q = multiply(turn, up);
  mesh.quaternion.set(q[0], q[1], q[2], q[3]);
  scene.add(mesh);

  const r = g.radius * 1.15;
  const camera = new OrthographicCamera(-r, r, r, -r, 0.1, 100);
  camera.position.set(0, 10, 4);
  camera.lookAt(0, 0, 0);

  let texture: CanvasTexture | null = null;
  let material: Material | null = null;
  const paint = (l: DiceLook) => {
    texture?.dispose();
    material?.dispose();
    texture = new CanvasTexture(drawAtlas(kind, "d20", l));
    texture.colorSpace = SRGBColorSpace;
    material = materialOf(l, texture);
    mesh.material = material;
  };
  paint(look);
  const arena = addStillArena(layer, { scene, camera, arena: { x: r, z: r }, rect });

  return {
    update(l) {
      paint(l);
      arena.redraw();
    },
    redraw: arena.redraw,
    stop() {
      arena.remove();
      texture?.dispose();
      material?.dispose();
      geometry.dispose();
    },
  };
}

// --- FR-DICEX-48: the tray's stills ---------------------------------------------------------

/** One die cell of the tray's preview, in CSS px from its 2D canvas's top-left. */
export interface TrayStill {
  shape: DieShape;
  /** A d100's part (tens "00" / units "0"). */
  part?: "tens" | "units";
  x: number;
  y: number;
  size: number;
}

/** World units between two still dice (wider than any camera's view). */
const SPACING = 4;

const stillGeometry = new Map<LabelKind, { geometry: BufferGeometry; labels: number[]; q: Quat }>();

function stillDie(shape: DieShape, kind: LabelKind) {
  let hit = stillGeometry.get(kind);
  if (!hit) {
    const { labels, q } = stillPose(shape, kind);
    const { positions, normals, uvs } = dieMesh(geometryOf(shape), labels, kind);
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
    geometry.setAttribute("normal", new Float32BufferAttribute(normals, 3));
    geometry.setAttribute("uv", new Float32BufferAttribute(uvs, 2));
    hit = { geometry, labels, q };
    stillGeometry.set(kind, hit);
  }
  return hit;
}

let stillScene: Scene | null = null;

function sceneOfStills(cells: readonly TrayStill[], look: DiceLook): StillScene {
  if (!stillScene) {
    stillScene = new Scene();
    stillScene.add(new HemisphereLight(0xffffff, 0x8a8a96, 1.6));
    const sun = new DirectionalLight(0xffffff, 2.2);
    sun.position.set(-4, 14, 6);
    stillScene.add(sun);
  }
  const scene = stillScene;
  const meshes = cells.map((c, i) => {
    const kind = labelKindOf(c.shape, c.part);
    const die = stillDie(c.shape, kind);
    const mesh = new Mesh(die.geometry, stillMaterial(c.shape, kind, die.labels, look));
    mesh.quaternion.set(die.q[0], die.q[1], die.q[2], die.q[3]);
    mesh.position.set(i * SPACING, 0, 0);
    scene.add(mesh);
    const r = geometryOf(c.shape).radius * 1.15;
    const camera = new OrthographicCamera(-r, r, r, -r, 0.1, 100);
    camera.position.set(i * SPACING, 10, 4);
    camera.lookAt(i * SPACING, 0, 0);
    const rect: Rect = { x: Math.round(c.x), y: Math.round(c.y), w: c.size, h: c.size };
    return { mesh, cell: { camera, rect } };
  });
  return {
    scene,
    cells: meshes.map((m) => m.cell),
    remove() {
      for (const m of meshes) scene.remove(m.mesh);
    },
  };
}

/**
 * FR-DICEX-48: draw `cells` (highest face up, in `look`) into the tray's own 2D canvas `target`,
 * through a temporary arena of the page's one WebGL canvas in `layer` (`drawStill`). Throws
 * without WebGL.
 */
export function drawTrayStills(
  layer: HTMLElement,
  target: HTMLCanvasElement,
  cells: readonly TrayStill[],
  look: DiceLook,
): void {
  drawStill(layer, target, {
    build(ratio) {
      const w = Math.max(1, target.clientWidth);
      const h = Math.max(1, target.clientHeight);
      const bw = Math.round(w * ratio);
      const bh = Math.round(h * ratio);
      if (target.width !== bw || target.height !== bh) {
        target.width = bw;
        target.height = bh;
      } else target.getContext("2d")?.clearRect(0, 0, bw, bh);
      return cells.length === 0 ? null : { box: { w, h }, still: sceneOfStills(cells, look) };
    },
    copy(src, ratio, box) {
      const w = Math.round(box.w * ratio);
      const h = Math.round(box.h * ratio);
      target.getContext("2d")?.drawImage(src, 0, 0, w, h, 0, 0, w, h);
    },
  });
}

/** The tray unmounted: drop its waiting still. */
export const cancelTrayStills = (target: HTMLCanvasElement) => cancelStillOf(target);
