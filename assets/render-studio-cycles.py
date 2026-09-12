"""Render the shared character in Cycles, without modifying its source asset.

blender --background --python-exit-code 1 --python assets/render-studio-cycles.py -- --view all
Recipe colors/coefficients are scene-linear; positions use the web scene's Y-up.
"""
import argparse
import hashlib
import json
import math
from pathlib import Path
import sys
import time

import bpy
from mathutils import Vector

ROOT = Path(__file__).resolve().parent.parent
parser = argparse.ArgumentParser()
parser.add_argument('--view', default='three-quarter', choices=['all', 'front', 'three-quarter', 'side', 'squash'])
parser.add_argument('--samples', type=int)
parser.add_argument('--recipe', default=str(ROOT / 'assets/studio-cycles-recipe.json'))
args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else [])
recipe = json.loads(Path(args.recipe).read_text(encoding='utf-8'))
destination = ROOT.parents[1] / 'outputs/softie-cycles-study' / recipe['revision']
destination.mkdir(parents=True, exist_ok=True)
source = ROOT / 'assets/slime-studio.blend'
source_hash = hashlib.sha256(source.read_bytes()).hexdigest()
web_hash = hashlib.sha256((ROOT / 'public/models/slime-studio.glb').read_bytes()).hexdigest()
bpy.ops.wm.open_mainfile(filepath=str(source))
bpy.context.preferences.filepaths.save_version = 0

def coords(p):
    return Vector((p[0], -p[2], p[1]))

def point_at(obj, target):
    obj.rotation_euler = (coords(target) - obj.location).to_track_quat('-Z', 'Y').to_euler()

def principled(name, color, roughness):
    material = bpy.data.materials.new(name)
    material.use_nodes = True
    shader = material.node_tree.nodes.get('Principled BSDF')
    shader.inputs['Base Color'].default_value = (*color, 1)
    shader.inputs['Roughness'].default_value = roughness
    return material, shader

parts = [bpy.data.objects.get(name) for name in ['Gel', 'Eye.L', 'Eye.R', 'Smile']]
assert all(parts), 'Shared character meshes are missing'
for obj in parts:
    assert all(name in obj.data.shape_keys.key_blocks for name in ['Breathe', 'Squash', 'Puff'])
    for key in obj.data.shape_keys.key_blocks:
        key.value = 0
body = parts[0]
bubble_data = json.loads(body['bubble_data'])

gel, shader = principled('Cycles / clear rose gel', (1, 1, 1), recipe['surface']['roughness'])
shader.inputs['Transmission Weight'].default_value = 1
shader.inputs['IOR'].default_value = recipe['surface']['ior']
shader.inputs['Coat Weight'].default_value = 0
volume = gel.node_tree.nodes.new('ShaderNodeVolumeCoefficients')
if 'Weight' in volume.inputs:
    volume.inputs['Weight'].default_value = 1
volume.inputs['Absorption Coefficients'].default_value = recipe['volume']['absorption']
volume.inputs['Scatter Coefficients'].default_value = recipe['volume']['scattering']
volume.inputs['Anisotropy'].default_value = recipe['volume']['anisotropy']
volume.inputs['Emission Coefficients'].default_value = (0, 0, 0)
gel.node_tree.links.new(volume.outputs['Volume'], gel.node_tree.nodes['Material Output'].inputs['Volume'])
body.data.materials.clear()
body.data.materials.append(gel)
body.cycles.is_caustics_caster = True
eye, shader = principled('Cycles / black bean', recipe['eye']['color'], recipe['eye']['roughness'])
shader.inputs['Coat Weight'].default_value = recipe['eye']['coat']
shader.inputs['Coat Roughness'].default_value = .06
shader.inputs['Specular IOR Level'].default_value = recipe['eye']['specular']
ink, ink_shader = principled('Cycles / smile ink', (.0015, .001, .0015), .5)
ink_shader.inputs['Specular IOR Level'].default_value = .08
for obj in parts[1:]:
    obj.data.materials.clear()
    obj.data.materials.append(ink if obj.name == 'Smile' else eye)

