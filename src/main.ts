import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import './style.css';
import { createWorld, clamp, LANDMARKS, riverX, TRAIL, type WorldData } from './world';
import { DEFAULT_SETUP, REST_LENGTH, type Command, type Input, type Setup, type Snapshot } from './protocol';
import { Environment, PALETTE, TireTracks } from './environment';
import { TruckVisual } from './truck';
import { validateSetup } from './physics';

const mountain = `<svg viewBox="0 0 48 48" fill="none"><path d="M3 38 17 12l8 14 6-9 14 21H3Z" stroke="currentColor" stroke-width="2"/><path d="m12 22 5 3 4-5M27 23l4 3 4-3M8 43h32" stroke="currentColor" stroke-width="1.5"/></svg>`;
const icon = (name: string) => `<svg viewBox="0 0 24 24">${({ tune: '<path d="M4 7h16M4 17h16M9 4v6M16 14v6"/>', reset: '<path d="M4 10a8 8 0 1 1 1 8M4 4v6h6"/>', sound: '<path d="M4 9v6h4l5 4V5L8 9H4ZM16 8a6 6 0 0 1 0 8M19 5a10 10 0 0 1 0 14"/>', help: '<circle cx="12" cy="12" r="9"/><path d="M9 9a3 3 0 1 1 5 2c-2 1-2 1-2 3m0 2v1"/>' } as Record<string, string>)[name]}</svg>`;
document.querySelector('#app')!.innerHTML = `
  <canvas id="viewport" aria-label="Pine Ridge offroad driving game. Use W A S D to drive, Space to brake, R to recover, C for camera, T to tune." tabindex="0"></canvas>
  <div class="hud">
    <header class="top"><div class="brand">${mountain}<div><div class="eyebrow">OFFROAD EXPLORER</div><h1>PINE RIDGE</h1></div></div>
      <nav class="top-actions"><button class="button" id="tune" aria-expanded="false">${icon('tune')}Tune truck <kbd>T</kbd></button><button class="button icon-button" id="recover" title="Recover to base camp (R)" aria-label="Recover truck">${icon('reset')}</button><button class="button icon-button" id="sound" title="Enable engine sound" aria-label="Enable engine sound">${icon('sound')}</button><button class="button icon-button" id="help-button" title="Controls" aria-label="Show controls">${icon('help')}</button></nav>
    </header>
    <div class="location"><i class="dot"></i><span id="location-name">BASE CAMP</span><span class="surface-tag" id="surface">DRY TRAIL</span></div>
    <div class="paused" id="paused">PAUSED</div>
    <section class="instruments" aria-label="Vehicle instruments">
      <div class="instrument-top"><span>BROWN BEAST</span><span class="drive" id="drive-readout">4L · LOCKED</span></div>
      <div class="speed-row"><div class="speed"><span id="speed">00</span><small>KM/H</small></div><div class="gear"><small>GEAR</small><span id="gear">1</span></div></div>
      <div class="rpm"><i id="rpm-bar"></i></div><div class="rpm-label"><span id="rpm">950 RPM</span><span>6,000</span></div>
      <div class="suspension">${['FL', 'FR', 'RL', 'RR'].map((name, i) => `<div><div class="wheel-label"><span>${name}</span><span id="contact-${i}">●</span></div><div class="wheel-bar" id="travel-${i}"><i></i></div></div>`).join('')}</div>
      <div class="instrument-foot"><span>SUSPENSION TRAVEL</span><b id="pressure-readout">24 PSI</b></div>
    </section>
    <div class="controls"><div class="control primary"><kbd>W A S D</kbd> Drive</div><div class="control"><kbd>SPACE</kbd> Brake</div><div class="control optional"><kbd>R</kbd> Recover</div><div class="control"><kbd>C</kbd> Camera</div><div class="control optional"><kbd>M</kbd> Map</div></div>
    <div class="hint" id="hint">Follow the trail. Find your line. <span style="color:#e8c786">Drag to look · Scroll to zoom</span></div>
    <div class="camera-label" id="camera-label">CHASE CAMERA</div>
    <section class="map-box"><div class="map-title"><span>LOCAL MAP</span><b>N ↑</b></div><canvas id="map" width="376" height="332" role="button" tabindex="0" aria-label="Toggle full course overview"></canvas><div class="map-foot"><span id="discoveries">1 / 6 DISCOVERED</span><span id="distance">0 m</span></div></section>
    <aside class="panel" id="setup-panel" aria-label="Truck tuning">
      <h2>Make it your own.</h2><div class="sub">Brown Beast · Trail configuration<br>Driving pauses while you tune.</div>
      <div class="panel-label" style="margin-top:0">DRIVETRAIN</div><div class="segmented" id="drive-options">${['4WD', 'RWD', 'FWD'].map(d => `<button data-drive="${d}">${d}</button>`).join('')}</div>
      <div class="toggles"><button id="low-range">Low range</button><button id="diff-lock">Diff locks</button></div>
      ${[
        ['pressure', 'TIRE PRESSURE', 12, 40, 1, '12 PSI · softer', '40 PSI · firmer'],
        ['spring', 'SPRING RATE', 25, 85, 1, 'Compliant', 'Firm'],
        ['damping', 'DAMPING', 0.25, 1.2, 0.05, 'Lively', 'Controlled'],
        ['horsepower', 'ENGINE POWER', 140, 600, 10, '140 HP', '600 HP'],
      ].map(([key, name, min, max, step, left, right]) => `<label class="panel-label" for="${key}">${name}<b id="${key}-value"></b></label><input class="range" id="${key}" type="range" min="${min}" max="${max}" step="${step}"/><div class="range-ends"><span>${left}</span><span>${right}</span></div>`).join('')}
      <button class="full" id="resume">Back to the trail</button><button class="reset-setup" id="defaults">Restore trail setup</button>
    </aside>
    <aside class="panel help" id="help-panel"><h2>A little less road.</h2><p>Explore six locations around Pine Ridge. There’s no clock: slow down, place your tires, and try another line.</p>
      ${[['W / S', 'Throttle / brake, then reverse'], ['A / D', 'Steer'], ['Space', 'Service brakes'], ['Drag / scroll', 'Look around / zoom'], ['C / M', 'Camera / course overview'], ['T / P', 'Tune truck / pause'], ['R', 'Recover to base camp']].map(([a, b]) => `<div class="help-row"><kbd>${a}</kbd><span>${b}</span></div>`).join('')}
      <p>Gamepad: left stick steers, RT drives, LT brakes/reverses. A brakes, Y recovers, X changes camera, Start pauses.</p><button class="full" id="close-help">Let’s drive</button></aside>
    <div class="toast" id="toast" role="status" aria-live="polite"><small>NEW LOCATION DISCOVERED</small><strong></strong></div><div class="debug" id="debug"></div>
  </div>
  <div class="loading" id="loading"><div class="crest">${mountain}</div><h2>PINE RIDGE</h2><p id="loading-message">Finding a little less road…</p><div class="loading-line"><i id="loading-progress"></i></div><div class="footer">PROVING GROUND / 01</div></div>`;

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id)! as T;
let setup: Setup = { ...DEFAULT_SETUP };
try { const stored = localStorage.getItem('pine-ridge-setup-v1'); if (stored) setup = validateSetup({ ...DEFAULT_SETUP, ...JSON.parse(stored) }); } catch { /* Storage is optional for driving. */ }
const worker = new Worker(new URL('./physics.worker.ts', import.meta.url), { type: 'module' });
const send = (message: Command) => worker.postMessage(message);
let current: Snapshot | undefined, previous: Snapshot | undefined, received = 0;
let initialized = false, panelOpen = false, helpOpen = false, manualPause = false, lastPaused = false;
let environment: Environment, world: WorldData, tracks: TireTracks;
const keys = new Set<string>();
const truck = new TruckVisual();
const scene = new THREE.Scene();
scene.background = new THREE.Color('#b9ccd0'); scene.fog = new THREE.FogExp2('#b9ccd0', 0.0036);
const camera = new THREE.PerspectiveCamera(52, innerWidth / innerHeight, 0.1, 1200);
let renderer: THREE.WebGLRenderer;
let cameraMode = 0, overview = false, cameraSnap = true, orbit = 0, zoom = 11, dragging = false, lastPointer = { x: 0, y: 0 }, lookHeight = 0;
let lastFrame = performance.now(), lastUI = 0, lastInput = '', lastTickForTracks = 0, toastTimer: ReturnType<typeof setTimeout>;
let audioContext: AudioContext | undefined, engineOscillator: OscillatorNode | undefined, engineGain: GainNode | undefined, soundEnabled = false;
let frameMs = 16.7, debug = new URLSearchParams(location.search).has('debug');
const discovered = new Set([0]);
const SURFACE_LABELS = { dirt: 'DRY TRAIL', grass: 'GRASS', rock: 'ROCK', mud: 'MUD', water: 'SHALLOW WATER', snow: 'SNOW' };

