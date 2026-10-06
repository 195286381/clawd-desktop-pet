"""Claude 卡通人偶 —— 在 Blender 中运行:
    blender -b -P claude_figure.py
生成 claude_figure.blend 和 claude_figure.png
"""
import bpy, math, os
from mathutils import Vector

OUT = os.path.dirname(os.path.abspath(__file__))

# ---------- 清空场景 ----------
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene


def srgb(h):
    """#RRGGBB -> 线性 RGBA"""
    h = h.lstrip('#')
    c = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    lin = [x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c]
    return (*lin, 1.0)


def mat(name, hexcol, rough=0.45, sss=0.0, emit=0.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = srgb(hexcol)
    b.inputs["Roughness"].default_value = rough
    if sss:
        b.inputs["Subsurface Weight"].default_value = sss
        b.inputs["Subsurface Radius"].default_value = (0.3, 0.12, 0.08)
        b.inputs["Subsurface Scale"].default_value = 0.1
    if emit:
        b.inputs["Emission Color"].default_value = srgb(hexcol)
        b.inputs["Emission Strength"].default_value = emit
    return m


M_ORANGE = mat("ClaudeOrange", "#D97757", 0.4, sss=0.15)
M_DARK_OR = mat("ClaudeOrangeDark", "#C15F3C", 0.45)
M_CREAM = mat("Cream", "#F4E9DA", 0.5)
M_EYE = mat("Eye", "#1F1A17", 0.15)
M_SHINE = mat("Shine", "#FFFFFF", 0.1, emit=1.5)
M_BLUSH = mat("Blush", "#F08A7A", 0.6)
M_GROUND = mat("Ground", "#F0EEE6", 0.8)


def sphere(name, loc, scale, material, rot=(0, 0, 0), seg=48):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=seg, ring_count=seg // 2,
                                         radius=1, location=loc)
    o = bpy.context.object
    o.name = name
    o.scale = scale
    o.rotation_euler = [math.radians(a) for a in rot]
    bpy.ops.object.shade_smooth()
    o.data.materials.append(material)
    return o


parts = []

# ---------- 身体 ----------
parts.append(sphere("Body", (0, 0, 1.0), (0.72, 0.62, 0.8), M_ORANGE))

# 肚子上的 Claude 星芒标志
for i in range(8):
    a = i * 45 + 10
    r = 0.11
    x = r * math.sin(math.radians(a))
    z = 1.0 + r * math.cos(math.radians(a))
    parts.append(sphere(f"BellyRay{i}", (x, -0.615, z), (0.035, 0.02, 0.11),
                        M_CREAM, rot=(0, a, 0), seg=24))

# ---------- 头 ----------
HEAD = Vector((0, 0, 2.15))
parts.append(sphere("Head", HEAD, (0.75, 0.72, 0.72), M_ORANGE))

# 头周围的星芒(Claude logo 风格的放射状光芒)
N_RAYS = 9  # 只铺在头的上半圈,避免挡住肩膀和手臂
for i in range(N_RAYS):
    a = -108 + i * 216 / (N_RAYS - 1)
    length = 0.42 if i % 2 == 0 else 0.34  # 长短交错更有节奏
    dist = 0.72 + length * 0.75
    x = dist * math.sin(math.radians(a))
    z = HEAD.z + dist * math.cos(math.radians(a))
    parts.append(sphere(f"Ray{i}", (x, 0.12, z), (0.15, 0.13, length),
                        M_ORANGE if i % 2 == 0 else M_DARK_OR,
                        rot=(0, a, 0), seg=32))

# ---------- 脸 ----------
for s in (-1, 1):
    # 眼睛
    parts.append(sphere(f"Eye{s}", (0.24 * s, -0.66, 2.22), (0.085, 0.05, 0.13),
                        M_EYE, rot=(0, 0, -18 * s)))
    # 高光
    parts.append(sphere(f"Shine{s}", (0.24 * s + 0.03, -0.71, 2.27),
                        (0.032, 0.02, 0.032), M_SHINE, seg=16))
    parts.append(sphere(f"Shine2{s}", (0.24 * s - 0.025, -0.705, 2.16),
                        (0.016, 0.012, 0.016), M_SHINE, seg=12))
    # 腮红
    parts.append(sphere(f"Blush{s}", (0.43 * s, -0.56, 2.02), (0.11, 0.03, 0.065),
                        M_BLUSH, rot=(0, 0, -35 * s), seg=24))