air = bpy.data.materials.new('Cycles / air interface inside gel')
air.use_nodes = True
air.node_tree.nodes.clear()
air_glass = air.node_tree.nodes.new('ShaderNodeBsdfGlass')
air_glass.inputs['Color'].default_value = (1, 1, 1, 1)
air_glass.inputs['Roughness'].default_value = .015
air_glass.inputs['IOR'].default_value = 1 / recipe['surface']['ior']
air_output = air.node_tree.nodes.new('ShaderNodeOutputMaterial')
air.node_tree.links.new(air_glass.outputs[0], air_output.inputs['Surface'])
bpy.ops.mesh.primitive_uv_sphere_add(segments=24, ring_count=16, radius=1)
sphere = bpy.context.object
sphere.name = 'Bubble.000'
sphere.data.materials.clear()
sphere.data.materials.append(air)
for poly in sphere.data.polygons:
    poly.use_smooth = True
bubbles = []
for i, entry in enumerate(bubble_data):
    obj = sphere if i == 0 else bpy.data.objects.new(f'Bubble.{i:03d}', sphere.data)
    if i:
        bpy.context.collection.objects.link(obj)
    obj.location = coords(entry['p'])
    obj.scale = (entry['r'],) * 3
    bubbles.append(obj)

floor_mat, floor_shader = principled('Cycles / satin table', recipe['floor']['color'], recipe['floor']['roughness'])
segments = 128
profile = [(6, 0)] + [(6 + 4 * math.sin(math.pi * i / 48), 4 * (1 - math.cos(math.pi * i / 48))) for i in range(1, 25)] + [(10, 30)]
vertices = [coords((0, -.008, 0))]
for radius, height in profile:
    vertices.extend(coords((radius * math.cos(2 * math.pi * k / segments), height - .008,
                            radius * math.sin(2 * math.pi * k / segments))) for k in range(segments))
faces = [(0, 1 + (k + 1) % segments, 1 + k) for k in range(segments)]
for row in range(len(profile) - 1):
    for k in range(segments):
        following = (k + 1) % segments
        a, b = 1 + row * segments, 1 + (row + 1) * segments
        faces.append((a + k, a + following, b + following, b + k))
floor_mesh = bpy.data.meshes.new('Seamless 360 studio sweep')
floor_mesh.from_pydata(vertices, [], faces)
floor_mesh.update()
floor = bpy.data.objects.new('Table', floor_mesh)
bpy.context.collection.objects.link(floor)
for poly in floor_mesh.polygons:
    poly.use_smooth = True
floor.data.materials.append(floor_mat)
floor.cycles.is_caustics_receiver = True
for item in recipe['lights']:
    light = bpy.data.lights.new(item['name'], 'AREA')
    light.energy = item['energy']
    light.shape = 'RECTANGLE'
    light.size, light.size_y = item['size']
    light.color = (1, 1, 1)
    light.cycles.is_caustics_light = True
    obj = bpy.data.objects.new(item['name'], light)
    bpy.context.collection.objects.link(obj)
    obj.location = coords(item['position'])
    point_at(obj, (0, 1, 0))

