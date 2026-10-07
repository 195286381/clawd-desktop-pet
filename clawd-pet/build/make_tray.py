# 生成菜单栏图标 trayTemplate.png(22×18)和 trayTemplate@2x.png(44×36)。
# 文件名带 Template:macOS 只看透明度,自动配合浅色 / 深色菜单栏着色。
# 图案按 1pt 一格画(@2x 每格 2×2 像素),和 Clawd 一样是方块像素风:
# 宽身子、两侧短手、四条腿(中间两条间距更大)、两只方眼睛。
from PIL import Image
import os

GLYPH = [
    "..################..",
    "..################..",
    "..################..",
    "..###..######..###..",
    "#####..######..#####",
    "####################",
    "####################",
    "..################..",
    "..################..",
    "..################..",
    "...##.##....##.##...",
    "...##.##....##.##...",
    "...##.##....##.##...",
    "...##.##....##.##...",
    "...##.##....##.##...",
]
W, H = 22, 18
here = os.path.dirname(os.path.abspath(__file__))
for scale, name in [(1, 'trayTemplate.png'), (2, 'trayTemplate@2x.png')]:
    im = Image.new('RGBA', (W * scale, H * scale), (0, 0, 0, 0))
    gw, gh = len(GLYPH[0]), len(GLYPH)
    ox = (W * scale - gw * scale) // 2
    oy = (H * scale - gh * scale + 1) // 2
    for y, row in enumerate(GLYPH):
        for x, c in enumerate(row):
            if c == '#':
                for dy in range(scale):
                    for dx in range(scale):
                        im.putpixel((ox + x * scale + dx, oy + y * scale + dy), (0, 0, 0, 255))
    im.save(os.path.join(here, '..', name))
    print('wrote', name, im.size)
