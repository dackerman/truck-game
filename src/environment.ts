import * as THREE from 'three';
import { clamp, gridHeight, noise, random, riverWidth, riverX, surfaceAt, terrainHeight, waterHeight, type WorldData, type Surface } from './world';

export const PALETTE: Record<Surface, string> = { dirt: '#b69b6d', grass: '#688344', rock: '#858374', mud: '#65503a', water: '#797c62', snow: '#dfe5df' };
const dummy = new THREE.Object3D();
function material(color: THREE.ColorRepresentation, roughness = 0.92) { return new THREE.MeshStandardMaterial({ color, roughness, flatShading: true }); }
function mesh(scene: THREE.Object3D, geometry: THREE.BufferGeometry, mat: THREE.Material, position: number[], rotation?: number[]) {
  const object = new THREE.Mesh(geometry, mat); object.position.set(position[0], position[1], position[2]);
  if (rotation) object.rotation.set(rotation[0], rotation[1], rotation[2]);
  object.castShadow = object.receiveShadow = true; scene.add(object); return object;
}
function groundTexture() {
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 256;
  const ctx = canvas.getContext('2d')!, rng = random(1952), image = ctx.createImageData(256, 256);
  for (let i = 0; i < image.data.length; i += 4) { const shade = 205 + rng() * 50; image.data.set([shade, shade, shade, 255], i); }
  ctx.putImageData(image, 0, 0);
  for (let i = 0; i < 180; i++) { ctx.fillStyle = `rgba(75,66,47,${rng() * 0.15})`; ctx.fillRect(rng() * 256, rng() * 256, 1 + rng() * 3, 1 + rng() * 2); }
  const texture = new THREE.CanvasTexture(canvas); texture.wrapS = texture.wrapT = THREE.RepeatWrapping; texture.repeat.set(85, 85); texture.colorSpace = THREE.SRGBColorSpace; return texture;
}