# 微笑(带倒角的曲线)
curve = bpy.data.curves.new("Smile", 'CURVE')
curve.dimensions = '3D'
curve.bevel_depth = 0.022
curve.bevel_resolution = 6
sp = curve.splines.new('BEZIER')
sp.bezier_points.add(1)
p0, p1 = sp.bezier_points
p0.co = (-0.12, -0.705, 2.03)
p0.handle_left = (-0.14, -0.70, 2.05)
p0.handle_right = (-0.07, -0.73, 1.95)
p1.co = (0.12, -0.705, 2.03)
p1.handle_left = (0.07, -0.73, 1.95)
p1.handle_right = (0.14, -0.70, 2.05)
smile = bpy.data.objects.new("Smile", curve)
smile.data.materials.append(M_EYE)
scene.collection.objects.link(smile)

# ---------- 手臂 ----------
for s in (-1, 1):
    # 右手(s=1)举起打招呼
    if s == 1:
        parts.append(sphere("ArmR", (0.92, -0.15, 1.42), (0.14, 0.14, 0.42),
                            M_ORANGE, rot=(0, 48, 0)))
        parts.append(sphere("HandR", (1.25, -0.15, 1.74), (0.17, 0.15, 0.17), M_ORANGE))
    else:
        parts.append(sphere("ArmL", (-0.78, -0.12, 0.98), (0.14, 0.14, 0.38),
                            M_ORANGE, rot=(0, 28, 0)))
        parts.append(sphere("HandL", (-0.97, -0.12, 0.64), (0.17, 0.15, 0.17), M_ORANGE))

# ---------- 腿和脚 ----------
for s in (-1, 1):
    parts.append(sphere(f"Leg{s}", (0.3 * s, 0, 0.32), (0.17, 0.17, 0.3), M_ORANGE))
    parts.append(sphere(f"Foot{s}", (0.32 * s, -0.1, 0.09), (0.22, 0.3, 0.1), M_DARK_OR))

# ---------- 地面 ----------
bpy.ops.mesh.primitive_plane_add(size=60, location=(0, 0, 0))
ground = bpy.context.object
ground.data.materials.append(M_GROUND)

# ---------- 灯光 ----------
def light(name, kind, loc, energy, size=1.0, color=(1, 1, 1)):
    ld = bpy.data.lights.new(name, kind)
    ld.energy = energy
    ld.color = color
    if kind == 'AREA':
        ld.size = size
    o = bpy.data.objects.new(name, ld)
    o.location = loc
    scene.collection.objects.link(o)
    tc = o.constraints.new('TRACK_TO')
    tc.target = target
    return o


target = bpy.data.objects.new("Target", None)
target.location = (0.1, 0, 1.45)
scene.collection.objects.link(target)

light("Key", 'AREA', (-4, -5, 6), 550, 4, (1.0, 0.96, 0.9))
light("Fill", 'AREA', (5, -4, 3), 180, 5, (0.9, 0.95, 1.0))
light("Rim", 'AREA', (2, 5, 5), 500, 3)

world = bpy.data.worlds.new("World")
world.use_nodes = True
world.node_tree.nodes["Background"].inputs[0].default_value = srgb("#F0EEE6")
world.node_tree.nodes["Background"].inputs[1].default_value = 0.7
scene.world = world

# ---------- 相机 ----------
cam_data = bpy.data.cameras.new("Camera")
cam_data.lens = 55
cam = bpy.data.objects.new("Camera", cam_data)
cam.location = (1.6, -7.2, 2.4)
scene.collection.objects.link(cam)
cam.constraints.new('TRACK_TO').target = target
scene.camera = cam

# ---------- 渲染设置 ----------
for eng in ('BLENDER_EEVEE', 'BLENDER_EEVEE_NEXT', 'CYCLES'):
    try:
        scene.render.engine = eng
        break
    except TypeError:
        continue
if scene.render.engine == 'CYCLES':
    scene.cycles.samples = 128
else:
    scene.eevee.taa_render_samples = 64
    for attr in ('use_raytracing', 'use_gtao', 'use_shadows'):
        if hasattr(scene.eevee, attr):
            setattr(scene.eevee, attr, True)

scene.render.resolution_x = 1200
scene.render.resolution_y = 1200
scene.view_settings.view_transform = 'Standard'
scene.render.filepath = os.path.join(OUT, "claude_figure.png")

bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT, "claude_figure.blend"))
bpy.ops.render.render(write_still=True)
print("DONE ->", scene.render.filepath, scene.render.engine)
