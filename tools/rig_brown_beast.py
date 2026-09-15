"""Extract the inspected Brown Beast's loose geometry into a Three.js-friendly rig.

Run with Blender, not system Python:
  ALSOFT_DRIVERS=null blender -b --factory-startup --python tools/rig_brown_beast.py

This is an asset-specific extraction, guarded by the source hash. No source
triangles are cut or discarded. The animation is a kinematic rig demonstration.
"""
import hashlib
import json
import math
import os
from pathlib import Path
import sys

import bpy
import numpy as np
from mathutils import Matrix, Quaternion, Vector


ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'assets/vehicles/brown-beast'
SOURCE = OUT / 'source.glb'
SOURCE_HASH = '598238205171f15093fb626a6f2dbf699d1089d7d8757d37eef7b4da03fe9c0e'
assert hashlib.sha256(SOURCE.read_bytes()).hexdigest() == SOURCE_HASH, 'Reinspect changed source geometry before rigging.'
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=str(SOURCE))
source = next(o for o in bpy.context.scene.objects if o.type == 'MESH')
mesh = source.data
vertices = [source.matrix_world @ v.co for v in mesh.vertices]
assert len(vertices) == 7926 and len(mesh.polygons) == 7516

# Find loose components while respecting geometric coincidences across UV seams.
# This is analysis only: original split vertices, UVs and normals are retained.
parent = list(range(len(vertices)))
def find(i):
    while parent[i] != i:
        parent[i] = parent[parent[i]]
        i = parent[i]
    return i
def union(a, b):
    parent[find(a)] = find(b)
positions = {}
for i, point in enumerate(vertices):
    key = tuple(round(c, 5) for c in point)
    if key in positions:
        union(i, positions[key])
    else:
        positions[key] = i
for edge in mesh.edges:
    union(*edge.vertices)
components = {}
for i in range(len(vertices)):
    components.setdefault(find(i), []).append(i)
components = sorted(components.values(), key=len, reverse=True)
assert len(components) == 187
vertex_component = {v: c for c, ids in enumerate(components) for v in ids}

def bounds(ids):
    coords = np.array([vertices[i] for i in ids])
    low, high = coords.min(axis=0), coords.max(axis=0)
    return low, high, (low + high) / 2, high - low

component_bounds = [bounds(ids) for ids in components]
wheel_centers = {}
for c in [1, 2, 3, 4]:
    lo, hi, center, size = component_bounds[c]
    assert 0.49 < size[0] < 0.54 and 0.98 < size[1] < 1.06
    # The original truck faces Blender -Y; after normalization left is -X.
    name = ('F' if center[1] < 0 else 'R') + ('L' if center[0] > 0 else 'R')
    wheel_centers[name] = center

mid_y = float(np.mean([p[1] for p in wheel_centers.values()]))
ground_z = min(p.z for p in vertices)
rotation = Matrix.Rotation(math.pi, 3, 'Z')
def canonical(point):
    # Blender canonical +Y forward/+Z up exports as glTF -Z forward/+Y up.
    return Vector((-point[0], -point[1] + mid_y, point[2] - ground_z))
def gltf(point):
    return [float(point[0]), float(point[2]), float(-point[1])]
canonical_vertices = [canonical(v) for v in vertices]

groups = {}
assignment = {}
def assign(c, group):
    assert c not in assignment, (c, group)
    assignment[c] = group
    groups.setdefault(group, []).append(c)

# Each wheel includes its disconnected tread blocks as well as its main casing.
# Small central pieces are retained as separate rotating hub/rim geometry.
for c, ids in enumerate(components):
    lo, hi, center, size = component_bounds[c]
    if min(abs(lo[0]), abs(hi[0])) < 0.65 or lo[0] * hi[0] <= 0:
        continue
    for name, wheel in wheel_centers.items():
        if center[0] * wheel[0] < 0:
            continue
        coords = np.array([vertices[v] for v in ids])
        radial = np.linalg.norm(coords[:, 1:3] - wheel[1:3], axis=1)
        if radial.max() < 0.63 and hi[2] < -0.09:
            assign(c, f'Wheel_{name}_' + ('Hub' if radial.max() < 0.32 else 'Tire'))
            break

