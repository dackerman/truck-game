import { TruckSimulation, initializePhysics, DT } from './physics';
import type { Command } from './protocol';
let simulation: TruckSimulation | undefined, paused = false, last = performance.now(), accumulator = 0, clock: ReturnType<typeof setInterval> | undefined;
let averagedMs = 0;
self.onmessage = async (event: MessageEvent<Command>) => {
  try {
    const message = event.data;
    if (message.type === 'init') {
      if (clock) clearInterval(clock);
      simulation?.dispose();
      await initializePhysics(); simulation = new TruckSimulation(message);
      for (let i = 0; i < 180; i++) simulation.step();
      last = performance.now(); accumulator = 0;
      self.postMessage({ type: 'ready' }); self.postMessage(simulation.snapshot());
      clock = setInterval(() => {
        if (!simulation) return;
        const now = performance.now(), elapsed = (now - last) / 1000; last = now;
        if (paused || elapsed > 0.25) { accumulator = 0; return; }
        accumulator += elapsed;
        let steps = 0;
        const start = performance.now();
        while (accumulator >= DT && steps < 8) { simulation.step(); accumulator -= DT; steps++; }
        if (steps) { averagedMs = averagedMs * 0.95 + (performance.now() - start) / steps * 0.05; self.postMessage(simulation.snapshot(averagedMs)); }
      }, 1000 / 60);
    } else if (message.type === 'input' && simulation) simulation.input = message.input;
    else if (message.type === 'setup' && simulation) { simulation.setSetup(message.setup); self.postMessage(simulation.snapshot()); }
    else if (message.type === 'pause') { paused = message.paused; accumulator = 0; last = performance.now(); }
    else if (message.type === 'reset' && simulation) { simulation.reset(message.x, message.z, message.yaw); self.postMessage(simulation.snapshot()); }
  } catch (error) { self.postMessage({ type: 'error', message: error instanceof Error ? error.message : String(error) }); }
};