scene = bpy.context.scene
world = bpy.data.worlds.new('Cycles / neutral studio')
world.use_nodes = True
world.node_tree.nodes['Background'].inputs['Color'].default_value = (*recipe['world']['color'], 1)
world.node_tree.nodes['Background'].inputs['Strength'].default_value = recipe['world']['strength']
scene.world = world
camera_data = bpy.data.cameras.new('Matched studio camera')
camera = bpy.data.objects.new('Matched studio camera', camera_data)
bpy.context.collection.objects.link(camera)
scene.camera = camera
camera_data.type = 'PERSP'
camera_data.sensor_fit = 'VERTICAL'
camera_data.sensor_height = 24
camera_data.lens = 24 / (2 * math.tan(math.radians(recipe['camera']['fovY']) / 2))
scene.render.resolution_x, scene.render.resolution_y = recipe['resolution']
scene.render.resolution_percentage = 100
scene.render.image_settings.file_format = 'PNG'
scene.render.image_settings.color_mode = 'RGB'
scene.render.image_settings.color_depth = '8'
scene.render.film_transparent = False
scene.view_settings.view_transform = 'Khronos PBR Neutral'
scene.view_settings.look = 'None'
scene.view_settings.exposure = 0
scene.view_settings.gamma = 1
scene.render.engine = 'CYCLES'
preferences = bpy.context.preferences.addons['cycles'].preferences
preferences.compute_device_type = 'OPTIX'
preferences.refresh_devices()
gpu_names = []
for device in preferences.devices:
    device.use = device.type == 'OPTIX'
    if device.use:
        gpu_names.append(device.name)
scene.cycles.device = 'GPU' if gpu_names else 'CPU'
scene.cycles.samples = args.samples or recipe['samples']
scene.cycles.seed = recipe['seed']
scene.cycles.use_denoising = True
scene.cycles.use_adaptive_sampling = True
scene.cycles.adaptive_threshold = .012
scene.cycles.adaptive_min_samples = 32
scene.cycles.max_bounces = 24
scene.cycles.transmission_bounces = 16
scene.cycles.glossy_bounces = 8
scene.cycles.volume_bounces = 2
scene.cycles.sample_clamp_direct = 0
scene.cycles.sample_clamp_indirect = 10
scene.render.use_persistent_data = True

aspect = recipe['resolution'][0] / recipe['resolution'][1]
distance = max(7.5, 2 / math.sin(math.atan(math.tan(math.radians(15)) * min(1, aspect)))) * recipe['camera']['framingScale']
manifest = {
    'engine': 'Cycles', 'backend': scene.cycles.device, 'devices': gpu_names,
    'sourceBlendSHA256': source_hash, 'sourceGLBSHA256': web_hash,
    'bodyVertices': len(body.data.vertices), 'bubbleCount': len(bubbles),
    'recipe': recipe, 'samples': scene.cycles.samples,
    'colorManagement': scene.view_settings.view_transform,
    'approximations': ['Air interfaces are spheres inside the gel volume; their tiny interiors do not subtract the body absorption volume.', 'Indirect sample clamp is 10 to bound rare fireflies.'],
    'views': [],
}
for view in recipe['views']:
    if args.view != 'all' and args.view != view['name']:
        continue
    for obj in parts:
        for key in obj.data.shape_keys.key_blocks:
            key.value = 1 if key.name == 'Squash' and view['pose'] == 'squash' else 0
    for obj, entry in zip(bubbles, bubble_data):
        obj.location = coords(entry['poses'][1] if view['pose'] == 'squash' else entry['p'])
    yaw, pitch = view['yaw'], recipe['camera']['pitch']
    position = [math.sin(yaw) * math.cos(pitch) * distance,
                recipe['camera']['targetY'] + math.sin(pitch) * distance,
                math.cos(yaw) * math.cos(pitch) * distance]
    camera.location = coords(position)
    point_at(camera, (0, recipe['camera']['targetY'], 0))
    bpy.context.view_layer.update()
    scene.render.filepath = str(destination / (view['name'] + '.png'))
    started = time.perf_counter()
    bpy.ops.render.render(write_still=True)
    manifest['views'].append({**view, 'positionYUp': position, 'distance': distance,
                              'renderSeconds': round(time.perf_counter() - started, 3)})
    print('CYCLES_VIEW_READY', view['name'], manifest['views'][-1], flush=True)

(destination / 'manifest.json').write_text(json.dumps(manifest, indent=2), encoding='utf-8')
bpy.ops.wm.save_as_mainfile(filepath=str(destination / 'studio.blend'))
print('CYCLES_STUDY_READY', str(destination), flush=True)
