// FR-DICEX-106: shader chunks shared by the kinds' auras (RichAura.frag). An aura's fragment
// shader is `${AURA_HEAD}` then `void main() { ${AURA_SHAPE} … gl_FragColor = …; }`.
// Uniforms: uTime (seconds), uAmp (0–1+: strength, 0 in flight when not whileRolling, flares at the
// landing), uHalf (half size, die radii), uSeed (per die). AURA_SHAPE gives q (die radii, screen x
// right, y down), d = length(q) and dn = q's direction.

export const AURA_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

/** Value noise: h3 (hash), n3 (smooth), fbm (3 octaves, 0–1). */
export const NOISE = /* glsl */ `
float h3(vec3 p) {
  p = fract(p * 0.3183099 + 0.1);
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}
float n3(vec3 x) {
  vec3 i = floor(x);
  vec3 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(h3(i), h3(i + vec3(1, 0, 0)), f.x), mix(h3(i + vec3(0, 1, 0)), h3(i + vec3(1, 1, 0)), f.x), f.y),
    mix(mix(h3(i + vec3(0, 0, 1)), h3(i + vec3(1, 0, 1)), f.x), mix(h3(i + vec3(0, 1, 1)), h3(i + vec3(1, 1, 1)), f.x), f.y),
    f.z);
}
float fbm(vec3 p) {
  float a = 0.5;
  float s = 0.0;
  for (int i = 0; i < 3; i++) {
    s += a * n3(p);
    p *= 2.03;
    a *= 0.5;
  }
  return s / 0.875;
}`;

export const AURA_HEAD = /* glsl */ `
uniform float uTime;
uniform float uAmp;
uniform float uHalf;
uniform float uSeed;
varying vec2 vUv;
${NOISE}
`;

export const AURA_SHAPE = /* glsl */ `
  vec2 q = (vUv * 2.0 - 1.0) * uHalf;
  q.y = -q.y;
  float d = length(q);
  vec2 dn = q / max(length(q), 1e-3);
`;
