"""Validate the exported rig, including rest-pose positions, UVs and normals."""
from collections import defaultdict
import hashlib
import itertools
import json
import math
from pathlib import Path
import struct

ROOT = Path(__file__).resolve().parents[1]
ASSET = ROOT / 'assets/vehicles/brown-beast'


def read_glb(path):
    raw = path.read_bytes()
    magic, version, length = struct.unpack_from('<4sII', raw)
    assert magic == b'glTF' and version == 2 and length == len(raw)
    chunks = {}
    offset = 12
    while offset < len(raw):
        size, kind = struct.unpack_from('<II', raw, offset)
        chunks[kind] = raw[offset+8:offset+8+size]
        offset += 8+size
    assert offset == len(raw)
    return json.loads(chunks[0x4e4f534a]), chunks[0x004e4942]


def accessor(document, binary, index):
    a = document['accessors'][index]
    view = document['bufferViews'][a['bufferView']]
    size = {'SCALAR':1, 'VEC2':2, 'VEC3':3, 'VEC4':4}[a['type']]
    code = {5121:'B', 5123:'H', 5125:'I', 5126:'f'}[a['componentType']]
    fmt = '<'+code*size
    stride = view.get('byteStride', struct.calcsize(fmt))
    start = view.get('byteOffset',0)+a.get('byteOffset',0)
    return [struct.unpack_from(fmt,binary,start+i*stride) for i in range(a['count'])]


def multiply(a,b):
    return [[sum(a[r][k]*b[k][c] for k in range(4)) for c in range(4)] for r in range(4)]


def local_matrix(node):
    if 'matrix' in node:
        return [[node['matrix'][c*4+r] for c in range(4)] for r in range(4)]
    x,y,z,w = node.get('rotation',[0,0,0,1])
    rotation = [[1-2*(y*y+z*z),2*(x*y-z*w),2*(x*z+y*w)],
                [2*(x*y+z*w),1-2*(x*x+z*z),2*(y*z-x*w)],
                [2*(x*z-y*w),2*(y*z+x*w),1-2*(x*x+y*y)]]
    scale = node.get('scale',[1,1,1])
    translation = node.get('translation',[0,0,0])
    return [[rotation[r][c]*scale[c] for c in range(3)]+[translation[r]] for r in range(3)]+[[0,0,0,1]]


def transform(matrix,point,direction=False):
    vector = list(point)+[0 if direction else 1]
    return tuple(sum(matrix[r][c]*vector[c] for c in range(4)) for r in range(3))


def normalized(v):
    length = math.sqrt(sum(x*x for x in v))
    return tuple(x/length for x in v)


