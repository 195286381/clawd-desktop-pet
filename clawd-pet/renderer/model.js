// Clawd 的 3D 模型:身体、眼睛、手、腿,像素表情,道具和节日装扮,汗珠
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { clock, scene } from './scene.js';

// ---------------- 模型(比例对照官方像素形象和 3D 打印的 Clawd) ----------------
// 方方正正、厚实的身体;细腿两两成对,每条从前到后是一片(像 3D 打印版);手是扁平长板;眼睛靠外侧
// 整体大小和上一版持平:宽约 2.5、总高(腿 + 身子)约 2.15 个世界单位
export const BW = 2.5;                                   // 身体宽
export const BH = BW * 0.6, BD = BW * 0.45;              // 高、厚
export const LEG_L = BH * 0.42, LEG_W = BW / 12, LEG_D = BD * 0.8;   // 腿比参考图长一些,走起来更灵动;前后厚度和手一样
export const EYE = 0.28;                                 // 眼睛大小、间距、高度都沿用上一版(眼神更灵动)
export const EYE_X = BW / 2 - 0.51, EYE_Y = BH * 0.58;
export const ARM_Y = BH * 0.52, ARM_OUT = BW * 0.13, ARM_H = BH * 0.3, ARM_TUCK = 0.35;
export const REST_X = [1.5, 3.5, 8.5, 10.5].map(c => -BW / 2 + c * LEG_W);   // 四条腿的 x:按终端字符画 12 格宽的身体,腿在第 2、4、9、11 格
export const GROUP = [0, 1, 0, 1];       // 交替迈步的两组脚

export const orange = new THREE.MeshPhysicalMaterial({ color: 0xD97757, roughness: 0.5, clearcoat: 0.2, clearcoatRoughness: 0.45 });
const dark = new THREE.MeshStandardMaterial({ color: 0x1B1714, roughness: 0.3 });

function box(parent, mat, pos, size, r = 0.04) {
  const m = new THREE.Mesh(new RoundedBoxGeometry(size[0], size[1], size[2], 3, r), mat);
  m.position.set(...pos);
  m.castShadow = true;
  parent.add(m);
  return m;
}

export const root = new THREE.Group();          // 脚底中心;在世界里移动
scene.add(root);
export const bodyG = new THREE.Group();         // 原点在身体底面中心:挤压/倾斜都以底面为轴
root.add(bodyG);
export const bodyMesh = box(bodyG, orange, [0, BH / 2, 0], [BW, BH, BD], 0.03);

export const eyes = [-1, 1].map(s => {
  const g = new THREE.Group();
  g.position.set(s * EYE_X, EYE_Y, BD / 2);
  bodyG.add(g);
  const m = box(g, dark, [0, 0, -0.006], [EYE, EYE, 0.02], 0.008);
  m.castShadow = false;
  return { g, m, s };
});

export const arms = [-1, 1].map(s => {
  const g = new THREE.Group();
  g.position.set(s * BW / 2, ARM_Y, 0);
  bodyG.add(g);
  box(g, orange, [s * (ARM_OUT - ARM_TUCK) / 2, 0, 0], [ARM_OUT + ARM_TUCK, ARM_H, BD * 0.8], 0.025);
  return { g, s };
});

const legGeo = new RoundedBoxGeometry(LEG_W, 1, LEG_D, 2, 0.02);
legGeo.translate(0, 0.5, 0);             // 底端在原点,沿 +y 伸长
export const legs = REST_X.map(() => {
  const m = new THREE.Mesh(legGeo, orange);
  m.castShadow = true;
  root.add(m);
  return m;
});