function progress(message: string, percent: number) { $('loading-message').textContent = message; $('loading-progress').style.width = `${percent}%`; }
function fatal(message: string) {
  console.error(message); $('loading').classList.remove('done'); $('loading').innerHTML = `<div class="error"><h2>Let’s get you back on the trail.</h2><p id="error-message"></p><button class="button" onclick="location.reload()">Reload demo</button></div>`; $('error-message').textContent = message;
  manualPause = true; syncPause();
}
const ready = new Promise<void>((resolve, reject) => {
  worker.onmessage = (event: MessageEvent<Snapshot | { type: 'ready' | 'error'; message?: string }>) => {
    const message = event.data;
    if (message.type === 'ready') resolve();
    else if (message.type === 'error') { reject(new Error(message.message)); if (initialized) fatal(message.message ?? 'The simulation stopped.'); }
    else if (message.type === 'snapshot') {
      if (!current || current.reset !== message.reset) { previous = message; cameraSnap = true; }
      else previous = current;
      current = message; received = performance.now();
    }
  };
  worker.onerror = event => { reject(new Error(event.message)); if (initialized) fatal(event.message); };
});

function syncPause() {
  const paused = manualPause || panelOpen || helpOpen || document.hidden;
  if (paused !== lastPaused) { keys.clear(); send({ type: 'input', input: { throttle: 0, steer: 0, brake: 0 } }); lastInput = ''; send({ type: 'pause', paused }); lastPaused = paused; }
  $('paused').classList.toggle('visible', paused); $('paused').textContent = panelOpen ? 'PAUSED FOR TUNING' : 'PAUSED';
}
function toggleSetup(open = !panelOpen) { panelOpen = open; $('setup-panel').classList.toggle('open', open); $('tune').classList.toggle('active', open); $('tune').setAttribute('aria-expanded', String(open)); syncPause(); if (!open) $('viewport').focus(); }
function updateSetup() {
  setup = validateSetup(setup);
  document.querySelectorAll<HTMLButtonElement>('[data-drive]').forEach(b => b.classList.toggle('selected', b.dataset.drive === setup.drive));
  $('low-range').classList.toggle('selected', setup.lowRange); $('diff-lock').classList.toggle('selected', setup.locked);
  for (const key of ['pressure', 'spring', 'damping', 'horsepower'] as const) {
    $<HTMLInputElement>(key).value = String(setup[key]);
    $(`${key}-value`).textContent = key === 'pressure' ? `${setup[key]} PSI` : key === 'spring' ? `${setup[key]} kN/m` : key === 'damping' ? `${Math.round(setup[key] * 100)}%` : `${setup[key]} HP`;
  }
  $('pressure-readout').textContent = `${setup.pressure} PSI`;
  $('drive-readout').textContent = `${setup.drive === '4WD' ? setup.lowRange ? '4L' : '4H' : setup.drive} · ${setup.locked ? 'LOCKED' : 'OPEN'}`;
  try { localStorage.setItem('pine-ridge-setup-v1', JSON.stringify(setup)); } catch { /* Continue without persistence. */ }
  if (initialized) send({ type: 'setup', setup });
}
$('tune').onclick = () => toggleSetup(); $('resume').onclick = () => toggleSetup(false);
$('recover').onclick = () => recover();
$('defaults').onclick = () => { setup = { ...DEFAULT_SETUP }; updateSetup(); };
$('low-range').onclick = () => { setup.lowRange = !setup.lowRange; updateSetup(); };
$('diff-lock').onclick = () => { setup.locked = !setup.locked; updateSetup(); };
document.querySelectorAll<HTMLButtonElement>('[data-drive]').forEach(b => b.onclick = () => { setup.drive = b.dataset.drive as Setup['drive']; updateSetup(); });
for (const key of ['pressure', 'spring', 'damping', 'horsepower'] as const) $<HTMLInputElement>(key).oninput = e => { setup[key] = Number((e.target as HTMLInputElement).value); updateSetup(); };
function toggleHelp(open: boolean) { helpOpen = open; $('help-panel').classList.toggle('open', open); syncPause(); }
$('help-button').onclick = () => toggleHelp(!helpOpen); $('close-help').onclick = () => toggleHelp(false);
$('map').onclick = () => { overview = !overview; cameraSnap = false; updateCameraLabel(); };
$('map').onkeydown = event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); $('map').click(); } };
function updateCameraLabel() { $('camera-label').textContent = overview ? 'COURSE OVERVIEW · M TO RETURN' : cameraMode === 0 ? 'CHASE CAMERA' : 'SUSPENSION CAMERA'; }
function cycleCamera() { overview = false; cameraMode = (cameraMode + 1) % 2; orbit = 0; lookHeight = 0; updateCameraLabel(); }
function recover() { keys.clear(); lastInput = ''; send({ type: 'reset' }); $('hint').textContent = 'Back at base camp. Try a different line.'; $('hint').classList.remove('hidden'); setTimeout(() => $('hint').classList.add('hidden'), 4500); }
function announce(index: number) { const element = $('toast'); element.querySelector('strong')!.textContent = LANDMARKS[index].name; element.classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => element.classList.remove('show'), 4500); }

