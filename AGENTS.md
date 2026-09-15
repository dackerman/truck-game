# Project handoff

Last updated: 2026-09-15. This is the current implementation handoff; `PLAN.md`
describes the larger intended game and contains an outdated opening status.
Read the relevant source before relying on implementation details below.

## Product direction

Pine Ridge is a desktop-browser offroad exploration game using keyboard and
gamepad. The user values believable vehicle behavior and visibly moving tires
and suspension over strict real-world limits: implausible trucks should still
respond consistently to weight, traction, power, and terrain. Target features
include trucks/jeeps/crawlers, suspension tuning, tire pressure, torque/gearing,
4WD/RWD/FWD, and rock, grass, mud, and snow.

The first demo uses the user's Brown Beast truck and a procedural mountain
proving ground: winding trails, pine trees, rocks, muddy areas, snowy high ground,
a stream/ford, and a cabin at base camp. The user's terrain reference is
`/tmp/codex-clipboard-374aa2ea-8128-4e72-856e-82d4cc84e9c2.png` (temporary file;
do not require it at runtime).

## Run and verify

- Workspace: `/home/david/code/crawler-physics`. Git repository published privately
  as `dackerman/truck-game`; default branch `main`.
- `npm ci` installs the locked dependencies.
- `npm run dev -- --host 127.0.0.1 --port 5173` serves the demo locally.
  The package's default dev host is `0.0.0.0`; the override keeps it loopback-only.
- Demo URL: `http://127.0.0.1:5173/`. A server was started in the previous session,
  but check whether it is still running before starting another.
- `npm run build` runs strict TypeScript checking and a Vite production build.
- `npm test` runs `tests/driving.test.ts`: backward-roll forward drive, braking
  into reverse, reverse from rest, and upright/inverted airborne wheelspin.
  These focused regressions do not establish full-course physics correctness.
- In the Codex sandbox, opening the listening socket required an escalated npm
  command. Dependency installation also required network escalation. These are
  environment restrictions, not application failures.