# Inspected source component IDs: differential cases, shafts, knuckle/bracket
# pieces and transverse links. These are visual assignments, not a claim about
# the manufacturer's real mechanical construction.
for c in [10, 11, 23, 25, 29, 42, 54, 60, 71]:
    assign(c, 'Axle_Front_Visual')
for c in [16, 26, 46, 47, 48, 51, 55]:
    assign(c, 'Axle_Rear_Visual')
link_components = {'FL': 30, 'FR': 27, 'RL': 35, 'RR': 32}
for name, c in link_components.items():
    assign(c, f'Suspension_{name}_Visual')
for c in range(len(components)):
    if c not in assignment:
        assign(c, 'Chassis_Visual')

faces_by_group = {name: [] for name in groups}
for face in mesh.polygons:
    ids = {vertex_component[v] for v in face.vertices}
    assert len(ids) == 1
    faces_by_group[assignment[ids.pop()]].append(face.index)

collection = bpy.data.collections.new('Brown_Beast_Rig')
bpy.context.scene.collection.children.link(collection)
def empty(name, parent_obj=None, position=(0, 0, 0)):
    obj = bpy.data.objects.new(name, None)
    collection.objects.link(obj)
    obj.empty_display_type = 'PLAIN_AXES'
    obj.empty_display_size = 0.12
    obj.parent = parent_obj
    obj.location = position
    return obj

root = empty('TruckRoot')
root['rig_schema'] = 1
root['asset_id'] = 'brown-beast'
root['forward'] = '-Z in glTF'
root['preview_is_physics'] = False
chassis = empty('Chassis', root)
chassis['role'] = 'sprung_chassis_pose'
axles = {}
axle_origins = {}
for prefix, title in [('F', 'Front'), ('R', 'Rear')]:
    center = np.mean([wheel_centers[prefix + side] for side in ['L', 'R']], axis=0)
    center[0] = 0
    point = canonical(center)
    axle_origins[prefix] = point
    axle = empty(f'Axle_{title}', chassis, point)
    axle['role'] = 'solid_axle_pose'
    axles[prefix] = axle

steering = {}
spinning = {}
wheel_mounts = {}
for name, center in wheel_centers.items():
    point = canonical(center)
    mount = empty(f'Wheel_{name}_Mount', axles[name[0]], point - axle_origins[name[0]])
    steer = empty(f'Wheel_{name}_Steer', mount)
    steer['role'] = 'steering_y_axis_in_gltf'
    spin = empty(f'Wheel_{name}_Spin', steer)
    spin['role'] = 'wheel_rotation_x_axis'
    wheel_mounts[name], steering[name], spinning[name] = mount, steer, spin

link_holders = {}
link_points = {}
for name, c in link_components.items():
    points = np.array([canonical_vertices[v] for v in components[c]])
    center = points.mean(axis=0)
    _, vectors = np.linalg.eigh(np.cov((points-center).T))
    axis = vectors[:, -1]
    projection = (points-center) @ axis
    ends = [Vector(center + axis * projection.min()), Vector(center + axis * projection.max())]
    upper, lower = sorted(ends, key=lambda p: p.z, reverse=True)
    holder = empty(f'Suspension_{name}', chassis, upper)
    holder.rotation_mode = 'QUATERNION'
    holder.rotation_quaternion = (lower-upper).to_track_quat('Z', 'Y')
    holder['role'] = 'visual_link_endpoint_binding'
    holder['preview_deformation'] = 'uniform_length_scaling; replace with telescoping geometry for production'
    empty(f'Suspension_{name}_UpperMount', chassis, upper)
    empty(f'Suspension_{name}_LowerMount', axles[name[0]], lower-axle_origins[name[0]])
    link_holders[name] = holder
    link_points[name] = (upper, lower, (lower-upper).length)

