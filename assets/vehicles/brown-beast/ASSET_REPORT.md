# Brown Beast truck — extracted visual rig

Source: `Meshy_AI_Brown_Beast_0915132658_texture.glb`, downloaded 2026-09-15.
The downloaded file is untouched. `source.glb` is a byte-identical project copy.

## Result

The truck is suitable for a first vehicle visual rig. Although the GLB exposed
one mesh node, it contained 187 disconnected geometric components after
accounting for duplicated positions at UV/normal seams. Those pieces could be
grouped without cutting faces or rebuilding the model.

The extracted model has:

- Four tire meshes, each containing its casing and detached tread blocks.
- Four separate rotating hub/rim meshes.
- Front and rear axle visual assemblies.
- Four separate diagonal suspension-link meshes.
- One chassis visual containing the body, interior, trim, and remaining frame.
- Named mount, steering, spin, axle, and suspension endpoint nodes.

All **7,516 source triangles** are retained across **15 meshes**. The source
has 7,926 vertices, one material, and three 2048 × 2048 textures. Original UVs
and normals are preserved. The downloaded model had no animation or skin.

## Files

| File | Purpose |
|---|---|
| `brown-beast-rigged.glb` | Game-ready node hierarchy plus a three-second `Rig_Preview` animation. |
| `brown-beast-rigged.blend` | Editable rig, source-derived mesh groups, animation, and preview studio. |
| `rig.json` | Node mappings, approximate wheel centers/radii, suspension endpoints, source provenance, and limitations. |
| `rig-preview.mp4` | Short rendered steering, wheelspin, and axle-articulation demonstration. |
| `preview-rest.png` | Assembled rest pose. |
| `preview-articulation.png` | One frame of the moving rig. |
| `preview-exploded.png` | Separated body and wheels showing the recovered axle/suspension pieces. |
| `validation.json` | Results from the exported-asset checks. |
| `source.glb` | Unmodified source copy for reproducible extraction. |

The animation is a **kinematic demonstration**. It does not implement springs,
dampers, tire forces, drivetrain behavior, ground contact, or a driving game.

## Hierarchy and runtime use

```text
TruckRoot
  Chassis
    Chassis_Visual
    Axle_Front
      Axle_Front_Visual
      Wheel_FL_Mount
        Wheel_FL_Steer
          Wheel_FL_Spin
            Wheel_FL_Tire
            Wheel_FL_Hub
      Wheel_FR_Mount
        Wheel_FR_Steer
          Wheel_FR_Spin
            Wheel_FR_Tire
            Wheel_FR_Hub
      Suspension_FL_LowerMount
      Suspension_FR_LowerMount
    Axle_Rear
      Axle_Rear_Visual
      Wheel_RL_Mount / Steer / Spin / Tire + Hub
      Wheel_RR_Mount / Steer / Spin / Tire + Hub
      Suspension_RL_LowerMount
      Suspension_RR_LowerMount
    Suspension_FL_UpperMount / Suspension_FL / Suspension_FL_Visual
    Suspension_FR_UpperMount / Suspension_FR / Suspension_FR_Visual
    Suspension_RL_UpperMount / Suspension_RL / Suspension_RL_Visual
    Suspension_RR_UpperMount / Suspension_RR / Suspension_RR_Visual
```

Runtime can drive the two axles relative to the chassis, then drive steering
and wheel spin independently. Tire and hub both inherit the wheel spin.
The hierarchy represents solid axles; independent wheel suspension would need
a different parent arrangement or wheel-carrier poses.

The exported coordinate convention matches the game plan: +Y up, -Z forward,
+X right. The root is at the ground plane midway between the axles. The source
was turned around and vertically repositioned to establish that convention.

Source scale is retained. Its bounding box is about 4.59 m long, 2.38 m wide,
and 2.44 m high, with approximately 2.75 m wheelbase and 1.87 m track measured
between visual wheel centers. These are asset measurements, not verified
dimensions of a real truck. Left/right centers retain the source's small
asymmetries. `rig.json` contains the exact inferred centers and visual extents.

For inspection, play the single `Rig_Preview` clip. For physics-driven use,
leave that clip stopped and update node transforms from simulation snapshots.
Steering uses local +Y in glTF; forward wheel spin is about local -X. Axle
orientation must come from its complete pose, not independent tire offsets.

## Suspension interpretation and remaining work

The recovered diagonal pieces are recognizable suspension visuals. Their
mechanical role and attachment locations were inferred from the geometry.
The preview rotates each piece between its endpoints and changes its length
with axial scaling. Production should use telescoping shock geometry or a
proper deforming linkage visual, depending on the chosen suspension design.

The original tire/rim shapes are irregular and can visibly wobble during spin.
We may replace them with cleaner procedural tires/rims when developing
pressure deformation and precise ground contact. The separated source parts
remain useful for style and material reference.

The next simulation work still needs collision proxies, mass/center of mass,
spring and damper settings, tire parameters, steering limits, and drivetrain
data. Full bump/droop plus steering clearance has not been certified by the
small preview motion. Some underbody details remain static chassis decoration
and may need further classification as drivetrain/linkage behavior is added.

The GLB did not embed a license statement; retain the original download's
usage terms with the project's asset records.

## Reproduce and verify

From the repository root:

```bash
ALSOFT_DRIVERS=null blender --background --factory-startup --threads 6 --python tools/rig_brown_beast.py
python tools/validate_brown_beast.py
ffmpeg -hide_banner -loglevel error -y -framerate 24 -i /tmp/crawler-truck-rig-frames/%04d.png -c:v libx264 -crf 19 -pix_fmt yuv420p -movflags +faststart assets/vehicles/brown-beast/rig-preview.mp4
```

Append `-- --skip-animation` to the Blender command to regenerate the GLB,
Blender file, and still previews without rendering all video frames.
The script is specific to this source file and checks its SHA-256 hash.

Validation checks the GLB structure, node bindings, retained triangle count,
each exported vertex's rest position/UV/normal against the source, and the
preview's animation targets and time range. It does not validate vehicle
physics or arbitrary future suspension poses.