Last verified: production build passed; the local browser rendered the truck,
terrain, water, and HUD after loading, with no captured console errors. Driving,
braking, terrain traversal, gamepad behavior, and tuning have **not yet received
systematic runtime testing**. No physics or performance benchmark is established.
Large bundle warnings are currently expected (Three.js, the roughly 7 MB GLB,
and Rapier's WASM in the worker).

Controls: WASD/arrows drive; S brakes then reverses; Space service brake; R
recovers to camp; C changes camera; M toggles overview; T opens tuning; P pauses;
drag looks around; scroll zooms. Gamepad mapping: left stick steer, RT throttle,
LT brake/reverse, A brake, Y recover, X camera, Start pause. Tuning/help and hidden
tabs pause simulation. Setup is saved in localStorage `pine-ridge-setup-v1`;
exploration discoveries currently live only in memory.

## Architecture and edit map

Current stack: Three.js 0.186.0, Rapier compat 0.20.0, TypeScript, Vite
(lockfile resolved Vite 8.3.0). Rapier already runs WASM. The custom vehicle layer
is currently TypeScript in a dedicated worker; there is **no custom Rust crate**.
The user is comfortable adding Rust/WASM if useful, but it is not needed to run
or iterate on this demo.

| File | Responsibility |
| --- | --- |
| `src/main.ts` | Startup, scene/cameras, input/gamepad, DOM HUD, menus, minimap, audio, worker snapshots |
| `src/style.css` | HUD and menu appearance/layout |
| `src/world.ts` | Seeded terrain, road/river functions, materials, rocks/trees, landmarks, grid height queries |
| `src/environment.ts` | Terrain rendering, instanced rocks/pines, water shader, cabin/props, cosmetic tire tracks |
| `src/physics.ts` | Rapier world/colliders, vehicle controller, drivetrain/material approximations, tuning/reset |
| `src/physics.worker.ts` | Fixed-step scheduling, initialization/settling, commands and snapshots |
| `src/protocol.ts` | Worker message types, setup defaults, wheel order/mounts, suspension constants |
| `src/truck.ts` | GLB loading and snapshot-driven axle, steering, wheelspin, suspension visuals |
| `PLAN.md` | Long-term architecture, milestones, acceptance criteria; not a list of completed features |
| `.beads/` | Existing local task graph (15 tasks recorded); check actual implementation before closing tasks |

Debug overlay: append `?debug` or press backtick. It shows frame rate, physics
step time, tick, position, wheel loads, and draw calls. `window.__pineRidge` is a
read-only inspection getter exposing ready/snapshot/setup/discoveries/pause,
camera mode, overview, draw calls, and frame time.

## Physics and terrain conventions

- Coordinates: meters, +Y up, -Z forward, +X right. Wheel order is FL, FR, RL, RR.
  Do not silently change handedness, forward direction, or wheel indices.
- Physics steps at 120 Hz (`DT = 1/120`); the worker schedules around 60 Hz with
  at most eight substeps per interval. Rendering interpolates snapshots and
  handles reset discontinuities. Startup settles for 180 steps.
- Current truck mass is 2,200 kg, nominal tire radius 0.54 m, suspension rest
  length 0.70 m, hardpoint Y 1.12 m. Defaults: 4WD, low range, locked, 24 PSI,
  42 kN/m spring, damping ratio 0.65, 280 hp. See `protocol.ts` and `physics.ts`
  for the authoritative parameters and validation bounds.
- The controller uses down-Y suspension rays and a +X axle vector. Rapier's
  forward-axis API is the unusual property setter `setIndexForwardAxis = 2`.
  Verify forward acceleration and steering signs when changing this code.
- Rapier's wheel brake setter takes an impulse: current braking force is
  multiplied by DT. Spring/damper inputs are normalized for this controller;
  do not substitute raw SI coefficients without checking the API semantics.
- Terrain is a 192 m square with 192 segments per side. Render and collision
  use the same generated vertices/triangles. `gridHeight` interpolates those
  exact triangles; use it for ground placement instead of independently
  sampling the continuous height function, which can disagree with the mesh.
- Rocks use convex hulls derived from the render geometry; tree trunks and
  cabin/bench have simple collision proxies. Not every decorative prop collides.
- Spawn is x=0, z=54, yaw=0. Reset clears velocities/forces/input and increments
  the snapshot reset generation. Out-of-bounds/fallen trucks recover to camp.

### What is approximate today

The demo uses Rapier raycast wheels, one chassis rigid body, material-dependent
grip/rolling resistance, effective horsepower/torque/gearing and driven-wheel
selection, and simplified differential behavior. Tire pressure changes effective
radius/grip/resistance and visual scale. These are baseline approximations.

There are no physical unsprung axle bodies, wheel rotational inertia, compliant
contact patches, physical soil deformation/ruts, or full differential mechanics.
Solid axles are **visual articulation derived from independent raycast springs**,
not physically coupled suspension. Wheel slip/spin visuals are approximate.
Water adds drag, not fluid simulation; tracks/puddles are cosmetic. Do not claim
these planned systems are finished or close their full acceptance criteria.

Useful next verification: flat-ground settling/normal loads, forward/reverse
direction, braking, steering signs, reset, finite state over long runs, and
observable drivetrain/pressure effects; then drive the actual rocky/muddy course.

## Brown Beast asset: preserve these details

Asset directory: `assets/vehicles/brown-beast/`. Read `ASSET_REPORT.md`, `rig.json`,
and `validation.json` for provenance, exact node mappings, and extraction checks.
The report predates the driving demo: its statements about simulation still
needing implementation are historical, while its geometry limitations still apply.

- Original download: `~/Downloads/Meshy_AI_Brown_Beast_0915132658_texture.glb`.
  It is untouched. `source.glb` is the byte-identical project copy; preserve it.
- Runtime asset: `brown-beast-rigged.glb`; editable source:
  `brown-beast-rigged.blend`. All 7,516 original triangles are retained across
  15 meshes; UVs/normals/textures survived extraction. The source was a single
  mesh node with disconnected components, not an originally rigged vehicle.
- Root is at ground level midway between axles. Approximate wheelbase 2.75 m,
  track 1.87 m; small source asymmetries are intentional. Exact measurements
  are inferred visual dimensions, not verified real-world specifications.
- Hierarchy: TruckRoot → Chassis → Axle_Front/Axle_Rear →
  Wheel_XX_Mount → Wheel_XX_Steer → Wheel_XX_Spin → tire + hub.
  Suspension upper/lower mount nodes and separate link visuals are named too.
- The GLB's `Rig_Preview` clip is a kinematic inspection animation. **Do not
  play it during driving**; physics snapshots control node transforms.
- Steering rotates local Y; forward spin is local -X. Suspension links stretch
  on local Y; preserve their rest quaternion/twist when re-aiming between mounts.
- Links currently aim and scale rather than telescope. Tire/rim geometry is
  irregular and can wobble during rotation. Some underbody details remain
  static chassis decoration. Full bump/droop/steering clearance is not certified.
- No license statement was embedded in the GLB; retain the download's usage terms.

Reproduce rig extraction using `tools/rig_brown_beast.py` in Blender; verify with
`python tools/validate_brown_beast.py`. See the asset report for exact commands,
including `-- --skip-animation` to avoid rendering all preview video frames.
These checks verify asset structure/geometry, **not driving physics**.
