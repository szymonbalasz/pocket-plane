// The look editor's live preview die (FR-DICEX-27), in the lazy chunk: one d20 at rest with its
// 20 up, in the draft look, drawn as a still arena of the page's one canvas on the dice layer
// (FR-DICEX-41: one WebGL context per page) at its placeholder's rect. Drawn on demand, no render
// loop; a throw arriving while the editor is open plays beside it in the same loop.
import type { DiceLook } from "@shared/dice-extras/looks";
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
  labelKindOf,
  multiply,
  type Quat,
  rotationBetween,
  type Vec3,
} from "./geometry";
import { addStillArena, materialOf, type Rect } from "./renderer";

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