window.addEventListener('keydown', event => {
  if (event.target instanceof HTMLInputElement) return;
  const code = event.code;
  if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(code)) event.preventDefault();
  keys.add(code);
  if (event.repeat) return;
  if (code === 'KeyT') toggleSetup();
  else if (code === 'KeyP') { manualPause = !manualPause; syncPause(); }
  else if (code === 'KeyR' && initialized) recover();
  else if (code === 'KeyC') cycleCamera();
  else if (code === 'KeyM') { overview = !overview; updateCameraLabel(); }
  else if (code === 'Escape') { toggleSetup(false); toggleHelp(false); }
  else if (code === 'Backquote') { debug = !debug; $('debug').classList.toggle('show', debug); }
});
window.addEventListener('keyup', event => keys.delete(event.code));
window.addEventListener('blur', () => { keys.clear(); lastInput = ''; send({ type: 'input', input: { throttle: 0, steer: 0, brake: 0 } }); });
document.addEventListener('visibilitychange', syncPause);
const canvas = $<HTMLCanvasElement>('viewport');
canvas.addEventListener('contextmenu', e => e.preventDefault());
canvas.addEventListener('pointerdown', e => { dragging = true; lastPointer = { x: e.clientX, y: e.clientY }; canvas.setPointerCapture(e.pointerId); canvas.focus(); });
canvas.addEventListener('pointerup', () => dragging = false);
canvas.addEventListener('pointercancel', () => dragging = false);
canvas.addEventListener('pointermove', e => { if (!dragging) return; orbit -= (e.clientX - lastPointer.x) * 0.008; lookHeight = clamp(lookHeight + (e.clientY - lastPointer.y) * 0.025, -1.5, 6); lastPointer = { x: e.clientX, y: e.clientY }; });
canvas.addEventListener('wheel', e => { e.preventDefault(); zoom = clamp(zoom + e.deltaY * 0.015, 6, 24); }, { passive: false });
let lastButtons: boolean[] = [];
function input(): Input {
  let throttle = Number(keys.has('KeyW') || keys.has('ArrowUp')) - Number(keys.has('KeyS') || keys.has('ArrowDown'));
  let steer = Number(keys.has('KeyA') || keys.has('ArrowLeft')) - Number(keys.has('KeyD') || keys.has('ArrowRight'));
  let brake = Number(keys.has('Space'));
  const pad = Array.from(navigator.getGamepads?.() ?? []).find(p => p?.connected);
  if (pad) {
    const axis = pad.axes[0] ?? 0, mapped = Math.abs(axis) < 0.12 ? 0 : Math.sign(axis) * ((Math.abs(axis) - 0.12) / 0.88) ** 1.3;
    if (Math.abs(mapped) > Math.abs(steer)) steer = -mapped;
    const trigger = (pad.buttons[7]?.value ?? 0) - (pad.buttons[6]?.value ?? 0); if (Math.abs(trigger) > Math.abs(throttle)) throttle = trigger;
    brake = Math.max(brake, pad.buttons[0]?.value ?? 0);
    const pressed = pad.buttons.map(b => b.pressed);
    if (pressed[3] && !lastButtons[3]) recover();
    if (pressed[2] && !lastButtons[2]) cycleCamera();
    if (pressed[9] && !lastButtons[9]) { manualPause = !manualPause; syncPause(); }
    lastButtons = pressed;
  } else lastButtons = [];
  return lastPaused ? { throttle: 0, steer: 0, brake: 0 } : { throttle, steer, brake };
}

