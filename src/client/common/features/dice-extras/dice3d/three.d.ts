// Types for the part of `three` (0.186) the 3D dice renderer uses. `three` ships no types and
// the DM approved exactly `three` + `cannon-es` (#207 G1), so no `@types/three`: extend this
// shim when the renderer needs more.
declare module "three" {
  export const REVISION: string;
  export const SRGBColorSpace: string;
  export const PCFShadowMap: number;
  export const AdditiveBlending: number;
  export const NormalBlending: number;
  export const SubtractiveBlending: number;
  export const MultiplyBlending: number;
  export const FrontSide: number;
  export const BackSide: number;
  export const DoubleSide: number;
  export const DynamicDrawUsage: number;

  export class Vector3 {
    constructor(x?: number, y?: number, z?: number);
    x: number;
    y: number;
    z: number;
    set(x: number, y: number, z: number): this;
    setScalar(s: number): this;
    copy(v: Vector3): this;
    add(v: Vector3): this;
    sub(v: Vector3): this;
    multiplyScalar(s: number): this;
    normalize(): this;
    length(): number;
    distanceTo(v: Vector3): number;
    lerp(v: Vector3, alpha: number): this;
    clone(): Vector3;
    project(camera: Camera): this;
  }

  export class Vector2 {
    constructor(x?: number, y?: number);
    x: number;
    y: number;
    set(x: number, y: number): this;
  }

  export class Euler {
    x: number;
    y: number;
    z: number;
    set(x: number, y: number, z: number): this;
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
    rotation: Euler;
    scale: Vector3;
    children: Object3D[];
    parent: Object3D | null;
    name: string;
    userData: Record<string, unknown>;
    up: Vector3;
    renderOrder: number;
    frustumCulled: boolean;
    castShadow: boolean;
    receiveShadow: boolean;
    visible: boolean;
    add(...objects: Object3D[]): this;
    remove(...objects: Object3D[]): this;
    lookAt(x: number, y: number, z: number): void;
    clear(): this;
    traverse(callback: (object: Object3D) => void): void;
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

  export class Color {
    constructor(hex?: number | string);
    r: number;
    g: number;
    b: number;
    setHex(hex: number): this;
    clone(): Color;
    copy(color: Color): this;
    lerp(color: Color, alpha: number): this;
  }

  export class BufferAttribute {
    constructor(array: Float32Array, itemSize: number);
    array: Float32Array;
    itemSize: number;
    count: number;
    needsUpdate: boolean;
    setUsage(usage: number): this;
    setXYZ(index: number, x: number, y: number, z: number): this;
    setXY(index: number, x: number, y: number): this;
    setX(index: number, x: number): this;
  }
  export class Float32BufferAttribute extends BufferAttribute {
    constructor(array: ArrayLike<number>, itemSize: number);
  }

  export class BufferGeometry {
    setAttribute(name: string, attribute: BufferAttribute): this;
    getAttribute(name: string): BufferAttribute;
    setIndex(index: number[] | null): this;
    setFromPoints(points: Vector3[]): this;
    rotateX(angle: number): this;
    rotateY(angle: number): this;
    rotateZ(angle: number): this;
    translate(x: number, y: number, z: number): this;
    scale(x: number, y: number, z: number): this;
    setDrawRange(start: number, count: number): void;
    computeBoundingSphere(): void;
    dispose(): void;
  }
  export class PlaneGeometry extends BufferGeometry {
    constructor(width?: number, height?: number, widthSegments?: number, heightSegments?: number);
  }
  export class RingGeometry extends BufferGeometry {
    constructor(
      innerRadius?: number,
      outerRadius?: number,
      thetaSegments?: number,
      phiSegments?: number,
      thetaStart?: number,
      thetaLength?: number,
    );
  }
  export class CircleGeometry extends BufferGeometry {
    constructor(radius?: number, segments?: number, thetaStart?: number, thetaLength?: number);
  }
  export class SphereGeometry extends BufferGeometry {
    constructor(radius?: number, widthSegments?: number, heightSegments?: number);
  }
  export class TorusGeometry extends BufferGeometry {
    constructor(radius?: number, tube?: number, radialSegments?: number, tubularSegments?: number);
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
    depthTest?: boolean;
    blending?: number;
    side?: number;
  }
  export class Material {
    transparent: boolean;
    opacity: number;
    depthWrite: boolean;
    depthTest: boolean;
    blending: number;
    side: number;
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
    color: Color;
    emissive: Color;
    emissiveIntensity: number;
  }
  export interface PointsMaterialParameters extends MaterialParameters {
    map?: Texture | null;
    size?: number;
    sizeAttenuation?: boolean;
    vertexColors?: boolean;
  }
  export class PointsMaterial extends Material {
    constructor(parameters?: PointsMaterialParameters);
    size: number;
  }
  export interface MeshPhysicalMaterialParameters extends MeshStandardMaterialParameters {
    clearcoat?: number;
    clearcoatRoughness?: number;
  }
  export interface MeshBasicMaterialParameters extends MaterialParameters {
    map?: Texture | null;
    color?: number | string;
  }
  export class MeshBasicMaterial extends Material {
    constructor(parameters?: MeshBasicMaterialParameters);
    color: Color;
    map: Texture | null;
  }
  export interface LineBasicMaterialParameters extends MaterialParameters {
    color?: number | string;
    linewidth?: number;
    vertexColors?: boolean;
  }
  export class LineBasicMaterial extends Material {
    constructor(parameters?: LineBasicMaterialParameters);
    color: Color;
  }
  export interface SpriteMaterialParameters extends MaterialParameters {
    map?: Texture | null;
    color?: number | string;
    rotation?: number;
    sizeAttenuation?: boolean;
  }
  export class SpriteMaterial extends Material {
    constructor(parameters?: SpriteMaterialParameters);
    color: Color;
    map: Texture | null;
    rotation: number;
  }
  export interface ShaderMaterialParameters extends MaterialParameters {
    uniforms?: Record<string, { value: unknown }>;
    vertexShader?: string;
    fragmentShader?: string;
  }
  export class ShaderMaterial extends Material {
    constructor(parameters?: ShaderMaterialParameters);
    uniforms: Record<string, { value: unknown }>;
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

  export class Points extends Object3D {
    constructor(geometry?: BufferGeometry, material?: Material);
  }

  export class Line extends Object3D {
    constructor(geometry?: BufferGeometry, material?: Material);
    geometry: BufferGeometry;
    material: Material;
  }
  export class LineSegments extends Line {}
  export class LineLoop extends Line {}

  export class Sprite extends Object3D {
    constructor(material?: SpriteMaterial);
    material: SpriteMaterial;
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
