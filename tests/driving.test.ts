import assert from 'node:assert/strict';
import { test } from 'node:test';
import { TruckSimulation, initializePhysics } from '../src/physics.ts';
import { DEFAULT_SETUP } from '../src/protocol.ts';

await initializePhysics();
function simulation() {
  return new TruckSimulation({ type: 'init', setup: DEFAULT_SETUP,
    vertices: new Float32Array([-96,0,-96, -96,0,96, 96,0,-96, 96,0,96]),
    indices: new Uint32Array([0,1,2, 2,1,3]), heights: new Float32Array(193 * 193),
    rocks: [], trees: [], rockVertices: new Float32Array() });
}
function steps(sim: TruckSimulation, count: number) { for (let i = 0; i < count; i++) sim.step(); }
test('W applies forward drive while rolling backward', () => {
  const sim = simulation();
  try {
    steps(sim, 180);
    sim.body.setLinvel({ x: 0, y: 0, z: 3 }, true);
    sim.input.throttle = 1;
    sim.step();
    assert.ok(sim.vehicle.wheelEngineForce(0)! > 0);
    steps(sim, 240);
    assert.ok(sim.speed > 0, `speed=${sim.speed}`);
  } finally { sim.dispose(); }
});
test('S brakes forward travel, then reverses while held; also reverses from rest', () => {
  const sim = simulation();
  try {
    steps(sim, 180);
    sim.body.setLinvel({ x: 0, y: 0, z: -3 }, true);
    sim.input.throttle = -1;
    sim.step();
    assert.equal(sim.vehicle.wheelEngineForce(0), 0);
    assert.ok(sim.vehicle.wheelBrake(0)! >= 8200 / 120);
    steps(sim, 360);
    assert.ok(sim.speed < -0.1, `speed=${sim.speed}`);
    sim.reset(); steps(sim, 180); sim.input.throttle = -1; steps(sim, 120);
    assert.ok(sim.speed < -0.1);
  } finally { sim.dispose(); }
});
for (const inverted of [false, true]) test(`W spins driven airborne wheels with backward velocity, inverted=${inverted}`, () => {
  const sim = simulation();
  try {
    sim.setSetup({ ...DEFAULT_SETUP, drive: 'RWD', locked: false });
    sim.body.setTranslation({ x: 0, y: 30, z: 0 }, true);
    sim.body.setRotation(inverted ? { x: 0, y: 0, z: 1, w: 0 } : { x: 0, y: 0, z: 0, w: 1 }, true);
    sim.body.setLinvel({ x: 0, y: 0, z: 20 }, true);
    sim.input.throttle = 1; steps(sim, 60);
    assert.ok(sim.wheels.every(w => !w.contact));
    assert.equal(sim.wheels[0].spin, 0);
    assert.ok(sim.wheels[2].spin < -0.1);
    sim.input.throttle = 0; sim.input.brake = 1; steps(sim, 120);
    const spin = sim.wheels[2].spin; sim.step();
    assert.equal(sim.wheels[2].spin, spin);
  } finally { sim.dispose(); }
});
