"""把 Blender 渲染的 Clawd 合成到 macOS 风格的圆角方底上,输出 icon.png 和 icon.icns"""
import os, subprocess, shutil
from PIL import Image, ImageDraw, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
N = 1024
PLATE, RADIUS = 824, 185            # macOS 图标网格:824×824 圆角方块,四周留阴影空间
off = (N - PLATE) // 2

# 底板:米白色竖向渐变
grad = Image.new('RGBA', (PLATE, PLATE))
top, bot = (250, 246, 238), (234, 224, 208)
for y in range(PLATE):
    k = y / (PLATE - 1)
    c = tuple(round(top[i] + (bot[i] - top[i]) * k) for i in range(3)) + (255,)
    ImageDraw.Draw(grad).line([(0, y), (PLATE, y)], fill=c)
mask = Image.new('L', (PLATE, PLATE), 0)
ImageDraw.Draw(mask).rounded_rectangle([0, 0, PLATE - 1, PLATE - 1], RADIUS, fill=255)

icon = Image.new('RGBA', (N, N), (0, 0, 0, 0))
# 底板投影
shadow = Image.new('RGBA', (N, N), (0, 0, 0, 0))
ImageDraw.Draw(shadow).rounded_rectangle([off, off + 12, off + PLATE, off + PLATE + 12], RADIUS, fill=(0, 0, 0, 70))
icon.alpha_composite(shadow.filter(ImageFilter.GaussianBlur(18)))
plate = Image.new('RGBA', (PLATE, PLATE), (0, 0, 0, 0))
plate.paste(grad, (0, 0), mask)
icon.alpha_composite(plate, (off, off))

# Clawd:裁掉透明边,缩放后放在底板中间偏下
clawd = Image.open(os.path.join(HERE, 'clawd_render.png')).convert('RGBA')
clawd = clawd.crop(clawd.getbbox())
s = 640 / max(clawd.size)
clawd = clawd.resize((round(clawd.width * s), round(clawd.height * s)), Image.LANCZOS)
x = (N - clawd.width) // 2
y = (N - clawd.height) // 2 + 30
# 脚下柔和的椭圆阴影
sh = Image.new('RGBA', (N, N), (0, 0, 0, 0))
cx, fy = N // 2 + 10, y + clawd.height - 8
ImageDraw.Draw(sh).ellipse([cx - clawd.width * 0.42, fy - 26, cx + clawd.width * 0.42, fy + 26], fill=(90, 60, 40, 95))
icon.alpha_composite(sh.filter(ImageFilter.GaussianBlur(16)))
icon.alpha_composite(clawd, (x, y))
icon.save(os.path.join(HERE, 'icon.png'))

# 生成 .icns
iconset = os.path.join(HERE, 'icon.iconset')
shutil.rmtree(iconset, ignore_errors=True)
os.makedirs(iconset)
for size in (16, 32, 128, 256, 512):
    for scale in (1, 2):
        px = size * scale
        name = f'icon_{size}x{size}' + ('@2x' if scale == 2 else '') + '.png'
        icon.resize((px, px), Image.LANCZOS).save(os.path.join(iconset, name))
subprocess.run(['iconutil', '-c', 'icns', iconset, '-o', os.path.join(HERE, 'icon.icns')], check=True)
shutil.rmtree(iconset)
print('ok')