// ---------------- 表情 ----------------
// 像素风:每个表情用小方块拼出来。平时是方眼睛(会眨眼、累了眯眼);
// 开心 > <、高兴 ^ ^、晕了 x x、吃惊 o o、耍酷戴像素墨镜,
// 还有被摸时的爱心眼 + 腮红、被连戳的不耐烦、庆祝的星星眼、烧钱的 $ $、额度用完的哭哭、偶尔眨单眼。
const PX = EYE / 3.6;   // 5 格宽的表情约 1.4 个眼睛宽,眼睛转到最边也离身体边缘有空隙
const pxGeo = new THREE.BoxGeometry(PX, PX, 0.02);
const white = new THREE.MeshStandardMaterial({ color: 0xF4EFE6, roughness: 0.4 });
const flat = c => new THREE.MeshStandardMaterial({ color: c, roughness: 0.45 });
const FACE_MAT = { X: dark, W: white, R: flat(0xC8453F), G: flat(0xF2C14E), M: flat(0x4E8A5A), B: flat(0x8FD3FF) };
function pixels(parent, rows, size, geo, mats, z = 0) {
  const g = new THREE.Group();
  const w = rows[0].length, h = rows.length;
  rows.forEach((row, y) => [...row].forEach((c, x) => {
    if (c === '.') return;
    const m = new THREE.Mesh(geo, mats[c]);
    m.position.set((x - (w - 1) / 2) * size, ((h - 1) / 2 - y) * size, z);
    g.add(m);
  }));
  g.visible = false;
  parent.add(g);
  return g;
}
const mirror = rows => rows.map(r => [...r].reverse().join(''));
// 每个表情给左眼的像素图(右眼自动镜像);写成 { L, R } 时左右分开给,null 表示那只眼保持普通方眼
const FACES = {
  happy:     ['X..', '.X.', '..X', '.X.', 'X..'],            // 左眼 >,右眼镜像成 <
  joy:       ['..X..', '.X.X.', 'X...X'],
  dizzy:     ['X...X', '.X.X.', '..X..', '.X.X.', 'X...X'],
  surprised: ['.XXX.', 'X...X', 'X...X', 'X...X', '.XXX.'],
  love:      ['.R.R.', 'RRRRR', 'RRRRR', '.RRR.', '..R..'],
  star:      ['..G..', '..G..', 'GGGGG', '.GGG.', '.G.G.'],
  money:     ['.M.', 'MMM', 'M..', 'MMM', '..M', 'MMM', '.M.'],
  annoyed:   ['XXXX', '..XX'],
  cry:       ['XXX', '.X.', '.B.', '...', '.B.'],
  wink:      { L: null, R: ['XXX'] },
};
eyes.forEach(e => {
  e.faces = {};
  for (const [k, f] of Object.entries(FACES)) {
    const rows = Array.isArray(f) ? (e.s < 0 ? f : mirror(f)) : (e.s < 0 ? f.L : f.R);
    if (rows) e.faces[k] = pixels(e.g, rows, PX, pxGeo, FACE_MAT, -0.004);
  }
});
// 腮红:眼睛外下方两小块粉色
const blushMat = new THREE.MeshStandardMaterial({ color: 0xF2A08F, roughness: 0.6, transparent: true, opacity: 0.85 });
const blush = new THREE.Group();
[-1, 1].forEach(s => {
  const m = new THREE.Mesh(new THREE.BoxGeometry(EYE * 1.1, EYE * 0.4, 0.02), blushMat);
  m.position.set(s * (EYE_X + EYE * 0.35), EYE_Y - EYE * 1.25, BD / 2 + 0.008);
  blush.add(m);
});
blush.visible = false;
bodyG.add(blush);
// 像素墨镜:横跨两只眼睛,镜片中心对准眼睛
const SG_LENS = ['XXXXXX', 'XWXWXX', 'XXWXWX', '.XXXX.'];
const SG_GAP = 11, SG_Q = 2 * EYE_X / (SG_LENS[0].length + SG_GAP);
const sgRows = SG_LENS.map((r, i) => i === 0 ? 'X'.repeat(r.length * 2 + SG_GAP) : r + '.'.repeat(SG_GAP) + r);
const sunglasses = pixels(bodyG, sgRows, SG_Q, new THREE.BoxGeometry(SG_Q, SG_Q, 0.03), { X: dark, W: white });
sunglasses.position.set(0, EYE_Y + SG_Q * 0.4, BD / 2 + 0.01);
export let faceOverride = null, faceOverrideUntil = 0;
// 临时换个表情,secs 秒后恢复
export function flashFace(face, secs) { faceOverride = face; faceOverrideUntil = clock.elapsedTime + secs; }
export function setFace(face) {
  const glasses = face === 'cool';
  sunglasses.visible = glasses;
  blush.visible = face === 'love' || face === 'happy';
  eyes.forEach(e => {
    e.m.visible = !glasses && !e.faces[face];
    for (const [k, g] of Object.entries(e.faces)) g.visible = k === face;
  });
}

