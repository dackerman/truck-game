import type { Rock, Tree, Surface } from './world';
export type DriveMode = '4WD' | 'RWD' | 'FWD';
export interface Setup { drive: DriveMode; lowRange: boolean; locked: boolean; pressure: number; spring: number; damping: number; horsepower: number; }
export const DEFAULT_SETUP: Setup = { drive: '4WD', lowRange: true, locked: true, pressure: 24, spring: 42, damping: 0.65, horsepower: 280 };
export interface Input { throttle: number; steer: number; brake: number; }
export interface InitMessage { type: 'init'; vertices: Float32Array; indices: Uint32Array; heights: Float32Array; rocks: Rock[]; trees: Tree[]; rockVertices: Float32Array; setup: Setup; }
export type Command = InitMessage | { type: 'input'; input: Input } | { type: 'setup'; setup: Setup } | { type: 'pause'; paused: boolean } | { type: 'reset'; x?: number; z?: number; yaw?: number };
export interface WheelState { length: number; steer: number; spin: number; contact: boolean; load: number; surface: Surface; point: { x: number; y: number; z: number }; slip: number; }
export interface Snapshot { type: 'snapshot'; tick: number; position: { x: number; y: number; z: number }; rotation: { x: number; y: number; z: number; w: number }; speed: number; rpm: number; gear: number; wheels: WheelState[]; surface: Surface; physicsMs: number; distance: number; reset: number; }
export const WHEEL_MOUNTS = [
  { id: 'FL', x: -0.9368, z: -1.3738 }, { id: 'FR', x: 0.9346, z: -1.3783 },
  { id: 'RL', x: -0.9346, z: 1.3806 }, { id: 'RR', x: 0.9368, z: 1.3716 },
];
export const HARDPOINT_Y = 1.12;
export const REST_LENGTH = 0.70;
