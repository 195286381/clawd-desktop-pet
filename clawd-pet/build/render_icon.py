"""用 Blender 渲染 Clawd 应用图标(透明背景),比例与桌宠一致。
    blender -b -P build/render_icon.py
输出 build/clawd_render.png,再由 build/make_icon.py 合成为 macOS 图标。
"""
import bpy, math, os

OUT = os.path.dirname(os.path.abspath(__file__))
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene


def lin(h):
    h = h.lstrip('#')
    c = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return (*[x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c], 1)


def mat(name, col, rough):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = lin(col)
    b.inputs["Roughness"].default_value = rough
    return m


ORANGE = mat("Orange", "#D97757", 0.45)
DARK = mat("Eye", "#1B1714", 0.3)


def cube(name, center, size, m, bevel=0.04, rot_y=0.0):
    # Blender 坐标:x 右,y 向后(镜头在 -y),z 向上
    bpy.ops.mesh.primitive_cube_add(size=1, location=center)
    o = bpy.context.object
    o.name = name
    o.scale = size
    o.rotation_euler = (0, rot_y, 0)
    bpy.ops.object.transform_apply(scale=True)
    bv = o.modifiers.new("bevel", 'BEVEL')
    bv.width = bevel
    bv.segments = 4
    bpy.ops.object.shade_smooth()
    o.data.materials.append(m)
    return o


# 与 pet.js 相同的比例
U = 0.33
BW, BH, BD = 7.7 * U, 4.5 * U, 3.0 * U
LEG_L, LEG_W = 2.1 * U, U
EYE = 0.85 * U
EYE_X, EYE_Y = BW / 2 - 1.55 * U, BH * 0.58
ARM_Y, ARM_OUT, ARM_H = BH * 0.6, 1.0 * U, 1.9 * U
REST_X = [-BW / 2 + (e + 0.5) * U for e in (0, 1.91, 4.82, 6.73)]

z0 = LEG_L
cube("Body", (0, 0, z0 + BH / 2), (BW, BD, BH), ORANGE, 0.06)
for s in (-1, 1):
    cube(f"Eye{s}", (s * EYE_X, -BD / 2 - 0.004, z0 + EYE_Y), (EYE, 0.02, EYE), DARK, 0.008)
    # 右手举起打招呼
    if s == 1:
        cube("ArmR", (BW / 2 + 0.12, 0, z0 + ARM_Y + 0.22), (ARM_OUT + 0.3, BD * 0.62, ARM_H), ORANGE, 0.05, rot_y=-0.75)
    else:
        cube("ArmL", (-BW / 2 - ARM_OUT / 2 + 0.1, 0, z0 + ARM_Y), (ARM_OUT + 0.2, BD * 0.62, ARM_H), ORANGE, 0.05)
for i, x in enumerate(REST_X):
    cube(f"Leg{i}", (x, 0, LEG_L / 2 + 0.02), (LEG_W, LEG_W, LEG_L + 0.04), ORANGE, 0.03)

# 地面阴影在 make_icon.py 里画(柔和的椭圆),这里不渲染地面

# 灯光
def light(name, loc, energy, size, rot):
    ld = bpy.data.lights.new(name, 'AREA')
    ld.energy = energy
    ld.size = size
    o = bpy.data.objects.new(name, ld)
    o.location = loc
    o.rotation_euler = [math.radians(a) for a in rot]
    scene.collection.objects.link(o)

light("Key", (-3, -4, 6), 650, 4, (40, 0, -35))
light("Fill", (4, -3, 2), 120, 4, (70, 0, 50))
light("Rim", (2, 4, 4), 500, 3, (-50, 0, 160))
world = bpy.data.worlds.new("W")
world.use_nodes = True
world.node_tree.nodes["Background"].inputs[0].default_value = lin("#F4EFE6")
world.node_tree.nodes["Background"].inputs[1].default_value = 0.3
scene.world = world

# 相机:正交,略微侧过来俯视,和桌宠的视角一样
cam_d = bpy.data.cameras.new("Cam")
cam_d.type = 'ORTHO'
cam_d.ortho_scale = 4.4
cam = bpy.data.objects.new("Cam", cam_d)
yaw, pitch, dist = 0.34, 0.2, 20
target = (0, 0, 1.2)
cam.location = (target[0] + dist * math.sin(yaw) * math.cos(pitch),
                target[1] - dist * math.cos(yaw) * math.cos(pitch),
                target[2] + dist * math.sin(pitch))
scene.collection.objects.link(cam)
tgt = bpy.data.objects.new("Tgt", None)
tgt.location = target
scene.collection.objects.link(tgt)
cam.constraints.new('TRACK_TO').target = tgt
scene.camera = cam

scene.render.engine = 'CYCLES'
scene.cycles.samples = 96
scene.cycles.use_denoising = True
scene.render.film_transparent = True
scene.render.resolution_x = scene.render.resolution_y = 1024
scene.view_settings.view_transform = 'Standard'
scene.render.image_settings.color_mode = 'RGBA'
scene.render.filepath = os.path.join(OUT, "clawd_render.png")
bpy.ops.render.render(write_still=True)
print("DONE")