$('sound').onclick = async () => {
  try {
    if (!audioContext) { audioContext = new AudioContext(); engineOscillator = audioContext.createOscillator(); engineOscillator.type = 'sawtooth'; const filter = audioContext.createBiquadFilter(); filter.type = 'lowpass'; filter.frequency.value = 450; engineGain = audioContext.createGain(); engineGain.gain.value = 0; engineOscillator.connect(filter).connect(engineGain).connect(audioContext.destination); engineOscillator.start(); }
    await audioContext.resume(); soundEnabled = !soundEnabled; $('sound').classList.toggle('active', soundEnabled); $('sound').setAttribute('aria-label', soundEnabled ? 'Mute engine sound' : 'Enable engine sound');
  } catch { $('hint').textContent = 'Audio is unavailable in this browser. Driving is unaffected.'; $('hint').classList.remove('hidden'); }
};

let mapBackground: HTMLCanvasElement;
function prepareMap() {
  mapBackground = document.createElement('canvas'); mapBackground.width = 376; mapBackground.height = 332;
  const ctx = mapBackground.getContext('2d')!, step = 4;
  for (let z = 0; z < 332; z += step) for (let x = 0; x < 376; x += step) {
    const wx = x / 376 * 192 - 96, wz = z / 332 * 192 - 96, h = environment.ground(wx, wz);
    const t = clamp(h / 29); ctx.fillStyle = h < 0 ? '#64888a' : `rgb(${48 + t * 58},${67 + t * 51},${47 + t * 37})`; ctx.fillRect(x, z, step, step);
    if (h > 0 && h % 4 < 0.24) { ctx.fillStyle = '#c3c79a22'; ctx.fillRect(x, z, step, step); }
  }
  const coord = (x: number, z: number) => [(x + 96) / 192 * 376, (z + 96) / 192 * 332];
  ctx.strokeStyle = '#8bb7b9'; ctx.lineWidth = 5; ctx.beginPath(); for (let z = -90; z <= 96; z += 2) { const p = coord(riverX(z), z); if (z === -90) ctx.moveTo(p[0], p[1]); else ctx.lineTo(p[0], p[1]); } ctx.stroke();
  ctx.strokeStyle = '#d7bd81'; ctx.lineWidth = 2.4; ctx.beginPath(); TRAIL.forEach((v, i) => { const p = coord(v.x, v.z); if (i === 0) ctx.moveTo(p[0], p[1]); else ctx.lineTo(p[0], p[1]); }); ctx.stroke();
}
function updateMap(state: Snapshot) {
  const ctx = $<HTMLCanvasElement>('map').getContext('2d')!; ctx.drawImage(mapBackground, 0, 0);
  LANDMARKS.forEach((landmark, i) => { const x = (landmark.x + 96) / 192 * 376, y = (landmark.z + 96) / 192 * 332; ctx.beginPath(); ctx.arc(x, y, 4, 0, Math.PI * 2); ctx.fillStyle = discovered.has(i) ? '#eaca80' : '#435c45'; ctx.fill(); ctx.strokeStyle = '#ece8ce'; ctx.lineWidth = 1.1; ctx.stroke(); });
  const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(truck.root.quaternion);
  ctx.save(); ctx.translate((state.position.x + 96) / 192 * 376, (state.position.z + 96) / 192 * 332); ctx.rotate(Math.atan2(forward.x, -forward.z)); ctx.shadowColor = '#112a1e'; ctx.shadowBlur = 7; ctx.fillStyle = '#fff7d7'; ctx.beginPath(); ctx.moveTo(0, -9); ctx.lineTo(6, 7); ctx.lineTo(0, 4); ctx.lineTo(-6, 7); ctx.closePath(); ctx.fill(); ctx.restore();
}

