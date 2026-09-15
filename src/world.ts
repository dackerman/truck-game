export type Point = { x: number; y: number; z: number };
export type Surface = 'dirt' | 'grass' | 'rock' | 'mud' | 'water' | 'snow';
export const SIZE = 192;
export const SEGMENTS = 192;
export const SPAWN = { x: 0, z: 54, yaw: 0 };
export const clamp = (v: number, a = 0, b = 1) => Math.max(a, Math.min(b, v));
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const smooth = (a: number, b: number, v: number) => { const t = clamp((v - a) / (b - a)); return t * t * (3 - 2 * t); };

export function random(seed: number) {
  return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
function hash(x: number, z: number) { let n = Math.imul(x, 374761393) + Math.imul(z, 668265263); n = Math.imul(n ^ n >>> 13, 1274126177); return ((n ^ n >>> 16) >>> 0) / 4294967295; }
export function noise(x: number, z: number) {
  const ix = Math.floor(x), iz = Math.floor(z), u = smooth(0, 1, x - ix), v = smooth(0, 1, z - iz);
  return lerp(lerp(hash(ix, iz), hash(ix + 1, iz), u), lerp(hash(ix, iz + 1), hash(ix + 1, iz + 1), u), v);
}

const control: number[][] = [
  [0, 3.8, 62], [0, 3.8, 46], [-15, 4.9, 32], [-28, 6, 20], [-38, 7.7, 2],
  [-48, 11, -12], [-60, 16, -36], [-50, 21, -55], [-30, 23, -66], [-18, 17, -48],
  [-22, 12, -30], [-15, 8, -12], [0, 4.05, 0], [15, 9, -15], [30, 17, -32],
  [54, 24, -40], [66, 21, -24], [62, 16, -5], [45, 10, 8], [34, 6.8, 27], [22, 4.8, 40], [0, 3.8, 46],
];
function catmull(a: number, b: number, c: number, d: number, t: number) {
  return 0.5 * ((2 * b) + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t * t + (-a + 3 * b - 3 * c + d) * t * t * t);
}
export const TRAIL: Point[] = [];
for (let i = 0; i < control.length - 1; i++) {
  const a = control[Math.max(0, i - 1)], b = control[i], c = control[i + 1], d = control[Math.min(control.length - 1, i + 2)];
  for (let k = 0; k < 8; k++) TRAIL.push({ x: catmull(a[0], b[0], c[0], d[0], k / 8), y: catmull(a[1], b[1], c[1], d[1], k / 8), z: catmull(a[2], b[2], c[2], d[2], k / 8) });
}
TRAIL.push({ x: 0, y: 3.8, z: 46 });

export function trailAt(x: number, z: number) {
  let distance2 = Infinity, height = 0, along = 0;
  for (let i = 0; i < TRAIL.length - 1; i++) {
    const a = TRAIL[i], b = TRAIL[i + 1], dx = b.x - a.x, dz = b.z - a.z;
    const t = clamp(((x - a.x) * dx + (z - a.z) * dz) / Math.max(0.001, dx * dx + dz * dz));
    const d = (x - a.x - dx * t) ** 2 + (z - a.z - dz * t) ** 2;
    if (d < distance2) { distance2 = d; height = lerp(a.y, b.y, t); along = i + t; }
  }
  return { distance: Math.sqrt(distance2), height, along };
}
export function riverX(z: number) { return 3.2 * Math.sin(z * 0.06) - 1.2 - 26 * smooth(38, 92, z) + 8 * smooth(-30, -86, z); }
export function waterHeight(z: number) { return (2.1 + (88 - z) * 0.025 + 3.5 * smooth(-26, -44, z)) * (1 - smooth(78, 97, z)); }
export function riverWidth(z: number) { return 2.8 + 0.65 * Math.sin(z * 0.11) + 1.6 * smooth(40, 90, z); }
const gaussian = (x: number, z: number, cx: number, cz: number, sx: number, sz: number) => Math.exp(-(((x - cx) / sx) ** 2) - ((z - cz) / sz) ** 2);

export function terrainHeight(x: number, z: number): number {
  let h = 3.3 + 3.2 * smooth(45, -70, z)
    + 23 * gaussian(x, z, -48, -49, 31, 31) + 26 * gaussian(x, z, 53, -40, 29, 32)
    + 7 * gaussian(x, z, -65, 21, 24, 30) + 5 * gaussian(x, z, 61, 41, 28, 27);
  h += (noise(x * 0.055, z * 0.055) - 0.5) * 5 + (noise(x * 0.17, z * 0.17) - 0.5) * 1.1;
  const riverDistance = Math.abs(x - riverX(z));
  h = lerp(waterHeight(z) - 0.7, h, smooth(riverWidth(z) - 0.4, riverWidth(z) + 6.5, riverDistance));
  const trail = trailAt(x, z);
  const ripple = (noise(x * 0.7, z * 0.7) - 0.5) * 0.1 + Math.sin(trail.along * 1.5) * 0.03;
  h = lerp(trail.height + ripple, h, smooth(2.6, 6.7, trail.distance));
  const camp = Math.hypot(x, z - 54);
  h = lerp(3.8, h, smooth(12, 19, camp));
  const coast = Math.sqrt((x / 99) ** 2 + (z / 102) ** 2);
  h = lerp(h, -5, smooth(0.87, 1.015, coast));
  return h;
}

export function surfaceAt(x: number, z: number, y = terrainHeight(x, z)): Surface {
  if (Math.abs(x - riverX(z)) < riverWidth(z) && y < waterHeight(z) + 0.08) return 'water';
  if (((x + 27) / 8) ** 2 + ((z - 22) / 10) ** 2 < 1 || ((x - 40) / 10) ** 2 + ((z - 18) / 9) ** 2 < 1) return 'mud';
  if (y > 21 && z < -25) return 'snow';
  if (trailAt(x, z).distance < 3.5 || Math.hypot(x, z - 54) < 14) return 'dirt';
  if (y > 24 || noise(x * 0.12, z * 0.12) > 0.82) return 'rock';
  return 'grass';
}

export interface Rock { x: number; y: number; z: number; rx: number; ry: number; rz: number; yaw: number; shade: number; }
export interface Tree { x: number; y: number; z: number; height: number; width: number; shade: number; }
export interface WorldData { vertices: Float32Array; indices: Uint32Array; heights: Float32Array; rocks: Rock[]; trees: Tree[]; }

export function createWorld(): WorldData {
  const n = SEGMENTS + 1, heights = new Float32Array(n * n), vertices = new Float32Array(n * n * 3);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const x = i * SIZE / SEGMENTS - SIZE / 2, z = j * SIZE / SEGMENTS - SIZE / 2;
    const k = j * n + i, h = terrainHeight(x, z);
    heights[k] = h; vertices.set([x, h, z], k * 3);
  }
  const indices = new Uint32Array(SEGMENTS * SEGMENTS * 6);
  for (let j = 0; j < SEGMENTS; j++) for (let i = 0; i < SEGMENTS; i++) {
    const a = j * n + i, k = (j * SEGMENTS + i) * 6;
    indices.set([a, a + n, a + 1, a + 1, a + n, a + n + 1], k);
  }
  const rnd = random(92841), rocks: Rock[] = [], trees: Tree[] = [];
  for (let i = 0; i < 1400; i++) {
    const x = (rnd() - 0.5) * 177, z = (rnd() - 0.5) * 180, y = terrainHeight(x, z);
    const path = trailAt(x, z).distance, river = Math.abs(x - riverX(z));
    if (y < 0 || Math.hypot(x, z - 54) < 17 || path < 4.7 || river < riverWidth(z) + 0.8) continue;
    const s = 0.4 + rnd() ** 3 * 3.8;
    rocks.push({ x, y: y + s * 0.15, z, rx: s * (0.8 + rnd() * 0.4), ry: s * (0.75 + rnd() * 0.6), rz: s * (0.8 + rnd() * 0.5), yaw: rnd() * Math.PI * 2, shade: rnd() });
  }
  // Small real colliders across one trail make wheel travel easy to observe.
  for (let i = 0; i < 28; i++) {
    const a = TRAIL[28 + Math.floor(rnd() * 11)];
    const x = a.x + (rnd() - 0.5) * 4.5, z = a.z + (rnd() - 0.5) * 4.5;
    rocks.push({ x, y: terrainHeight(x, z) - 0.01, z, rx: 0.3 + rnd() * 0.32, ry: 0.14 + rnd() * 0.16, rz: 0.28 + rnd() * 0.35, yaw: rnd() * 6.28, shade: rnd() });
  }
  for (let i = 0; i < 1800 && trees.length < 470; i++) {
    const x = (rnd() - 0.5) * 175, z = (rnd() - 0.5) * 177, y = terrainHeight(x, z);
    if (y < 1 || y > 27 || trailAt(x, z).distance < 5.8 || Math.hypot(x, z - 54) < 17 || Math.abs(x - riverX(z)) < riverWidth(z) + 3.2) continue;
    if (trees.some(t => (t.x - x) ** 2 + (t.z - z) ** 2 < 9)) continue;
    const height = 4 + rnd() * 5.5;
    trees.push({ x, y, z, height, width: 1 + rnd() * 0.8, shade: rnd() });
  }
  return { vertices, indices, heights, rocks, trees };
}

