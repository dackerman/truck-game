import RAPIER from '@dimforge/rapier3d-compat';
import { clamp, gridHeight, SPAWN, surfaceAt, waterHeight, type Surface } from './world';
import { DEFAULT_SETUP, HARDPOINT_Y, REST_LENGTH, WHEEL_MOUNTS, type InitMessage, type Input, type Setup, type Snapshot, type WheelState } from './protocol';

export const DT = 1 / 120;
const MASS = 2200;
const SURFACES: Record<Surface, { grip: number; rolling: number }> = {
  dirt: { grip: 1.55, rolling: 0.023 }, grass: { grip: 1.1, rolling: 0.045 },
  rock: { grip: 1.9, rolling: 0.024 }, mud: { grip: 0.67, rolling: 0.14 },
  water: { grip: 0.8, rolling: 0.085 }, snow: { grip: 0.72, rolling: 0.075 },
};
function rotate(v: { x: number; y: number; z: number }, q: { x: number; y: number; z: number; w: number }) {
  const tx = 2 * (q.y * v.z - q.z * v.y), ty = 2 * (q.z * v.x - q.x * v.z), tz = 2 * (q.x * v.y - q.y * v.x);
  return { x: v.x + q.w * tx + q.y * tz - q.z * ty, y: v.y + q.w * ty + q.z * tx - q.x * tz, z: v.z + q.w * tz + q.x * ty - q.y * tx };
}
export function validateSetup(value: Setup): Setup {
  const number = (v: number, fallback: number, lo: number, hi: number) => Number.isFinite(v) ? clamp(v, lo, hi) : fallback;
  return { drive: ['4WD', 'FWD', 'RWD'].includes(value.drive) ? value.drive : '4WD', lowRange: !!value.lowRange, locked: !!value.locked,
    pressure: number(value.pressure, 24, 12, 40), spring: number(value.spring, 42, 25, 85), damping: number(value.damping, 0.65, 0.25, 1.2), horsepower: number(value.horsepower, 280, 140, 600) };
}

/** First playable baseline: Rapier raycast suspension plus material/drivetrain tuning.
 * Wheel inertia, compliant contact patches and physical soil deformation are follow-ups.
 */