bpy.context.view_layer.update()
normals = [rotation @ (source.matrix_world.to_3x3() @ normal.vector) for normal in mesh.corner_normals]
objects_by_group = {}
rest_errors = []
mesh_report = []
for name, face_ids in faces_by_group.items():
    if name.startswith('Wheel_'):
        owner = spinning[name.split('_')[1]]
    elif name.startswith('Axle_'):
        owner = axles['F' if 'Front' in name else 'R']
    elif name.startswith('Suspension_'):
        owner = link_holders[name.split('_')[1]]
    else:
        owner = chassis
    inverse = owner.matrix_world.inverted()
    local_normal = owner.matrix_world.to_3x3().transposed()
    mapping = {}
    new_vertices, faces, source_loops = [], [], []
    for face_id in face_ids:
        face = mesh.polygons[face_id]
        face_new = []
        for v in face.vertices:
            if v not in mapping:
                mapping[v] = len(new_vertices)
                new_vertices.append(inverse @ canonical_vertices[v])
            face_new.append(mapping[v])
        faces.append(face_new)
        source_loops.extend(face.loop_indices)
    data = bpy.data.meshes.new(name)
    data.from_pydata(new_vertices, [], faces)
    data.materials.clear()
    for material in mesh.materials:
        data.materials.append(material)
    uv = data.uv_layers.new(name='UVMap')
    for i, source_loop in enumerate(source_loops):
        uv.data[i].uv = mesh.uv_layers.active.data[source_loop].uv
    for i, face_id in enumerate(face_ids):
        data.polygons[i].use_smooth = mesh.polygons[face_id].use_smooth
        data.polygons[i].material_index = mesh.polygons[face_id].material_index
    data.normals_split_custom_set([local_normal @ normals[i] for i in source_loops])
    obj = bpy.data.objects.new(name, data)
    collection.objects.link(obj)
    obj.parent = owner
    objects_by_group[name] = obj
    for source_id, target_id in mapping.items():
        world = owner.matrix_world @ data.vertices[target_id].co
        rest_errors.append((world-canonical_vertices[source_id]).length)
    mesh_report.append({'name': name, 'triangles': len(faces), 'vertices': len(new_vertices), 'source_components': groups[name]})

assert sum(p['triangles'] for p in mesh_report) == 7516
assert max(rest_errors) < 1e-5
assert all(f'Wheel_{name}_{part}' in objects_by_group for name in ['FL', 'FR', 'RL', 'RR'] for part in ['Hub', 'Tire'])
bpy.data.objects.remove(source, do_unlink=True)

scene = bpy.context.scene
scene.name = 'Rig_Preview'
scene.frame_start, scene.frame_end = 1, 73
scene.render.fps = 24
front_rest, rear_rest = axles['F'].location.copy(), axles['R'].location.copy()
for frame in range(scene.frame_start, scene.frame_end+1):
    phase = (frame-1)/(scene.frame_end-scene.frame_start)*math.tau
    for prefix, rest, amplitude in [('F', front_rest, 0.14), ('R', rear_rest, -0.11)]:
        axle = axles[prefix]
        axle.location = rest + Vector((0, 0, 0.025 * math.sin(2*phase)))
        axle.rotation_euler = (0, amplitude*math.sin(phase), 0)
        axle.keyframe_insert('location', frame=frame)
        axle.keyframe_insert('rotation_euler', frame=frame)
    for name in steering:
        steering[name].rotation_euler.z = math.radians(20)*math.sin(phase) if name[0]=='F' else 0
        spinning[name].rotation_euler.x = -phase
        steering[name].keyframe_insert('rotation_euler', frame=frame)
        spinning[name].keyframe_insert('rotation_euler', frame=frame)
    bpy.context.view_layer.update()
    for name, holder in link_holders.items():
        upper, lower, length = link_points[name]
        lower_now = axles[name[0]].matrix_world @ (lower-axle_origins[name[0]])
        holder.rotation_quaternion = (lower_now-upper).to_track_quat('Z', 'Y')
        holder.scale = (1, 1, (lower_now-upper).length/length)
        holder.keyframe_insert('rotation_quaternion', frame=frame)
        holder.keyframe_insert('scale', frame=frame)