/** Interpolate the same triangles used by both the renderer and Rapier. */
export function gridHeight(heights: Float32Array, x: number, z: number) {
  const gx = clamp((x + SIZE / 2) / SIZE * SEGMENTS, 0, SEGMENTS - 0.00001), gz = clamp((z + SIZE / 2) / SIZE * SEGMENTS, 0, SEGMENTS - 0.00001);
  const i = Math.floor(gx), j = Math.floor(gz), u = gx - i, v = gz - j, n = SEGMENTS + 1;
  const a = heights[j * n + i], b = heights[j * n + i + 1], c = heights[(j + 1) * n + i], d = heights[(j + 1) * n + i + 1];
  return u + v <= 1 ? a + (b - a) * u + (c - a) * v : d + (c - d) * (1 - u) + (b - d) * (1 - v);
}

export const LANDMARKS = [
  { name: 'Base camp', x: 0, z: 54, kind: 'camp' },
  { name: 'Mud hollow', x: -27, z: 22, kind: 'mud' },
  { name: 'Rock garden', x: -40, z: -1, kind: 'rock' },
  { name: 'West lookout', x: -31, z: -65, kind: 'summit' },
  { name: 'Creek crossing', x: 0, z: 0, kind: 'water' },
  { name: 'Pine summit', x: 54, z: -40, kind: 'summit' },
];