export class Environment {
  water: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
  rockGeometry = new THREE.IcosahedronGeometry(1, 0);
  terrain: THREE.Mesh;
  constructor(public scene: THREE.Scene, public data: WorldData) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(data.vertices, 3)); geometry.setIndex(new THREE.BufferAttribute(data.indices, 1));
    const colors = new Float32Array(data.vertices.length), uv = new Float32Array(data.vertices.length / 3 * 2), color = new THREE.Color();
    for (let i = 0; i < data.vertices.length; i += 3) {
      const [x, y, z] = data.vertices.subarray(i, i + 3);
      color.set(PALETTE[surfaceAt(x, z, y)]).multiplyScalar(0.9 + noise(x * 0.32, z * 0.32) * 0.2);
      colors.set([color.r, color.g, color.b], i); uv.set([(x + 96) / 192, (z + 96) / 192], i / 3 * 2);
    }
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3)); geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); geometry.computeVertexNormals();
    const groundMat = new THREE.MeshStandardMaterial({ vertexColors: true, map: groundTexture(), roughness: 1, flatShading: true });
    this.terrain = mesh(scene, geometry, groundMat, [0, 0, 0]); this.terrain.castShadow = false;
    this.addRocks(); this.addTrees(); this.addBrush(); this.addCamp();
    this.water = this.addWater();
    mesh(scene, new THREE.CircleGeometry(800, 64), new THREE.MeshStandardMaterial({ color: '#547f87', roughness: 0.48, metalness: 0.1 }), [0, -0.4, 0], [-Math.PI / 2, 0, 0]);
    this.addMudPuddles(); this.addSigns();
  }
  ground(x: number, z: number) { return gridHeight(this.data.heights, x, z); }
  private addRocks() {
    const rocks = new THREE.InstancedMesh(this.rockGeometry, material('#ffffff'), this.data.rocks.length);
    const color = new THREE.Color();
    this.data.rocks.forEach((r, i) => {
      dummy.position.set(r.x, r.y, r.z); dummy.rotation.set(0, r.yaw, 0); dummy.scale.set(r.rx, r.ry, r.rz); dummy.updateMatrix(); rocks.setMatrixAt(i, dummy.matrix);
      color.set(r.y > 22 ? '#b2b5a9' : '#939487').multiplyScalar(0.8 + r.shade * 0.35); rocks.setColorAt(i, color);
    });
    rocks.castShadow = rocks.receiveShadow = true; this.scene.add(rocks);
  }
  private addTrees() {
    const trees = this.data.trees, trunk = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.12, 0.25, 1, 6), material('#5b4a31'), trees.length);
    const foliage = [0, 1, 2].map(() => new THREE.InstancedMesh(new THREE.ConeGeometry(1, 1, 7, 1), material('#ffffff'), trees.length));
    const color = new THREE.Color();
    trees.forEach((tree, i) => {
      dummy.position.set(tree.x, tree.y + tree.height * 0.26, tree.z); dummy.rotation.set(0, tree.shade * 7, 0); dummy.scale.set(1, tree.height * 0.52, 1); dummy.updateMatrix(); trunk.setMatrixAt(i, dummy.matrix);
      foliage.forEach((layer, k) => {
        dummy.position.set(tree.x, tree.y + tree.height * (0.43 + k * 0.20), tree.z);
        dummy.scale.set(tree.width * (1.18 - k * 0.24), tree.height * (0.55 - k * 0.09), tree.width * (1.18 - k * 0.24)); dummy.updateMatrix(); layer.setMatrixAt(i, dummy.matrix);
        color.set(k === 2 && tree.y > 21 ? '#bac7b3' : ['#39552b', '#446732', '#577940'][k]).multiplyScalar(0.8 + tree.shade * 0.4); layer.setColorAt(i, color);
      });
    });
    [trunk, ...foliage].forEach(o => { o.castShadow = o.receiveShadow = true; this.scene.add(o); });
  }
  private addBrush() {
    const rng = random(1963), instances: number[][] = [];
    for (let i = 0; i < 2100; i++) {
      const x = (rng() - 0.5) * 172, z = (rng() - 0.5) * 178, y = this.ground(x, z);
      if (surfaceAt(x, z, y) !== 'grass' || y < 1) continue;
      instances.push([x, y, z, rng()]);
    }
    const brush = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 0), material('#ffffff'), instances.length), color = new THREE.Color();
    instances.forEach(([x, y, z, s], i) => { dummy.position.set(x, y + 0.18, z); dummy.rotation.set(0, s * 10, 0); dummy.scale.set(0.2 + s * 0.4, 0.2 + s * 0.3, 0.3 + s * 0.2); dummy.updateMatrix(); brush.setMatrixAt(i, dummy.matrix); color.set(s > 0.8 ? '#a6a358' : '#648346'); brush.setColorAt(i, color); });
    brush.receiveShadow = true; this.scene.add(brush);
  }
  private addWater() {
    const positions: number[] = [], uvs: number[] = [], indices: number[] = [];
    for (let i = 0; i <= 240; i++) {
      const z = -90 + i / 240 * 186, x = riverX(z), w = riverWidth(z), y = waterHeight(z);
      positions.push(x - w, y, z, x + w, y, z); uvs.push(0, i / 240, 1, i / 240);
      if (i < 240) { const k = i * 2; indices.push(k, k + 2, k + 1, k + 1, k + 2, k + 3); }
    }
    const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3)); geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2)); geometry.setIndex(indices); geometry.computeVertexNormals();
    const mat = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide, uniforms: { time: { value: 0 } },
      vertexShader: `varying vec3 world; varying vec2 vUv; uniform float time; void main(){vUv=uv;vec3 p=position;p.y+=0.025*sin(p.z*1.4+time*1.8)*sin(p.x*2.1+time);world=(modelMatrix*vec4(p,1.)).xyz;gl_Position=projectionMatrix*viewMatrix*vec4(world,1.);}`,
      fragmentShader: `varying vec3 world;varying vec2 vUv;uniform float time;void main(){float w=sin(world.z*1.9-time*3.2+sin(world.x*2.8));float spark=pow(max(0.,w),16.);float edge=smoothstep(.72,1.,abs(vUv.x*2.-1.));vec3 c=mix(vec3(.14,.36,.39),vec3(.48,.69,.64),.5+.18*w);c=mix(c,vec3(.83,.90,.83),spark*.48+edge*.17);gl_FragColor=vec4(c,.85);#include <tonemapping_fragment>\n#include <colorspace_fragment>\n}`.replace(';#include', ';\n#include'),
    });
    const water = new THREE.Mesh(geometry, mat); water.renderOrder = 1; this.scene.add(water); return water;
  }
  private addMudPuddles() {
    const rng = random(611), mat = new THREE.MeshStandardMaterial({ color: '#7c897d', roughness: 0.22, metalness: 0.25, transparent: true, opacity: 0.73, polygonOffset: true, polygonOffsetFactor: -1 });
    for (const [cx, cz] of [[-27, 22], [40, 18]]) for (let i = 0; i < 12; i++) {
      const x = cx + (rng() - 0.5) * 9, z = cz + (rng() - 0.5) * 10;
      const geometry = new THREE.CircleGeometry(1, 12); geometry.rotateX(-Math.PI / 2);
      const attr = geometry.getAttribute('position');
      for (let j = 0; j < attr.count; j++) { const px = x + attr.getX(j) * (0.3 + rng() * 0.6), pz = z + attr.getZ(j) * 1.7; attr.setXYZ(j, px, this.ground(px, pz) + 0.024, pz); }
      geometry.computeVertexNormals(); const puddle = new THREE.Mesh(geometry, mat); this.scene.add(puddle);
    }
  }
  private addCamp() {
    const camp = new THREE.Group(); camp.position.set(-9, 3.8, 56); this.scene.add(camp);
    const wood = material('#755435'), trim = material('#463e2b'), roof = material('#485e49'), glass = new THREE.MeshStandardMaterial({ color: '#6e8e8d', roughness: 0.2, metalness: 0.4 });
    mesh(camp, new THREE.BoxGeometry(6.4, 3.3, 5), wood, [0, 1.65, 0]);
    for (let k = 0; k < 11; k++) mesh(camp, new THREE.BoxGeometry(6.43, 0.035, 5.03), trim, [0, 0.22 + k * 0.28, 0]);
    for (const sign of [-1, 1]) mesh(camp, new THREE.BoxGeometry(7.15, 0.15, 3.25), roof, [0, 3.60, sign * 1.45], [sign * 0.32, 0, 0]);
    mesh(camp, new THREE.BoxGeometry(1.05, 2.25, 0.09), trim, [0.65, 1.13, 2.55]);
    mesh(camp, new THREE.BoxGeometry(1.3, 1.15, 0.11), trim, [-1.7, 1.9, 2.55]);
    mesh(camp, new THREE.BoxGeometry(1.12, 0.98, 0.12), glass, [-1.7, 1.9, 2.57]);
    mesh(camp, new THREE.BoxGeometry(0.06, 1.1, 0.14), wood, [-1.7, 1.9, 2.59]);
    mesh(camp, new THREE.BoxGeometry(7.1, 0.2, 1.3), wood, [0, 0.12, 3.0]);
    mesh(camp, new THREE.BoxGeometry(0.5, 1.3, 0.55), material('#73756b'), [2.0, 4.0, -0.8]);
    const log = new THREE.CylinderGeometry(0.3, 0.35, 4, 9);
    mesh(this.scene, log, wood, [6.5, 4.25, 60], [0, 0, Math.PI / 2]);
    for (let i = 0; i < 9; i++) { const a = i / 9 * Math.PI * 2; const stone = mesh(this.scene, this.rockGeometry, material('#89877b'), [5 + Math.cos(a), 3.96, 49 + Math.sin(a)]); stone.scale.set(0.3, 0.22, 0.28); }
    mesh(this.scene, new THREE.CircleGeometry(0.75, 12), material('#393a31'), [5, 3.82, 49], [-Math.PI / 2, 0, 0]);
    for (let i = 0; i < 10; i++) {
      const x = -17 + i * 2.9, z = 67, h = this.ground(x, z);
      mesh(this.scene, new THREE.BoxGeometry(0.16, 1.35, 0.16), wood, [x, h + 0.65, z]);
      if (i < 9) for (const y of [0.48, 1.02]) mesh(this.scene, new THREE.BoxGeometry(2.9, 0.12, 0.12), wood, [x + 1.45, this.ground(x + 1.45, z) + y, z]);
    }
  }
  private addSigns() {
    for (const [x, z, text] of [[4.5, 43, 'SUMMIT LOOP'], [-34, 17, 'ROCK GARDEN'], [10, -3, 'CREEK CROSSING']] as const) {
      const h = this.ground(x, z), wood = material('#53472e');
      mesh(this.scene, new THREE.BoxGeometry(0.13, 2, 0.13), wood, [x, h + 1, z]);
      const canvas = document.createElement('canvas'); canvas.width = 512; canvas.height = 100;
      const ctx = canvas.getContext('2d')!; ctx.fillStyle = '#4c5034'; ctx.fillRect(0, 0, 512, 100); ctx.strokeStyle = '#c5bb8f'; ctx.lineWidth = 5; ctx.strokeRect(7, 7, 498, 86); ctx.fillStyle = '#f0e7c4'; ctx.font = '600 30px sans-serif'; ctx.textAlign = 'center'; ctx.fillText(text, 256, 61);
      const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
      mesh(this.scene, new THREE.BoxGeometry(2.7, 0.58, 0.1), wood, [x, h + 1.7, z]);
      mesh(this.scene, new THREE.PlaneGeometry(2.66, 0.54), new THREE.MeshStandardMaterial({ map: texture, roughness: 1, side: THREE.DoubleSide }), [x, h + 1.7, z + 0.055]);
    }
  }
  update(time: number) { this.water.material.uniforms.time.value = time; }
}

