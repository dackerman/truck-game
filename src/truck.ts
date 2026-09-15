import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import definition from '../assets/vehicles/brown-beast/rig.json';
import { HARDPOINT_Y, WHEEL_MOUNTS, type Setup, type Snapshot } from './protocol';

export class TruckVisual {
  root!: THREE.Group;
  private axles: THREE.Object3D[] = [];
  private wheels: { steer: THREE.Object3D; spin: THREE.Object3D; tire: THREE.Object3D }[] = [];
  private links: { object: THREE.Object3D; upper: THREE.Object3D; lower: THREE.Object3D; rotation: THREE.Quaternion; direction: THREE.Vector3; length: number }[] = [];
  async load(scene: THREE.Scene) {
    const gltf = await new GLTFLoader().loadAsync(new URL('../assets/vehicles/brown-beast/brown-beast-rigged.glb', import.meta.url).href);
    this.root = gltf.scene;
    this.root.traverse(o => { if (o instanceof THREE.Mesh) { o.castShadow = true; o.receiveShadow = true; const mat = o.material as THREE.MeshStandardMaterial; mat.envMapIntensity = 0.8; } });
    const get = (name: string) => { const object = this.root.getObjectByName(name); if (!object) throw new Error(`Truck rig is missing ${name}`); return object; };
    this.axles = [get('Axle_Front'), get('Axle_Rear')];
    this.wheels = WHEEL_MOUNTS.map(w => ({ steer: get(`Wheel_${w.id}_Steer`), spin: get(`Wheel_${w.id}_Spin`), tire: get(`Wheel_${w.id}_Tire`) }));
    for (const link of definition.suspensionLinks) {
      const object = get(link.node), rotation = object.quaternion.clone();
      this.links.push({ object, upper: get(link.upperMountNode), lower: get(link.lowerMountNode), rotation, direction: new THREE.Vector3(0, 1, 0).applyQuaternion(rotation), length: link.restLength });
    }
    scene.add(this.root);
    // The exported preview clip is deliberately not played: live physics drives the rig.
  }
  update(previous: Snapshot, current: Snapshot, alpha: number, setup: Setup) {
    if (!this.root) return;
    this.root.position.set(previous.position.x, previous.position.y, previous.position.z).lerp(new THREE.Vector3(current.position.x, current.position.y, current.position.z), alpha);
    this.root.quaternion.set(previous.rotation.x, previous.rotation.y, previous.rotation.z, previous.rotation.w).slerp(new THREE.Quaternion(current.rotation.x, current.rotation.y, current.rotation.z, current.rotation.w), alpha);
    const ys = current.wheels.map((wheel, i) => HARDPOINT_Y - THREE.MathUtils.lerp(previous.wheels[i].length, wheel.length, alpha));
    this.axles.forEach((axle, i) => {
      const left = ys[i * 2], right = ys[i * 2 + 1];
      axle.position.y = (left + right) / 2;
      axle.quaternion.setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.atan2(right - left, 1.8714));
    });
    this.wheels.forEach((object, i) => {
      object.steer.rotation.y = THREE.MathUtils.lerp(previous.wheels[i].steer, current.wheels[i].steer, alpha);
      object.spin.rotation.x = THREE.MathUtils.lerp(previous.wheels[i].spin, current.wheels[i].spin, alpha);
      const radius = (0.54 - 0.026 * (24 / setup.pressure - 1)) / 0.54;
      object.tire.scale.set(1 + 0.055 * (24 / setup.pressure - 1), radius, radius);
    });
    this.root.updateMatrixWorld(true);
    for (const link of this.links) {
      const parent = link.object.parent!;
      const a = parent.worldToLocal(link.upper.getWorldPosition(new THREE.Vector3()));
      const b = parent.worldToLocal(link.lower.getWorldPosition(new THREE.Vector3()));
      const delta = b.sub(a), length = delta.length();
      link.object.position.copy(a);
      link.object.quaternion.setFromUnitVectors(link.direction, delta.normalize()).multiply(link.rotation);
      link.object.scale.set(1, length / link.length, 1);
    }
  }
}