// ---------------- 道具 ----------------
// 同样的方块风格,看场景自动出现:睡觉戴睡帽、庆祝戴派对帽、跳舞可能戴耳机、
// 你在用 Claude Code 时摆台小电脑陪你写、早上捧杯咖啡。
const mat = c => new THREE.MeshStandardMaterial({ color: c, roughness: 0.55 });
const PM = { cream: mat(0xF4EFE6), indigo: mat(0x5E6C9E), ochre: mat(0xD4A24C), verte: mat(0x7FA383), gold: mat(0xF2C14E),
  grey: mat(0x55514C), steel: mat(0xB9B4AC), coffee: mat(0x5A3A26), orange };
export const PROPS = {};
function prop(name, parent) { const g = new THREE.Group(); g.visible = false; parent.add(g); PROPS[name] = g; return g; }
{ // 睡帽:一层层往一边耷拉的长尖帽 + 白帽檐 + 白绒球
  const g = prop('nightcap', bodyG);
  box(g, PM.cream, [0, BH + 0.08, 0], [BW * 0.36, 0.16, BW * 0.36], 0.05);
  // [宽, x, y]:先往上收尖,再往一侧弯下来,绒球垂在旁边
  [[0.6, 0, 0.24], [0.48, 0.04, 0.44], [0.37, 0.12, 0.62], [0.28, 0.27, 0.76], [0.21, 0.45, 0.8], [0.16, 0.62, 0.72]].forEach(([w, x, y]) =>
    box(g, PM.indigo, [x, BH + y, 0], [BW * w * 0.5, 0.2, BW * w * 0.5], 0.03));
  box(g, PM.cream, [0.75, BH + 0.55, 0], [0.26, 0.26, 0.26], 0.08);
}
{ // 派对帽:土黄 / 绿土相间的方块尖塔 + 金色顶球,歪戴
  const g = prop('party', bodyG);
  g.position.set(BW * 0.15, BH, 0); g.rotation.z = -0.2;
  [0.8, 0.62, 0.46, 0.32, 0.2].forEach((w, i) => box(g, i % 2 ? PM.verte : PM.ochre, [0, 0.09 + i * 0.17, 0], [w, 0.17, w], 0.02));
  box(g, PM.gold, [0, 0.98, 0], [0.2, 0.2, 0.2], 0.06);
}
{ // 耳机:头顶一道粗箍,两侧大耳罩(带橙色亮片),耳罩在手臂上方
  const g = prop('headphones', bodyG);
  box(g, PM.grey, [0, BH + 0.16, 0], [BW * 0.92, 0.1, 0.2], 0.03);
  [-1, 1].forEach(s => {
    box(g, PM.grey, [s * BW * 0.47, BH + 0.02, 0], [0.1, 0.3, 0.2], 0.03);
    box(g, PM.grey, [s * (BW / 2 + 0.08), BH * 0.8, 0], [0.18, 0.5, 0.5], 0.05);
    box(g, PM.orange, [s * (BW / 2 + 0.175), BH * 0.8, 0], [0.02, 0.26, 0.26], 0.01);
  });
}
{ // 小笔记本电脑:抱在身前打字,屏幕朝着 Clawd,背面朝你,背面有个橙色小方标
  const g = prop('laptop', bodyG);
  g.position.set(0, BH * 0.04, BD / 2 + 0.32);
  box(g, PM.steel, [0, 0.03, -0.05], [BW * 0.72, 0.06, 0.55], 0.02);
  const lid = new THREE.Group(); lid.position.set(0, 0.06, 0.22); lid.rotation.x = 0.12; g.add(lid);
  box(lid, PM.steel, [0, 0.3, 0], [BW * 0.72, 0.6, 0.05], 0.02);
  box(lid, PM.orange, [0, 0.32, 0.03], [0.16, 0.16, 0.01], 0.01);
}
{ // 咖啡杯:捧在胸前,冒两缕像素热气
  const g = prop('coffee', bodyG);
  g.position.set(BW * 0.3, BH * 0.12, BD / 2 + 0.2);
  box(g, PM.cream, [0, 0, 0], [0.34, 0.4, 0.34], 0.05);
  box(g, PM.coffee, [0, 0.195, 0], [0.27, 0.02, 0.27], 0.005);
  box(g, PM.cream, [0.21, 0.02, 0], [0.09, 0.2, 0.07], 0.025);
  [[-0.05, 0.29], [0.02, 0.36], [0.07, 0.29]].forEach(([x, y]) => box(g, PM.cream, [x, y, 0], [0.05, 0.05, 0.05], 0.01));
}
// 节日装扮:按日期自动出现,和上面的道具分开管理(戴别的帽子时,节日帽子先摘下)
export const HOLIDAY = {};
function holidayProp(name) { const g = new THREE.Group(); g.visible = false; bodyG.add(g); HOLIDAY[name] = g; return g; }
{ // 万圣节:宽檐尖顶巫师帽,紫黑色 + 一道南瓜橙帽带,尖儿往后折
  const g = holidayProp('witch'), W = mat(0x3E3550);
  box(g, W, [0, BH + 0.04, 0], [BW * 0.78, 0.07, BD * 1.0], 0.02);
  box(g, mat(0xE0A54A), [0, BH + 0.13, 0], [BW * 0.4, 0.1, BW * 0.4], 0.02);
  [[0.38, 0, 0.26], [0.3, 0.02, 0.44], [0.22, 0.06, 0.6], [0.15, 0.14, 0.74], [0.1, 0.26, 0.8]].forEach(([w, x, y]) =>
    box(g, W, [x, BH + y, 0], [BW * w, 0.2, BW * w], 0.02));
}
{ // 圣诞节:红色圣诞帽 + 白毛边 + 白绒球,往一侧耷拉
  const g = holidayProp('santa'), R = mat(0xC8453F);
  box(g, PM.cream, [0, BH + 0.08, 0], [BW * 0.5, 0.17, BW * 0.5], 0.05);
  [[0.42, 0.02, 0.27], [0.33, 0.1, 0.45], [0.25, 0.24, 0.58], [0.18, 0.42, 0.62], [0.13, 0.58, 0.55]].forEach(([w, x, y]) =>
    box(g, R, [x, BH + y, 0], [BW * w, 0.2, BW * w], 0.03));
  box(g, PM.cream, [0.72, BH + 0.42, 0], [0.24, 0.24, 0.24], 0.08);
}
{ // 春节:红围巾绕身体一圈,前面垂下一截,带金色条纹
  const g = holidayProp('scarf'), R = mat(0xC8453F), y = BH * 0.3, h = 0.24, t = 0.08;
  box(g, R, [0, y, BD / 2 + t / 2], [BW + t * 2, h, t], 0.02);
  box(g, R, [0, y, -BD / 2 - t / 2], [BW + t * 2, h, t], 0.02);
  [-1, 1].forEach(s => box(g, R, [s * (BW / 2 + t / 2), y, 0], [t, h, BD], 0.02));
  box(g, R, [BW * 0.28, y - 0.22, BD / 2 + t], [0.24, 0.4, t], 0.02);
  box(g, PM.gold, [BW * 0.28, y - 0.3, BD / 2 + t + 0.045], [0.24, 0.05, 0.01], 0.005);
  box(g, PM.gold, [0, y, BD / 2 + t + 0.005], [BW + t * 2, 0.04, 0.01], 0.005);
}
export const HAT_PROPS = ['nightcap', 'party', 'headphones'];
const LUNAR_NEW_YEAR = ['2027-02-06', '2028-01-26', '2029-02-13', '2030-02-03', '2031-01-23', '2032-02-11'];
export function holidayToday(d = new Date()) {
  const m = d.getMonth() + 1, day = d.getDate();
  if ((m === 10 && day >= 24) || (m === 11 && day === 1)) return 'witch';
  if (m === 12 && day >= 18 && day <= 26) return 'santa';
  for (const s of LUNAR_NEW_YEAR) { const diff = (d - new Date(s + 'T00:00:00')) / 864e5; if (diff >= -5 && diff < 10) return 'scarf'; }
  return null;
}

export function setProp(name) { for (const [k, g] of Object.entries(PROPS)) g.visible = k === name; }

// 汗珠:用量多的时候从额头侧边滑下来
export const sweatMat = new THREE.MeshStandardMaterial({ color: 0x8fd3ff, roughness: 0.1, transparent: true, opacity: 0 });
export const sweat = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 12), sweatMat);
sweat.scale.set(0.09, 0.13, 0.06);
bodyG.add(sweat);