/** Cosmetic tire marks; soft-ground collision deformation is intentionally deferred. */
export class TireTracks {
  private object: THREE.InstancedMesh;
  private cursor = 0;
  private last = [new THREE.Vector3(999, 999, 999), new THREE.Vector3(999, 999, 999)];
  constructor(scene: THREE.Scene) {
    const geometry = new THREE.PlaneGeometry(0.32, 0.6); geometry.rotateX(-Math.PI / 2);
    this.object = new THREE.InstancedMesh(geometry, new THREE.MeshBasicMaterial({ color: '#3c3525', transparent: true, opacity: 0.24, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }), 1800);
    this.object.instanceMatrix.setUsage(THREE.DynamicDrawUsage); this.object.frustumCulled = false;
    dummy.scale.setScalar(0); dummy.updateMatrix(); for (let i = 0; i < 1800; i++) this.object.setMatrixAt(i, dummy.matrix);
    scene.add(this.object);
  }
  add(wheel: number, point: { x: number; y: number; z: number }, yaw: number, surface: Surface, height: (x: number, z: number) => number) {
    if (!['dirt', 'mud', 'grass', 'snow'].includes(surface)) return;
    const p = new THREE.Vector3(point.x, point.y, point.z);
    if (p.distanceTo(this.last[wheel]) < 0.5) return;
    this.last[wheel].copy(p);
    const dx = height(p.x + 0.2, p.z) - height(p.x - 0.2, p.z), dz = height(p.x, p.z + 0.2) - height(p.x, p.z - 0.2);
    dummy.position.set(p.x, p.y + 0.025, p.z); dummy.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(-dx, 0.4, -dz).normalize()); dummy.rotateY(yaw); dummy.scale.setScalar(1); dummy.updateMatrix();
    this.object.setMatrixAt(this.cursor++ % 1800, dummy.matrix); this.object.instanceMatrix.needsUpdate = true;
  }
}