scene.frame_set(1)
bpy.ops.object.select_all(action='DESELECT')
for obj in collection.objects:
    obj.select_set(True)
bpy.context.view_layer.objects.active = root
bpy.ops.export_scene.gltf(
    filepath=str(OUT/'brown-beast-rigged.glb'),
    export_format='GLB', use_selection=True, export_extras=True,
    export_animations=True, export_animation_mode='SCENE', export_frame_range=True,
    export_anim_scene_split_object=False,
    export_anim_slide_to_zero=True,
    export_nla_strips_merged_animation_name='Rig_Preview', export_yup=True,
)

metadata = {
    'schemaVersion': 1,
    'assetId': 'brown-beast',
    'sourceFile': 'source.glb',
    'sourceSha256': SOURCE_HASH,
    'riggedFile': 'brown-beast-rigged.glb',
    'coordinateSystem': {'up': '+Y', 'forward': '-Z', 'right': '+X', 'origin': 'ground plane, midway between axles', 'units': 'meters; source scale retained, real truck dimensions unverified'},
    'sourceDimensions': {'width':2.384615421295166, 'height':2.4384000301361084, 'length':4.589929580688477},
    'sourceTriangles': 7516,
    'sourceVertices': 7926,
    'sourceLooseComponents': 187,
    'sourceMaterials': 1,
    'sourceTextures': [{'width':int(im.size[0]),'height':int(im.size[1])} for im in bpy.data.images if im.size[0]],
    'sourceAnimations': 0,
    'sourceSkins': 0,
    'previewClip': 'Rig_Preview',
    'extractedMeshes': mesh_report,
    'restPoseMaximumVertexErrorMeters': max(rest_errors),
    'sourceNormalizationBlender': {'rotateZRadians':math.pi, 'translate':[0,mid_y,-ground_z]},
    'axles': [], 'wheels': [], 'suspensionLinks': [],
    'limitations': [
        'Kinematic rig preview, not a physics simulation or calibrated vehicle.',
        'Axle and suspension assignments inferred from source geometry; not verified mechanical construction.',
        'Suspension links use endpoint-driven rotation and uniform axial scale for this preview. Production needs proper telescoping or deforming linkage visuals.',
        'Irregular AI-generated tires and hubs retain original shape and may wobble; production tire geometry may need replacement.',
        'Suspension travel, steering clearance, collision proxies, masses, spring rates, tire parameters and drivetrain data still need validation/implementation.',
        'Asset usage rights come from the original download; no license was embedded in the GLB metadata.',
    ],
}
for prefix in ['F', 'R']:
    metadata['axles'].append({'node':axles[prefix].name,'restPosition':gltf(axle_origins[prefix]),'topology':'solid_visual_axle','wheels':[prefix+'L',prefix+'R']})
for name, center in sorted(wheel_centers.items()):
    tire_ids = [v for c in groups[f'Wheel_{name}_Tire'] for v in components[c]]
    pts = np.array([vertices[v] for v in tire_ids])
    radial = np.linalg.norm(pts[:,1:3]-center[1:3],axis=1)
    metadata['wheels'].append({'id':name,'mountNode':wheel_mounts[name].name,'steerNode':steering[name].name,'spinNode':spinning[name].name,'tireNode':f'Wheel_{name}_Tire','hubNode':f'Wheel_{name}_Hub','restCenter':gltf(canonical(center)),'visualRadiusMax':float(radial.max()),'visualRadiusMedian':float(np.median(radial)),'width':float(pts[:,0].max()-pts[:,0].min()),'steerAxis':[0,1,0],'forwardSpinAxis':[-1,0,0]})