function updateCamera(dt: number) {
  const target = truck.root.position.clone().add(new THREE.Vector3(0, overview ? 0 : 1.1, 0));
  const wanted = new THREE.Vector3();
  if (overview) { target.set(0, 6, -1); wanted.set(103, 127, 133); }
  else {
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(truck.root.quaternion);
    const yaw = Math.atan2(-forward.x, -forward.z) + orbit;
    const length = cameraMode === 0 ? zoom : zoom * 0.57;
    wanted.set(target.x + Math.sin(yaw + (cameraMode === 1 ? 0.65 : 0)) * length, target.y + (cameraMode === 0 ? 4.3 + zoom * 0.08 : 0.6) + lookHeight, target.z + Math.cos(yaw + (cameraMode === 1 ? 0.65 : 0)) * length);
    wanted.y = Math.max(wanted.y, environment.ground(wanted.x, wanted.z) + 0.75);
    for (let t = 0.18; t < 1; t += 0.12) { const p = target.clone().lerp(wanted, t); if (p.y < environment.ground(p.x, p.z) + 0.35) { wanted.copy(target).lerp(p, 0.85); wanted.y = Math.max(wanted.y, environment.ground(wanted.x, wanted.z) + 0.6); break; } }
  }
  if (cameraSnap) { camera.position.copy(wanted); cameraSnap = false; } else camera.position.lerp(wanted, 1 - Math.exp(-5.5 * dt));
  camera.lookAt(target);
}