def validate():
    source, source_bin = read_glb(ASSET/'source.glb')
    rig, rig_bin = read_glb(ASSET/'brown-beast-rigged.glb')
    metadata = json.loads((ASSET/'rig.json').read_text())
    assert hashlib.sha256((ASSET/'source.glb').read_bytes()).hexdigest() == metadata['sourceSha256']
    assert len(rig['meshes']) == 15 and len(rig['materials']) == 1 and len(rig['images']) == 3
    assert len(rig['animations']) == 1 and rig['animations'][0]['name'] == 'Rig_Preview'
    parents = {}
    for i,node in enumerate(rig['nodes']):
        for child in node.get('children',[]):
            assert child not in parents
            parents[child] = i
    def world(index,trail=()):
        assert index not in trail
        local = local_matrix(rig['nodes'][index])
        return multiply(world(parents[index],trail+(index,)),local) if index in parents else local
    named = {node['name']:i for i,node in enumerate(rig['nodes'])}
    for wheel in metadata['wheels']:
        for key in ['mountNode','steerNode','spinNode','tireNode','hubNode']:
            assert wheel[key] in named
        assert parents[named[wheel['tireNode']]] == named[wheel['spinNode']]
        assert parents[named[wheel['hubNode']]] == named[wheel['spinNode']]
        assert parents[named[wheel['spinNode']]] == named[wheel['steerNode']]
        point = transform(world(named[wheel['mountNode']]),(0,0,0))
        assert max(abs(a-b) for a,b in zip(point,wheel['restCenter'])) < 1e-5

    primitive = source['meshes'][0]['primitives'][0]
    attr = primitive['attributes']
    positions = accessor(source,source_bin,attr['POSITION'])
    normals = accessor(source,source_bin,attr['NORMAL'])
    uv = accessor(source,source_bin,attr['TEXCOORD_0'])
    shift = metadata['sourceNormalizationBlender']['translate']
    expected_pos = [(-x,y+shift[2],-z-shift[1]) for x,y,z in positions]
    expected_normals = [normalized((-x,y,-z)) for x,y,z in normals]
    tolerance = 1e-4
    def bucket(point):
        return tuple(math.floor(x/tolerance) for x in point)
    grid = defaultdict(list)
    for i,point in enumerate(expected_pos):
        grid[bucket(point)].append(i)
    tested_vertices,triangles,max_error,max_uv_error = 0,0,0,0
    for node_id,node in enumerate(rig['nodes']):
        if 'mesh' not in node:
            continue
        matrix = world(node_id)
        # Rest transforms have unit scale; direction transform is sufficient.
        assert all(abs(sum(matrix[r][c]**2 for r in range(3))-1)<1e-5 for c in range(3))
        for p in rig['meshes'][node['mesh']]['primitives']:
            assert p.get('mode',4) == 4
            indices = accessor(rig,rig_bin,p['indices'])
            assert len(indices)%3 == 0
            triangles += len(indices)//3
            attrs = p['attributes']
            pos = accessor(rig,rig_bin,attrs['POSITION'])
            nrm = accessor(rig,rig_bin,attrs['NORMAL'])
            tex = accessor(rig,rig_bin,attrs['TEXCOORD_0'])
            for point,normal,texcoord in zip(pos,nrm,tex):
                actual = transform(matrix,point)
                actual_normal = normalized(transform(matrix,normal,True))
                cell = bucket(actual)
                matches = []
                for delta in itertools.product([-1,0,1],repeat=3):
                    for i in grid.get(tuple(a+b for a,b in zip(cell,delta)),[]):
                        position_error = math.dist(actual,expected_pos[i])
                        uv_error = max(abs(a-b) for a,b in zip(texcoord,uv[i]))
                        normal_dot = sum(a*b for a,b in zip(actual_normal,expected_normals[i]))
                        if position_error<1e-5 and uv_error<1e-5 and normal_dot>0.9999:
                            matches.append((position_error,uv_error))
                assert matches, (node['name'],actual,texcoord,actual_normal)
                error,uv_error = min(matches)
                max_error = max(max_error,error)
                max_uv_error = max(max_uv_error,uv_error)
                tested_vertices += 1
    assert triangles == 7516
    animation = rig['animations'][0]
    targets = set()
    durations = []
    for channel in animation['channels']:
        key = (channel['target']['node'],channel['target']['path'])
        assert key not in targets
        targets.add(key)
        sampler = animation['samplers'][channel['sampler']]
        times = [v[0] for v in accessor(rig,rig_bin,sampler['input'])]
        values = accessor(rig,rig_bin,sampler['output'])
        assert len(times) == len(values)
        assert all(a<b for a,b in zip(times,times[1:]))
        assert all(math.isfinite(value) for row in values for value in row)
        assert times[0] == 0 and abs(times[-1]-3) < 1e-5
        durations.append(times[-1])
    for wheel in metadata['wheels']:
        assert (named[wheel['spinNode']],'rotation') in targets
    for name in ['Axle_Front','Axle_Rear']:
        assert (named[name],'rotation') in targets
    result = {'status':'passed','sourceTriangles':7516,'exportedTriangles':triangles,
              'exportedMeshes':len(rig['meshes']),'exportedNodes':len(rig['nodes']),
              'verticesCheckedWithPositionsUVsAndNormals':tested_vertices,
              'maximumExportedPositionErrorMeters':max_error,'maximumUVError':max_uv_error,
              'animationName':animation['name'],'animationChannels':len(targets),
              'animationDurationSeconds':max(durations),
              'scope':'Asset structure and rest-pose preservation; not physics or full travel collision validation.'}
    (ASSET/'validation.json').write_text(json.dumps(result,indent=2)+'\n')
    print(json.dumps(result,indent=2))


if __name__ == '__main__':
    validate()