for name, (upper, lower, length) in sorted(link_points.items()):
    metadata['suspensionLinks'].append({'id':name,'node':link_holders[name].name,'upperMountNode':f'Suspension_{name}_UpperMount','lowerMountNode':f'Suspension_{name}_LowerMount','upperRestPosition':gltf(upper),'lowerRestPosition':gltf(lower),'restLength':length,'localStretchAxis':'+Y after glTF export of local Blender +Z'})
(OUT/'rig.json').write_text(json.dumps(metadata,indent=2)+'\n')

# Studio is outside the exported rig collection.
scene.render.engine='CYCLES'
scene.cycles.device='CPU'
scene.cycles.samples=16
scene.cycles.use_denoising=True
scene.render.resolution_x=960
scene.render.resolution_y=720
scene.render.resolution_percentage=100
scene.world=bpy.data.worlds.new('Preview Studio')
scene.world.use_nodes=True
scene.world.node_tree.nodes['Background'].inputs[0].default_value=(0.08,0.10,0.14,1)
scene.world.node_tree.nodes['Background'].inputs[1].default_value=0.6
scene.view_settings.view_transform='AgX'
def aim(obj, point):
    obj.rotation_euler=(Vector(point)-obj.location).to_track_quat('-Z','Y').to_euler()
for name,position,energy,size in [('Key',(4,5,8),1500,5),('Fill',(-5,2,5),1000,4),('Rim',(2,-5,6),1700,4)]:
    data=bpy.data.lights.new(name,'AREA'); data.energy=energy; data.shape='DISK'; data.size=size
    light=bpy.data.objects.new(name,data);scene.collection.objects.link(light);light.location=position;aim(light,(0,0,1))
data=bpy.data.cameras.new('RigPreviewCamera')
camera=bpy.data.objects.new('RigPreviewCamera',data)
scene.collection.objects.link(camera);scene.camera=camera
data.type='ORTHO';data.ortho_scale=6.4
camera.location=(6,7,4.5);aim(camera,(0,0,1.1))
scene.frame_set(1)
scene.render.filepath=str(OUT/'preview-rest.png');bpy.ops.render.render(write_still=True)
scene.frame_set(19)
camera.location=(6,7,2.4);aim(camera,(0,0,0.95))
scene.render.filepath=str(OUT/'preview-articulation.png');bpy.ops.render.render(write_still=True)

# Exploded view checks tread/hub grouping and extracted source suspension pieces.
scene.frame_set(1)
rest_mounts={name:obj.location.copy() for name,obj in wheel_mounts.items()}
for name,mount in wheel_mounts.items():
    mount.location.x += -0.60 if name.endswith('L') else 0.60
objects_by_group['Chassis_Visual'].location.z=0.75
camera.location=(7,8,5.6);aim(camera,(0,0,1.35))
data.ortho_scale=7.5
scene.render.filepath=str(OUT/'preview-exploded.png');bpy.ops.render.render(write_still=True)
objects_by_group['Chassis_Visual'].location.z=0
for name,mount in wheel_mounts.items():
    mount.location=rest_mounts[name]

scene.frame_set(1)
camera.location=(6,7,2.5);aim(camera,(0,0,0.95));data.ortho_scale=6.4
bpy.ops.wm.save_as_mainfile(filepath=str(OUT/'brown-beast-rigged.blend'))
frames=Path('/tmp/crawler-truck-rig-frames');frames.mkdir(exist_ok=True)
scene.render.resolution_x=800;scene.render.resolution_y=600;scene.cycles.samples=10
for frame in ([] if '--skip-animation' in sys.argv else range(1,73)):
    scene.frame_set(frame)
    scene.render.filepath=str(frames/f'{frame:04d}.png')
    bpy.ops.render.render(write_still=True)
print(json.dumps({'result':'complete','meshes':len(mesh_report),'triangles':7516,'maxRestError':max(rest_errors),'output':str(OUT)}))
sys.stdout.flush()
# The local Blender build can hang in PulseAudio teardown in a sandbox.
# All explicit file writes and renders have completed synchronously above.
os._exit(0)