export class TruckSimulation {
  world: RAPIER.World;
  body: RAPIER.RigidBody;
  vehicle: RAPIER.DynamicRayCastVehicleController;
  setup: Setup = { ...DEFAULT_SETUP };
  input: Input = { throttle: 0, steer: 0, brake: 0 };
  tick = 0; resetCount = 0; distance = 0; rpm = 950; gear = 0; speed = 0;
  wheels: WheelState[] = [];
  private smoothThrottle = 0;
  private smoothSteer = 0;
  private wheelSpinSpeeds = [0, 0, 0, 0];
  private radius = 0.54;
  private solidRocks = new Set<number>();
  constructor(private init: InitMessage) {
    this.world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    this.world.timestep = DT;
    this.world.createCollider(RAPIER.ColliderDesc.trimesh(init.vertices, init.indices).setFriction(0.75));
    for (const rock of init.rocks) {
      const vertices = new Float32Array(init.rockVertices.length);
      for (let i = 0; i < vertices.length; i += 3) { vertices[i] = init.rockVertices[i] * rock.rx; vertices[i + 1] = init.rockVertices[i + 1] * rock.ry; vertices[i + 2] = init.rockVertices[i + 2] * rock.rz; }
      const desc = RAPIER.ColliderDesc.convexHull(vertices);
      if (desc) {
        const collider = this.world.createCollider(desc.setTranslation(rock.x, rock.y, rock.z).setRotation({ x: 0, y: Math.sin(rock.yaw / 2), z: 0, w: Math.cos(rock.yaw / 2) }).setFriction(0.85));
        this.solidRocks.add(collider.handle);
      }
    }
    for (const tree of init.trees) this.world.createCollider(RAPIER.ColliderDesc.cylinder(tree.height * 0.25, 0.2).setTranslation(tree.x, tree.y + tree.height * 0.25, tree.z).setFriction(0.8));
    // Camp cabin and log bench match the rendered dimensions.
    this.world.createCollider(RAPIER.ColliderDesc.cuboid(3.2, 1.65, 2.5).setTranslation(-9, 5.45, 56));
    this.world.createCollider(RAPIER.ColliderDesc.cuboid(2, 0.35, 0.4).setTranslation(6.5, 4.15, 60));
    this.body = this.world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setCanSleep(false).setCcdEnabled(true).setLinearDamping(0.035).setAngularDamping(0.45)
      .setAdditionalMassProperties(MASS, { x: 0, y: 0.92, z: 0.05 }, { x: 3500, y: 4200, z: 1600 }, { x: 0, y: 0, z: 0, w: 1 }));
    this.world.createCollider(RAPIER.ColliderDesc.cuboid(0.89, 0.29, 2.05).setTranslation(0, 1.0, 0).setDensity(0).setFriction(0.5), this.body);
    this.world.createCollider(RAPIER.ColliderDesc.cuboid(0.73, 0.42, 0.72).setTranslation(0, 1.74, 0.05).setDensity(0).setFriction(0.5), this.body);
    this.body.setAdditionalSolverIterations(4);
    this.vehicle = this.world.createVehicleController(this.body);
    this.vehicle.indexUpAxis = 1;
    this.vehicle.setIndexForwardAxis = 2;
    for (const mount of WHEEL_MOUNTS) {
      this.vehicle.addWheel({ x: mount.x, y: HARDPOINT_Y, z: mount.z }, { x: 0, y: -1, z: 0 }, { x: 1, y: 0, z: 0 }, REST_LENGTH, this.radius);
      this.wheels.push({ length: REST_LENGTH, steer: 0, spin: 0, contact: false, load: 0, surface: 'dirt', point: { x: 0, y: 0, z: 0 }, slip: 0 });
    }
    this.setSetup(init.setup);
    this.reset();
  }
  setSetup(setup: Setup) {
    this.setup = validateSetup(setup);
    this.radius = 0.54 - 0.026 * (24 / this.setup.pressure - 1);
    const stiffness = this.setup.spring * 1000;
    const damping = 2 * Math.sqrt(stiffness * MASS / 4) * this.setup.damping / MASS;
    for (let i = 0; i < 4; i++) {
      this.vehicle.setWheelRadius(i, this.radius);
      this.vehicle.setWheelSuspensionStiffness(i, stiffness / MASS);
      this.vehicle.setWheelSuspensionCompression(i, damping);
      this.vehicle.setWheelSuspensionRelaxation(i, damping * 1.18);
      this.vehicle.setWheelMaxSuspensionTravel(i, 0.30);
      this.vehicle.setWheelMaxSuspensionForce(i, 26000);
      this.vehicle.setWheelSideFrictionStiffness(i, 1.0);
    }
  }
  reset(x = SPAWN.x, z = SPAWN.z, yaw = SPAWN.yaw) {
    x = Number.isFinite(x) ? clamp(x, -78, 78) : SPAWN.x;
    z = Number.isFinite(z) ? clamp(z, -78, 78) : SPAWN.z;
    yaw = Number.isFinite(yaw) ? yaw : 0;
    this.body.setTranslation({ x, y: gridHeight(this.init.heights, x, z) + 0.2, z }, true);
    this.body.setRotation({ x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) }, true);
    this.body.setLinvel({ x: 0, y: 0, z: 0 }, true); this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    this.body.resetForces(true); this.body.resetTorques(true);
    this.input = { throttle: 0, steer: 0, brake: 0 }; this.smoothThrottle = this.smoothSteer = 0;
    this.wheelSpinSpeeds.fill(0);
    this.rpm = 950; this.speed = 0; this.gear = 0; this.resetCount++;
    for (const wheel of this.wheels) { wheel.spin = 0; wheel.load = 0; wheel.contact = false; wheel.length = REST_LENGTH; }
    this.world.step();
  }
  step() {
    const q = this.body.rotation(), position = this.body.translation(), velocity = this.body.linvel();
    const forward = rotate({ x: 0, y: 0, z: -1 }, q);
    this.speed = velocity.x * forward.x + velocity.y * forward.y + velocity.z * forward.z;
    const requested = clamp(Number.isFinite(this.input.throttle) ? this.input.throttle : 0, -1, 1);
    // Only S/LT requests automatic braking before reverse. W/RT always drives forward.
    const opposing = requested < 0 && this.speed > 0.1 && this.wheels.some(w => w.contact);
    const targetThrottle = opposing ? 0 : requested;
    if (opposing || requested * this.smoothThrottle < 0) this.smoothThrottle = 0;
    this.smoothThrottle += (targetThrottle - this.smoothThrottle) * (1 - Math.exp(-6 * DT));
    this.smoothSteer += (clamp(this.input.steer, -1, 1) - this.smoothSteer) * (1 - Math.exp(-7 * DT));
    const ratios = [3.6, 2.15, 1.35, 1.0];
    const range = this.setup.lowRange ? 2.5 : 1;
    let wheelRpm = Math.abs(this.speed) / this.radius * 60 / (2 * Math.PI);
    const coupled = wheelRpm * ratios[this.gear] * 4.1 * range;
    if (coupled > 4600 && this.gear < 3) this.gear++;
    if (coupled < 1500 && this.gear > 0) this.gear--;
    this.rpm = Math.min(6000, Math.max(950 + Math.abs(this.smoothThrottle) * 1000, wheelRpm * ratios[this.gear] * 4.1 * range));
    const torque = this.setup.horsepower * 745.7 / (4200 * Math.PI / 30) * (0.64 + 0.36 * Math.sin(clamp((this.rpm - 800) / 5500) * Math.PI));
    const force = this.smoothThrottle * torque * ratios[this.gear] * 4.1 * range * 0.85 / this.radius * (this.rpm > 5800 ? 0.12 : 1);
    const driven = this.setup.drive === '4WD' ? [0, 1, 2, 3] : this.setup.drive === 'FWD' ? [0, 1] : [2, 3];
    let averageDrag = 0;
    const grip: number[] = [];
    for (let i = 0; i < 4; i++) {
      const mount = WHEEL_MOUNTS[i], offset = rotate({ x: mount.x, y: 0, z: mount.z }, q);
      const point = this.wheels[i].contact ? this.wheels[i].point : { x: position.x + offset.x, y: position.y, z: position.z + offset.z };
      const collider = this.vehicle.wheelGroundObject(i);
      const surface = collider && this.solidRocks.has(collider.handle) ? 'rock' : surfaceAt(point.x, point.z, gridHeight(this.init.heights, point.x, point.z));
      this.wheels[i].surface = surface;
      const soft = ['mud', 'snow', 'grass'].includes(surface);
      const pressureFactor = soft ? clamp(1 + (24 - this.setup.pressure) * 0.009, 0.84, 1.12) : 1 - Math.abs(this.setup.pressure - 26) * 0.002;
      grip[i] = SURFACES[surface].grip * pressureFactor;
      this.vehicle.setWheelFrictionSlip(i, grip[i]);
      const steer = i < 2 ? this.smoothSteer * 0.52 / (1 + Math.abs(this.speed) * 0.04) : 0;
      this.vehicle.setWheelSteering(i, steer); this.wheels[i].steer = steer;
      averageDrag += SURFACES[surface].rolling / 4;
    }
    for (let i = 0; i < 4; i++) {
      let wheelForce = driven.includes(i) ? force / driven.length : 0;
      if (!this.setup.locked && driven.includes(i)) {
        const other = i ^ 1;
        const traction = Math.min(this.wheels[i].load * grip[i], this.wheels[other].load * grip[other]);
        wheelForce = clamp(wheelForce, -traction, traction);
      }
      this.vehicle.setWheelEngineForce(i, wheelForce);
      const braking = Math.max(clamp(this.input.brake), opposing ? Math.abs(requested) : 0);
      const rolling = SURFACES[this.wheels[i].surface].rolling * (24 / this.setup.pressure) ** 0.35 * this.wheels[i].load;
      // Rapier expects a maximum braking impulse, not a force.
      this.vehicle.setWheelBrake(i, (braking * 8200 + rolling + (Math.abs(targetThrottle) < 0.02 ? 95 : 0)) * DT);
      const available = this.wheels[i].load * grip[i];
      this.wheels[i].slip = driven.includes(i) && Math.abs(wheelForce) > available ? clamp((Math.abs(wheelForce) - available) / 7000) : 0;
      if (this.wheels[i].contact) {
        this.wheelSpinSpeeds[i] = this.speed / this.radius + Math.sign(wheelForce) * this.wheels[i].slip * 8;
      } else {
        // Cosmetic free-wheel rotation: chassis travel does not turn airborne tires.
        // Use drive demand before the open-differential traction cap (zero off ground).
        const targetSpin = driven.includes(i) ? this.smoothThrottle * 6000 * Math.PI / 30 / (ratios[this.gear] * 4.1 * range) : 0;
        this.wheelSpinSpeeds[i] += (targetSpin - this.wheelSpinSpeeds[i]) * (1 - Math.exp(-3 * DT));
        const brakingDelta = braking * 8200 * this.radius / 18 * DT;
        this.wheelSpinSpeeds[i] = Math.sign(this.wheelSpinSpeeds[i]) * Math.max(0, Math.abs(this.wheelSpinSpeeds[i]) - brakingDelta);
      }
      this.wheels[i].spin -= this.wheelSpinSpeeds[i] * DT;
    }
    this.body.resetForces(true);
    const drag = (25 + averageDrag * 800) * this.speed + 4 * this.speed * Math.abs(this.speed);
    this.body.addForce({ x: -forward.x * drag, y: 0, z: -forward.z * drag }, true);
    if (this.wheels.some(w => w.surface === 'water')) {
      const depth = Math.max(0, waterHeight(position.z) - position.y);
      this.body.addForce({ x: -velocity.x * depth * 500, y: 0, z: -velocity.z * depth * 500 }, true);
    }
    this.vehicle.updateVehicle(DT);
    this.world.step(); this.tick++;
    for (let i = 0; i < 4; i++) {
      const wheel = this.wheels[i];
      wheel.length = this.vehicle.wheelSuspensionLength(i) ?? REST_LENGTH;
      wheel.contact = this.vehicle.wheelIsInContact(i);
      wheel.load = this.vehicle.wheelSuspensionForce(i) ?? 0;
      const point = this.vehicle.wheelContactPoint(i);
      if (point) wheel.point = { x: point.x, y: point.y, z: point.z };
    }
    this.distance += Math.abs(this.speed) * DT;
    const p = this.body.translation();
    if (!Number.isFinite(p.y) || p.y < -8 || Math.abs(p.x) > 95 || Math.abs(p.z) > 95) this.reset();
  }
  snapshot(physicsMs = 0): Snapshot {
    const p = this.body.translation(), q = this.body.rotation();
    const counts = new Map<Surface, number>();
    for (const w of this.wheels) counts.set(w.surface, (counts.get(w.surface) ?? 0) + 1);
    const surface = [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'dirt';
    return { type: 'snapshot', tick: this.tick, position: { x: p.x, y: p.y, z: p.z }, rotation: { x: q.x, y: q.y, z: q.z, w: q.w }, speed: this.speed, rpm: this.rpm, gear: this.speed < -0.3 ? -1 : this.gear + 1, wheels: this.wheels.map(w => ({ ...w, point: { ...w.point } })), surface, physicsMs, distance: this.distance, reset: this.resetCount };
  }
  dispose() { this.world.free(); }
}
export async function initializePhysics() { await RAPIER.init(); }
