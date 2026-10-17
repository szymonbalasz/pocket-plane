// Types for the part of `three` (0.186) the 3D dice renderer uses. `three` ships no types and
// the DM approved exactly `three` + `cannon-es` (#207 G1), so no `@types/three`: extend this
// shim when the renderer needs more.
declare module "three" {
  export const REVISION: string;
  export const SRGBColorSpace: string;
  export const PCFShadowMap: number;

  export class Vector3 {
    constructor(x?: number, y?: number, z?: number);
    x: number;
    y: number;
    z: number;
    set(x: number, y: number, z: number): this;
    clone(): Vector3;
    project(camera: Camera): this;
  }

  export class Quaternion {
    x: number;
    y: number;
    z: number;
    w: number;
    set(x: number, y: number, z: number, w: number): this;
  }

  export class Object3D {
    position: Vector3;
    quaternion: Quaternion;
    up: Vector3;
    castShadow: boolean;
    receiveShadow: boolean;
    visible: boolean;
    add(...objects: Object3D[]): this;
    remove(...objects: Object3D[]): this;
    lookAt(x: number, y: number, z: number): void;
  }

  export class Scene extends Object3D {}
  export class Group extends Object3D {}

  export class Camera extends Object3D {}
  export class OrthographicCamera extends Camera {
    constructor(
      left: number,
      right: number,
      top: number,
      bottom: number,
      near?: number,
      far?: number,
    );
    left: number;
    right: number;
    top: number;
    bottom: number;
    updateProjectionMatrix(): void;
  }

  export class BufferAttribute {}
  export class Float32BufferAttribute extends BufferAttribute {
    constructor(array: ArrayLike<number>, itemSize: number);
  }

  export class BufferGeometry {
    setAttribute(name: string, attribute: BufferAttribute): this;
    rotateX(angle: number): this;
    dispose(): void;
  }
  export class PlaneGeometry extends BufferGeometry {
    constructor(width?: number, height?: number);
  }

  export class Texture {
    colorSpace: string;
    anisotropy: number;
    needsUpdate: boolean;
    dispose(): void;
  }
  export class CanvasTexture extends Texture {
    constructor(canvas: HTMLCanvasElement | OffscreenCanvas);
  }

  export interface MaterialParameters {
    transparent?: boolean;
    opacity?: number;
    depthWrite?: boolean;
  }
  export class Material {
    transparent: boolean;
    opacity: number;
    depthWrite: boolean;
    needsUpdate: boolean;
    clone(): this;
    dispose(): void;
  }
  export interface MeshStandardMaterialParameters extends MaterialParameters {
    map?: Texture | null;
    color?: number | string;
    roughness?: number;
    metalness?: number;
  }
  export class MeshStandardMaterial extends Material {
    constructor(parameters?: MeshStandardMaterialParameters);
  }
  export interface MeshPhysicalMaterialParameters extends MeshStandardMaterialParameters {
    clearcoat?: number;
    clearcoatRoughness?: number;
  }
  export class MeshPhysicalMaterial extends MeshStandardMaterial {
    constructor(parameters?: MeshPhysicalMaterialParameters);
  }
  export class ShadowMaterial extends Material {
    constructor(parameters?: MaterialParameters);
  }

  export class Mesh extends Object3D {
    constructor(geometry?: BufferGeometry, material?: Material);
    geometry: BufferGeometry;
    material: Material;
  }

  export class Light extends Object3D {}
  export class HemisphereLight extends Light {
    constructor(skyColor?: number | string, groundColor?: number | string, intensity?: number);
  }
  export class DirectionalLight extends Light {
    constructor(color?: number | string, intensity?: number);
    shadow: {
      mapSize: { width: number; height: number };
      camera: OrthographicCamera;
      bias: number;
    };
    dispose(): void;
  }

  export interface WebGLRendererParameters {
    canvas?: HTMLCanvasElement;
    antialias?: boolean;
    alpha?: boolean;
    powerPreference?: "default" | "high-performance" | "low-power";
  }
  export class WebGLRenderer {
    constructor(parameters?: WebGLRendererParameters);
    domElement: HTMLCanvasElement;
    outputColorSpace: string;
    shadowMap: { enabled: boolean; type: number };
    autoClear: boolean;
    setPixelRatio(value: number): void;
    setSize(width: number, height: number, updateStyle?: boolean): void;
    setClearColor(color: number | string, alpha?: number): void;
    setAnimationLoop(callback: ((time: number) => void) | null): void;
    setViewport(x: number, y: number, width: number, height: number): void;
    setScissor(x: number, y: number, width: number, height: number): void;
    setScissorTest(enable: boolean): void;
    clear(color?: boolean, depth?: boolean, stencil?: boolean): void;
    render(scene: Object3D, camera: Camera): void;
    dispose(): void;
    forceContextLoss(): void;
  }
}