function render(now: number) {
  const dt = Math.min((now - lastFrame) / 1000, 0.1); lastFrame = now; frameMs = frameMs * 0.96 + dt * 1000 * 0.04;
  if (initialized && current && previous) {
    const controls = input(), encoded = JSON.stringify(controls);
    if (encoded !== lastInput) { send({ type: 'input', input: controls }); lastInput = encoded; }
    const duration = Math.max(8.33, (current.tick - previous.tick) / 120 * 1000), alpha = lastPaused ? 1 : clamp((now - received) / duration);
    truck.update(previous, current, alpha, setup); environment.update(now / 1000); updateCamera(dt);
    const lightTarget = truck.root.position;
    sun.position.set(lightTarget.x - 28, lightTarget.y + 48, lightTarget.z + 18); sun.target.position.copy(lightTarget); sun.target.updateMatrixWorld();
    if (current.tick !== lastTickForTracks && Math.abs(current.speed) > 0.3) {
      const direction = new THREE.Vector3(0, 0, -1).applyQuaternion(truck.root.quaternion), yaw = Math.atan2(-direction.x, -direction.z);
      for (let i = 2; i < 4; i++) { const w = current.wheels[i]; if (w.contact) tracks.add(i - 2, w.point, yaw, w.surface, (x, z) => environment.ground(x, z)); }
      lastTickForTracks = current.tick;
    }
    if (now - lastUI > 100) {
      lastUI = now;
      $('speed').textContent = Math.round(Math.abs(current.speed) * 3.6).toString().padStart(2, '0'); $('gear').textContent = current.gear < 0 ? 'R' : String(current.gear);
      $('rpm').textContent = `${Math.round(current.rpm / 50) * 50} RPM`; $('rpm-bar').style.width = `${current.rpm / 6000 * 100}%`;
      $('surface').textContent = SURFACE_LABELS[current.surface];
      current.wheels.forEach((w, i) => { $(`travel-${i}`).querySelector<HTMLElement>('i')!.style.width = `${clamp((REST_LENGTH + 0.25 - w.length) / 0.55) * 100}%`; $(`travel-${i}`).classList.toggle('air', !w.contact); $(`contact-${i}`).textContent = w.contact ? '●' : '○'; });
      let nearest = 0, closest = Infinity;
      LANDMARKS.forEach((landmark, i) => { const distance = Math.hypot(current!.position.x - landmark.x, current!.position.z - landmark.z); if (distance < closest) { closest = distance; nearest = i; } if (distance < 8 && !discovered.has(i)) { discovered.add(i); announce(i); } });
      $('location-name').textContent = LANDMARKS[nearest].name; $('discoveries').textContent = `${discovered.size} / 6 DISCOVERED`; $('distance').textContent = current.distance > 1000 ? `${(current.distance / 1000).toFixed(1)} km` : `${Math.floor(current.distance)} m`;
      updateMap(current);
      if (debug) $('debug').textContent = `frame ${(1000 / frameMs).toFixed(0)} fps\nphysics ${current.physicsMs.toFixed(2)} ms/step\ntick ${current.tick}\nx ${current.position.x.toFixed(1)} y ${current.position.y.toFixed(2)} z ${current.position.z.toFixed(1)}\nloads ${current.wheels.map(w => w.load.toFixed(0)).join(' ')}\ncalls ${renderer.info.render.calls}`;
    }
    if (engineGain && engineOscillator && audioContext) { engineOscillator.frequency.setTargetAtTime(current.rpm / 26, audioContext.currentTime, 0.1); engineGain.gain.setTargetAtTime(soundEnabled && !lastPaused ? 0.013 + Math.abs(controls.throttle) * 0.018 : 0, audioContext.currentTime, 0.15); }
    renderer.render(scene, camera);
  }
}
const sun = new THREE.DirectionalLight('#fff0ce', 3.1);
async function start() {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setSize(innerWidth, innerHeight); renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5)); renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap; renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;
  scene.add(new THREE.HemisphereLight('#d7e9ed', '#8b8d5e', 2.0));
  sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048); Object.assign(sun.shadow.camera, { left: -40, right: 40, top: 40, bottom: -40, near: 1, far: 125 }); sun.shadow.bias = -0.0003; sun.shadow.normalBias = 0.09; scene.add(sun, sun.target);
  const pmrem = new THREE.PMREMGenerator(renderer), room = new RoomEnvironment(); const lighting = pmrem.fromScene(room, 0.04); scene.environment = lighting.texture; scene.environmentIntensity = 0.38; room.dispose(); pmrem.dispose();
  progress('Unpacking the Brown Beast…', 22);
  const loaded = truck.load(scene);
  await new Promise(requestAnimationFrame);
  progress('Carving trails and a creek through the valley…', 40);
  await new Promise(resolve => setTimeout(resolve, 20));
  world = createWorld(); environment = new Environment(scene, world); tracks = new TireTracks(scene); prepareMap();
  progress('Settling the suspension. Almost ready…', 74);
  send({ type: 'init', vertices: world.vertices, indices: world.indices, heights: world.heights, rocks: world.rocks, trees: world.trees, rockVertices: new Float32Array(environment.rockGeometry.getAttribute('position').array), setup });
  await Promise.all([loaded, ready]);
  initialized = true; updateSetup(); syncPause(); $('debug').classList.toggle('show', debug); progress('Take the long way.', 100);
  setTimeout(() => $('loading').classList.add('done'), 220);
  setTimeout(() => $('hint').classList.add('hidden'), 12000);
  renderer.setAnimationLoop(render); canvas.focus();
  // Read-only telemetry for local smoke tests and development diagnosis.
  Object.defineProperty(window, '__pineRidge', { get: () => ({ ready: initialized, snapshot: current, setup: { ...setup }, discovered: [...discovered], paused: lastPaused, cameraMode, overview, drawCalls: renderer.info.render.calls, frameMs }) });
}
window.addEventListener('resize', () => { if (!renderer) return; camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); });
canvas.addEventListener('webglcontextlost', e => { e.preventDefault(); fatal('The graphics context was lost. Reload to restart the demo.'); });
updateSetup(); start().catch(error => fatal(error instanceof Error ? error.message : String(error)));
