// Clawd 桌宠 —— 渲染进程
// 比例和动作参考 Anthropic 官方 Clawd 动画(@claudeai 发布的短片,以及 Codrops 上对它的逐帧拆解):
//   · 四条腿较长(约为身体高度的一半),外侧两条贴着身体边缘,中间留空;
//   · 眼睛是小方块;两侧短手臂大约和眼睛同高;
//   · 张望时身体前倾、抬高、微转,脚钉在地上不动,腿被拉长、整体斜过去;
//   · 起跳前快速下蹲、手往下压;落地手会往下"弹"一下再回来。
// 腿用"髋 → 脚"两点直接连成一根柱子:脚落地时就固定在地面上,身体怎么动腿都跟着拉伸、倾斜。
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import EN from './locales/en.json' with { type: 'json' };

// ---------------- 界面语言 ----------------
// 主进程按菜单设置通过 ?lang= 传进来。文案直接以中文原文为键:t('中文') 在英文界面下查 locales/en.json,
// 查不到就原样显示中文;{0} {1} 是占位符。
const LANG = new URLSearchParams(location.search).get('lang') === 'en' ? 'en' : 'zh';
const EN_UI = LANG === 'en';
const t = (s, ...a) => ((EN_UI && EN[s]) || s).replace(/\{(\d)\}/g, (_, i) => a[i]);
const tr = t;   // frame() 里的局部变量 t 是时间,会盖住 t(),那里用 tr 翻译
document.documentElement.lang = EN_UI ? 'en' : 'zh-CN';

// ---------------- 画布与相机 ----------------
// 大小:菜单里选,主进程通过 ?scale= 传进来;只缩放 3D 的 Clawd,气泡和血条的文字保持原大小
const SCALE = Math.min(2, Math.max(0.5, Number(new URLSearchParams(location.search).get('scale')) || 1));
const S = 40 * SCALE;              // 1 个世界单位 = 40 屏幕像素(乘以大小)
const CW = Math.round(340 * SCALE), CH = CW;   // 跟着 Clawd 走的小画布
const GROUND_PX = 70 * SCALE;      // Clawd 脚底在画布里离底边的距离
const YAW = 0.34, PITCH = 0.2;     // 略微侧着、俯视一点,露出侧面和顶面

const canvas = document.getElementById('c');
let looping = false, loopTimer = 0;   // 主循环状态,见「省电」
const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
renderer.setPixelRatio(window.devicePixelRatio);
renderer.setSize(CW, CH);
renderer.setClearColor(0x000000, 0);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.NeutralToneMapping;

const scene = new THREE.Scene();
scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.5;

const camera = new THREE.OrthographicCamera(-CW / 2 / S, CW / 2 / S, CH / 2 / S, -CH / 2 / S, 0.1, 100);
const CAM_DIR = new THREE.Vector3(Math.sin(YAW) * Math.cos(PITCH), Math.sin(PITCH), Math.cos(YAW) * Math.cos(PITCH));
const AIM_Y = ((CH - GROUND_PX) - CH / 2) / (S * Math.cos(PITCH)); // 让脚底落在画布的 GROUND_PX 处

const sun = new THREE.DirectionalLight(0xfff4e6, 2.4);
sun.castShadow = true;
sun.shadow.mapSize.set(1024, 1024);
Object.assign(sun.shadow.camera, { left: -4, right: 4, top: 4, bottom: -4, near: 0.1, far: 30 });
sun.shadow.radius = 4;
sun.shadow.bias = -0.0008;
scene.add(sun, sun.target);
scene.add(new THREE.HemisphereLight(0xfff8f0, 0xd9c8b4, 0.7));
const rim = new THREE.DirectionalLight(0xffffff, 0.9);
scene.add(rim, rim.target);

const shadowPlane = new THREE.Mesh(new THREE.PlaneGeometry(7, 4), new THREE.ShadowMaterial({ opacity: 0.18 }));
shadowPlane.rotation.x = -Math.PI / 2;
shadowPlane.receiveShadow = true;
scene.add(shadowPlane);

// ---------------- 模型(比例对照官方像素形象和 3D 打印的 Clawd) ----------------
// 方方正正、厚实的身体;短粗的方块腿(中间两条间距更大);手是扁平长板;眼睛靠外侧
// 整体大小和上一版持平:宽约 2.5、总高(腿 + 身子)约 2.15 个世界单位
const BW = 2.5;                                   // 身体宽
const BH = BW * 0.6, BD = BW * 0.45;              // 高、厚
const LEG_L = BH * 0.42, LEG_W = BW * 0.15;       // 腿比参考图长一些,走起来更灵动
const EYE = 0.28;                                 // 眼睛大小、间距、高度都沿用上一版(眼神更灵动)
const EYE_X = BW / 2 - 0.51, EYE_Y = BH * 0.58;
const ARM_Y = BH * 0.52, ARM_OUT = BW * 0.13, ARM_H = BH * 0.3, ARM_TUCK = 0.35;
const REST_X = [0.085, 0.33, 0.67, 0.915].map(f => -BW / 2 + f * BW);   // 四条腿的 x
const GROUP = [0, 1, 0, 1];       // 交替迈步的两组脚

const orange = new THREE.MeshPhysicalMaterial({ color: 0xD97757, roughness: 0.5, clearcoat: 0.2, clearcoatRoughness: 0.45 });
const dark = new THREE.MeshStandardMaterial({ color: 0x1B1714, roughness: 0.3 });

function box(parent, mat, pos, size, r = 0.04) {
  const m = new THREE.Mesh(new RoundedBoxGeometry(size[0], size[1], size[2], 3, r), mat);
  m.position.set(...pos);
  m.castShadow = true;
  parent.add(m);
  return m;
}

const root = new THREE.Group();          // 脚底中心;在世界里移动
scene.add(root);
const bodyG = new THREE.Group();         // 原点在身体底面中心:挤压/倾斜都以底面为轴
root.add(bodyG);
const bodyMesh = box(bodyG, orange, [0, BH / 2, 0], [BW, BH, BD], 0.03);

const eyes = [-1, 1].map(s => {
  const g = new THREE.Group();
  g.position.set(s * EYE_X, EYE_Y, BD / 2);
  bodyG.add(g);
  const m = box(g, dark, [0, 0, -0.006], [EYE, EYE, 0.02], 0.008);
  m.castShadow = false;
  return { g, m, s };
});

const arms = [-1, 1].map(s => {
  const g = new THREE.Group();
  g.position.set(s * BW / 2, ARM_Y, 0);
  bodyG.add(g);
  box(g, orange, [s * (ARM_OUT - ARM_TUCK) / 2, 0, 0], [ARM_OUT + ARM_TUCK, ARM_H, BD * 0.8], 0.025);
  return { g, s };
});

const legGeo = new RoundedBoxGeometry(LEG_W, 1, LEG_W, 2, 0.02);
legGeo.translate(0, 0.5, 0);             // 底端在原点,沿 +y 伸长
const legs = REST_X.map(() => {
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
let faceOverride = null, faceOverrideUntil = 0, dizzyUntil = 0;
// 临时换个表情,secs 秒后恢复
function flashFace(face, secs) { faceOverride = face; faceOverrideUntil = clock.elapsedTime + secs; }
function setFace(face) {
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
const PROPS = {};
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
const HOLIDAY = {};
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
const HAT_PROPS = ['nightcap', 'party', 'headphones'];
const LUNAR_NEW_YEAR = ['2027-02-06', '2028-01-26', '2029-02-13', '2030-02-03', '2031-01-23', '2032-02-11'];
function holidayToday(d = new Date()) {
  const m = d.getMonth() + 1, day = d.getDate();
  if ((m === 10 && day >= 24) || (m === 11 && day === 1)) return 'witch';
  if (m === 12 && day >= 18 && day <= 26) return 'santa';
  for (const s of LUNAR_NEW_YEAR) { const diff = (d - new Date(s + 'T00:00:00')) / 864e5; if (diff >= -5 && diff < 10) return 'scarf'; }
  return null;
}
let holidayOn = true, holidayForce = null, curHoliday = null;

let curProp = null, propOverride = null, propOverrideUntil = 0;
let hpMode = 'always', hpHoverUntil = 0;   // 血条显示方式:always / hover / off(主进程按菜单设置发过来)
function setProp(name) { for (const [k, g] of Object.entries(PROPS)) g.visible = k === name; }

// 汗珠:用量多的时候从额头侧边滑下来
const sweatMat = new THREE.MeshStandardMaterial({ color: 0x8fd3ff, roughness: 0.1, transparent: true, opacity: 0 });
const sweat = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 12), sweatMat);
sweat.scale.set(0.09, 0.13, 0.06);
bodyG.add(sweat);

// ---------------- 弹簧 ----------------
class Spring {
  constructor(x, freq, zeta) { this.x = x; this.v = 0; this.w = 2 * Math.PI * freq; this.z = zeta; }
  step(target, dt) {
    // 降帧时 dt 会变大:切成不超过 1/60 秒的小步积分,不然硬弹簧会抖飞
    const n = Math.ceil(dt * 60 - 1e-6) || 1, h = dt / n;
    for (let i = 0; i < n; i++) {
      const a = -this.w * this.w * (this.x - target) - 2 * this.z * this.w * this.v;
      this.v += a * h; this.x += this.v * h;
    }
    return this.x;
  }
}
const sp = {
  bx: new Spring(0, 2.6, 0.7), by: new Spring(0, 3.2, 0.6), rz: new Spring(0, 2.4, 0.55),
  squash: new Spring(1, 3.4, 0.3),
  armRot: [new Spring(0, 3.2, 0.42), new Spring(0, 3.2, 0.42)],
  armDrop: [new Spring(0, 5, 0.35), new Spring(0, 5, 0.35)],
  eyeX: new Spring(0, 4, 0.8), eyeY: new Spring(0, 4, 0.8),
};

// ---------------- 世界状态 ----------------
// 世界坐标:x 向右,y 向上,地面 y = 0 = 屏幕工作区底边(Dock 上沿)。单位 = S 像素。
let Wpx = innerWidth, Hpx = innerHeight;
const minX = () => BW / 2 + 0.6, maxX = () => Wpx / S - BW / 2 - 0.6;
const st = { x: Wpx / S * 0.78, y: 7, vx: 0, vy: 0, air: true };   // 开场从上面掉下来
const G = 32;

// 脚:世界坐标。落地时固定不动,需要时迈一步
const feet = REST_X.map(rx => ({ x: st.x + rx, y: st.y - LEG_L, vx: 0, vy: 0, swing: null }));
const STEP_T = 0.17, STEP_H = 0.16;

const cursor = { x: -9999, y: -9999, at: -10 };
let wander = true;

// ---------------- 用量 & 状态 ----------------
// 按剩余额度分 5 档(取 5 小时额度和本周额度里剩得更少的那个):
//   0 精神饱满 ≥50% · 1 有点忙 20~50% · 2 累了 10~20% · 3 快没电了 <10% · 4 额度用完了
// 没有额度数据时(例如用 API Key)退回按当前 5 小时窗口的估算花费,只分前三档。
const LEVEL_BUSY = 50, LEVEL_TIRED = 20, LEVEL_LOW = 10;
const MOOD_BUSY = 8, MOOD_TIRED = 25;
const MOOD_NAME = ['精神饱满', '有点忙', '累了', '快没电了', '额度用完了'];
const LIMIT_ERR = { 'no-cli': '没找到 claude 命令行', failed: '查询失败', 'no-sub': '没有订阅额度信息(可能在用 API Key)' };   // usage.js 给的错误代码
let usage = null, mood = 0;
const levelOf = r => (r <= 0 ? 4 : r < LEVEL_LOW ? 3 : r < LEVEL_TIRED ? 2 : r < LEVEL_BUSY ? 1 : 0);
let quota = null;   // 当前最紧张的那个额度窗口:{ label, rem, resetsAt }
function moodFrom(u) {
  const L = u.limits;
  const wins = L ? [[t('5 小时额度'), L.fiveHour], [t('本周额度'), L.sevenDay]].filter(([, w]) => w) : [];
  if (wins.length) {
    const [label, w] = wins.reduce((a, b) => (b[1].remaining < a[1].remaining ? b : a));
    quota = { label, rem: w.remaining, resetsAt: w.resetsAt };
    return levelOf(w.remaining);
  }
  quota = null;
  const c = u.block ? u.block.cost : 0;
  return c >= MOOD_TIRED ? 2 : c >= MOOD_BUSY ? 1 : 0;
}
const bubble = document.getElementById('bubble');
const nowSec = () => performance.now() / 1000;
let bubbleUntil = 0, bubbleKind = null;
// kind:'say' 对你说的话 / 'chat' 自言自语(心里话气泡)/ 'usage' 用量面板
const PX_FRAME = '<div class="pxf"><div class="pxs"></div><i class="d1"></i><i class="d2"></i></div>';   // 像素外框
function setBubbleHtml(html, type) {
  bubble.innerHTML = html;
  if (type) typeIn(bubble);
  bubble.insertAdjacentHTML('afterbegin', PX_FRAME);
}
function say(html, secs, kind = 'say') {
  if (bubbleKind === 'perm' && kind !== 'perm') return;   // 正在等你批准:别的话先不说,免得把按钮盖掉
  wake();
  setBubbleHtml(html, kind !== 'usage');   // 用量面板是数据,不逐字打
  bubble.className = 'show ' + kind;
  void bubble.offsetWidth;          // 重新触发弹出动画
  bubble.classList.add('pop');
  bubbleUntil = nowSec() + secs;
  bubbleKind = kind;
}
function hideBubble(force) {
  if (bubbleKind === 'perm' && !force) return;   // 批准按钮只在你表态 / 超时 / 收起时才收
  bubble.classList.remove('show', 'pop'); bubbleKind = null;
}
// 把文字拆成一个个字,配合 CSS 逐字出现(保留 <b>、<br> 等标签)
function typeIn(el) {
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  let i = 0;
  for (const n of nodes) {
    const frag = document.createDocumentFragment();
    for (const c of Array.from(n.textContent)) {
      const sp = document.createElement('span');
      sp.className = 'ch'; sp.textContent = c; sp.style.setProperty('--i', i++);
      frag.appendChild(sp);
    }
    n.replaceWith(frag);
  }
}

const fmtCost = c => '$' + (c >= 100 ? c.toFixed(0) : c.toFixed(2));
function fmtTokens(n) {
  if (EN_UI) return n >= 1e9 ? (n / 1e9).toFixed(2) + 'B' : n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e4 ? Math.round(n / 1e3) + 'K' : String(n);
  if (n >= 1e8) return (n / 1e8).toFixed(2) + ' 亿';
  if (n >= 1e4) return Math.round(n / 1e4) + ' 万';
  return String(n);
}
// 额度重置时间:"14:00 重置" / "明天 14:00 重置" / "周三 14:00 重置";back = true 时说"恢复"(额度用完时)
function fmtReset(ms, back = false) {
  if (!ms) return '';
  const d = new Date(ms), now = new Date();
  const hm = d.toTimeString().slice(0, 5);
  const days = Math.round((new Date(d).setHours(0, 0, 0, 0) - new Date(now).setHours(0, 0, 0, 0)) / 864e5);
  if (EN_UI) {
    const when = days === 0 ? hm : days === 1 ? `tomorrow ${hm}` : `${'Sun Mon Tue Wed Thu Fri Sat'.split(' ')[d.getDay()]} ${hm}`;
    return (back ? 'back ' : 'resets ') + when;
  }
  const when = days === 0 ? hm : days === 1 ? `明天 ${hm}` : `周${'日一二三四五六'[d.getDay()]} ${hm}`;
  return `${when} ${back ? '恢复' : '重置'}`;
}
function fmtAgo(min) {
  if (min < 60) return EN_UI ? `${min} min` : `${min} 分钟`;
  if (min < 1440) return EN_UI ? `${Math.round(min / 60)} h` : `${Math.round(min / 60)} 小时`;
  return EN_UI ? `${Math.round(min / 1440)} d` : `${Math.round(min / 1440)} 天`;
}
function usageHtml(u) {
  if (!u) return `<div class="title">${t('正在统计用量…')}</div>`;
  if (!u.week.messages) return `<div class="title">${t('最近 7 天还没用过 Claude Code')}</div>`;
  const row = (k, v, note) => `<div class="row"><span>${k}</span><b>${v}</b><i>${note}</i></div>`;
  let html = `<div class="title">${t('Claude Code 用量')}</div>`;
  const L = u.limits;
  if (L) {
    const bar = (label, w) => {
      if (!w) return '';
      const left = Math.round(w.remaining);
      return `<div class="quota lv${levelOf(w.remaining)}"><div class="qhead"><span>${label}</span><b>${t('剩 {0}%', left)}</b><i>${fmtReset(w.resetsAt)}</i></div>`
        + `<div class="qbar"><div style="width:${Math.max(0, Math.min(100, w.remaining))}%"></div></div>`
        + (w === L.fiveHour && etaInfo(w) ? (etaInfo(w).beforeReset
          ? `<div class="eta warn">${t('⏳ 照现在速度，约 {0}后用完', fmtMin(etaInfo(w).min))}</div>`
          : `<div class="eta ok">${t('照现在速度，撑得到重置')}</div>`) : '')
        + '</div>';
    };
    html += bar(t('5 小时额度'), L.fiveHour) + bar(t('本周额度'), L.sevenDay);
    const ago = Math.round((Date.now() - L.savedAt) / 60000);
    if (ago >= 10) html += `<div class="foot">${t('额度数据 {0}前更新', fmtAgo(ago))}</div>`;
    html += '<div class="sep"></div>';
  }
  html += row(t('今天'), fmtCost(u.today.cost), fmtTokens(u.today.tokens) + ' tokens');
  if (u.block) {
    html += row(t('5 小时窗口'), fmtCost(u.block.cost), t('还剩 {0}', fmtMin(u.block.remainingMin)));
  } else {
    html += row(t('5 小时窗口'), '—', t('当前没有进行中的窗口'));
  }
  html += row(t('近 7 天'), fmtCost(u.week.cost), fmtTokens(u.week.tokens) + ' tokens');
  const models = Object.entries(u.byModel).sort((a, b) => b[1].cost - a[1].cost);
  if (models.length && u.today.cost > 0) {
    html += '<div class="models">' + models.slice(0, 3)
      .map(([k, v]) => `${k} ${Math.round(v.cost / u.today.cost * 100)}%`).join(' · ') + '</div>';
  }
  const limitNote = L ? null : u.limitsError ? t('额度:{0}', t(LIMIT_ERR[u.limitsError] || u.limitsError)) : t('额度查询中…');
  html += ccSessionsHtml();
  // 每一节是一个不拆开的小块,太长时在「·」处换行,不会撑出气泡边框
  const foot = [t('花费按 API 价格估算'), limitNote, t('Clawd 现在{0}', t(MOOD_NAME[mood]))].filter(Boolean);
  html += `<div class="foot">${foot.map(x => `<span>${x}</span>`).join(' · ')}</div>`;
  return html;
}
function showUsage() {
  window.pet?.requestUsage();
  say(usageHtml(usage), 8, 'usage');
}

let usageInit = false, lastNag = 0;
function quotaLine() {
  if (!quota) return '';
  return t('{0}只剩 <b>{1}%</b>', quota.label, Math.round(quota.rem));
}
window.pet?.onUsage(u => {
  usage = u;
  const prev = mood;
  const m = moodFrom(u);
  mood = m;
  const free = !paused && bubbleKind !== 'usage' && action.type !== 'drag' && action.type !== 'leave';
  if (usageInit && free) {
    if (m > prev) {
      // 状态变差:主动冒一句
      if (m === 1) say(`${t('忙起来啦 💦')}<br>${quotaLine()}`, 4);
      if (m === 2) say(`${t('有点累了… 💦')}<br>${quotaLine()}`, 5);
      if (m === 3) { sfx('low'); say(`${t('⚠️ 快没电了！')}${quotaLine()}<br>${t('省着点用～')} ${quota ? fmtReset(quota.resetsAt) : ''}`, 7); lastNag = nowSec(); }
      if (m === 4) { sfx('low'); flashFace('cry', 3); say(`${t('额度用完啦…')} ${quota ? fmtReset(quota.resetsAt, true) : ''}<br>${t('我先睡会 💤')}`, 7); if (!isClinging()) setAction({ type: 'sleep' }); }
    } else if (prev >= 2 && m <= 1) {
      // 额度重置了:醒来庆祝
      sfx('recover'); say(t('额度恢复啦！🎉'), 4);
      if (!isClinging()) setAction({ type: 'dance', dur: 3, face: 'star' }); else flashFace('star', 3);
    } else if (m === 3 && nowSec() - lastNag > 15 * 60) {
      say(`⚠️ ${quotaLine()}${t('，省着点用～')}`, 5);
      lastNag = nowSec();
    }
  }
  if (!usageInit && m === 4 && !isClinging()) setAction({ type: 'sleep' });
  if (usageInit) checkEtaAndBreak(u);
  usageInit = true;
  if (bubbleKind === 'usage') setBubbleHtml(usageHtml(usage), false);   // 气泡开着时实时刷新
});

// ---------------- 自言自语 ----------------
// 闲着的时候每隔 40~100 秒随机冒一句,内容看时间、额度、是不是贴在墙上、你最近用得猛不猛。
// 额度用完(睡着)、被拖着、气泡开着时不说话。
const CHAT = {
  any: ['哼哼哼～ ♪', '（伸了个懒腰）', '在想下一个 bug 藏在哪…', '要不要喝口水？💧', '我是螃蟹吗？🦀 不是哦', 'commit 了吗？',
    '(・ω・)', '今天也要好好写代码 ✨', '戳戳我试试？', '偷偷告诉你，我会跳舞', '测试都跑过了吗？', '休息一下眼睛吧 👀'],
  night: ['这么晚还不睡？🌙', '夜深了，早点休息哦', '熬夜会掉头发的…'],
  morning: ['早上好 ☀️', '今天也元气满满！', '来杯咖啡吗？☕'],
  lunch: ['该吃午饭啦 🍱', '饿了…'],
  evening: ['快下班了吧？', '今天辛苦啦 🌇'],
  busy: ['有点忙，但还撑得住 💪', '你的手速好快…', '冲冲冲！'],
  tired: ['好累…', '能歇会儿吗…', '我…还能…再跑一会…'],
  low: ['电量告急 🪫', '要省着点用哦', '快…快没电了…'],
  cling: ['偷偷看着你 👀', '墙边好凉快', '我藏好了吗？', '嘘——'],
  active: ['你又在用 Claude Code 啦', '写得好快！', '这段代码看起来不错哦'],
  idle: ['好久没理我了…', '在忙别的吗？', '无聊…'],
  working: ['Claude 在努力干活…', '我帮你盯着呢 👀', '敲敲敲…', '这个任务有点大哦'],
};
let nextChat = nowSec() + 15 + Math.random() * 15, lastChat = '';   // rand() 在后面才定义,这里直接用 Math.random
function chatter(force = false) {
  const now = nowSec();
  if (!force && now < nextChat) return;
  if (chatLevel === 'off') { nextChat = now + 30; return; }
  nextChat = now + ({ chatty: rand(18, 45), quiet: rand(180, 360) }[chatLevel] || rand(40, 100));
  if (paused || bubbleKind || mood === 4 || ['drag', 'leave', 'sleep', 'fall'].includes(action.type)) return;
  const h = new Date().getHours();
  const pools = [CHAT.any];
  if (h < 5 || h >= 23) pools.push(CHAT.night, CHAT.night);
  else if (h < 10) pools.push(CHAT.morning);
  else if (h >= 11 && h < 13) pools.push(CHAT.lunch);
  else if (h >= 17 && h < 20) pools.push(CHAT.evening);
  if (mood === 1) pools.push(CHAT.busy);
  if (mood === 2) pools.push(CHAT.tired, CHAT.tired);
  if (mood === 3) pools.push(CHAT.low, CHAT.low);
  if (isClinging()) pools.push(CHAT.cling, CHAT.cling);
  const since = usage && usage.lastActive ? Date.now() - usage.lastActive : Infinity;
  if (since < 3 * 60e3) pools.push(CHAT.active);
  else if (since > 60 * 60e3 && since < Infinity && !ccWorking()) pools.push(CHAT.idle);   // Claude 正在干活时不说"好久没理我"
  if (ccWorking()) {
    pools.push(CHAT.working);
    // 说说 Claude 正在干什么
    const busy = [...ccSessions.values()].filter(x => x.state === 'tool').sort((a, b) => b.last - a.last)[0];
    if (busy) { const l = t('Claude 在{0}…', ccActivity(busy)); pools.push([l], [l]); }
  }
  const burn = usage && usage.today.cost >= 20 ? t('今天已经烧了 {0} 的 token 啦 🔥', fmtCost(usage.today.cost)) : null;
  if (burn) pools.push([burn]);
  let line;
  for (let i = 0; i < 5 && (!line || line === lastChat); i++) { const pool = pools[Math.floor(Math.random() * pools.length)]; line = t(pool[Math.floor(Math.random() * pool.length)]); }
  lastChat = line;
  say(line, 3.5, 'chat');
  if (line === burn) flashFace('money', 3.5);
  if (!isClinging() && action.type !== 'walk' && Math.random() < 0.3) setAction({ type: 'wave', dur: 1.2 });
}

// ---------------- 音效(默认关,菜单「设置 → 音效」打开) ----------------
// 不用音频文件:用 Web Audio 现场合成 8-bit 风格的小音效(方波 / 三角波),音量压得很低。
// 每个音效是一串音符 [频率 Hz(0 = 停顿), 时长秒, 波形, 滑到的频率]。
let soundOn = false, actx = null;
const SFX_VOL = 0.05;
const SFX = {
  jump: [[330, 0.12, 'square', 700]],
  land: [[160, 0.07, 'triangle', 80]],
  bonk: [[220, 0.06, 'square', 110], [0, 0.03], [180, 0.1, 'square', 90]],
  pickup: [[500, 0.07, 'square', 900]],
  poke: [[620, 0.05, 'square', 310]],
  pop: [[660, 0.05, 'triangle', 990]],
  purr: [[200, 0.18, 'triangle', 240], [240, 0.18, 'triangle', 200]],
  done: [[523, 0.08], [659, 0.08], [784, 0.08], [1047, 0.2]],          // 叮咚上行:做完啦
  ask: [[880, 0.08], [0, 0.06], [880, 0.14]],                          // 叮、叮:需要你
  error: [[392, 0.12], [311, 0.12], [247, 0.24]],                      // 下行三音:出错
  low: [[440, 0.12, 'triangle'], [330, 0.2, 'triangle']],
  recover: [[523, 0.07], [784, 0.07], [1047, 0.16]],
  chime: [[784, 0.1, 'triangle'], [1047, 0.22, 'triangle']],           // 休息提醒、额度预测
  leave: [[400, 0.18, 'square', 1400]],
};
function sfx(name) {
  if (!soundOn || !SFX[name]) return;
  try {
    actx ||= new AudioContext();
    if (actx.state === 'suspended') actx.resume();
    let t = actx.currentTime + 0.02;
    for (const [f, dur, type = 'square', to] of SFX[name]) {
      if (f) {
        const o = actx.createOscillator(), g = actx.createGain();
        o.type = type;
        o.frequency.setValueAtTime(f, t);
        if (to) o.frequency.exponentialRampToValueAtTime(to, t + dur);
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(SFX_VOL * (type === 'triangle' ? 2 : 1), t + 0.01);   // 三角波听着轻,补一点
        g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        o.connect(g).connect(actx.destination);
        o.start(t); o.stop(t + dur + 0.02);
      }
      t += dur;
    }
  } catch (e) { console.warn('音效播放失败', e); }
}

// ---------------- 偏好(主进程按菜单设置发过来) ----------------
let chatLevel = 'normal', breakMin = 60, ccNotify = { done: true, ask: true }, ccHooks = false;

// ---------------- 和 Claude Code 联动(hooks) ----------------
// 每个会话一个状态:思考中 → 调用工具(具体在干什么)→ 等你批准 / 等你回复 → 完成 / 出错。
// Clawd 据此抱电脑干活、跳起来报告、挥手提醒;用量面板底部列出所有会话。
const esc = x => String(x).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const ccSessions = new Map();   // session → { state, tool, detail, project, since(进入当前状态), started(这轮任务开始), last }
const CC_BUSY = ['thinking', 'tool'];
const TOOL_LABEL = { Bash: '运行命令', Edit: '改文件', MultiEdit: '改文件', Write: '写文件', Read: '读文件', NotebookEdit: '改笔记本',
  Grep: '搜索', Glob: '找文件', WebFetch: '看网页', WebSearch: '搜网页', Task: '派出子助手', Agent: '派出子助手', TodoWrite: '列计划' };
function ccPurge() {
  const now = Date.now();
  for (const [id, x] of ccSessions) {
    const idle = now - x.last;
    if (idle > 30 * 60e3 || (!CC_BUSY.includes(x.state) && idle > 15 * 60e3)) ccSessions.delete(id);
  }
}
function ccWorking() { ccPurge(); for (const x of ccSessions.values()) if (CC_BUSY.includes(x.state)) return true; return false; }
function ccActivity(x, short = false) {   // 一句话描述会话在干什么
  if (x.state === 'tool') {
    const d = x.detail ? (short && x.detail.length > 16 ? x.detail.slice(0, 15) + '…' : x.detail) : '';
    return `${TOOL_LABEL[x.tool] ? t(TOOL_LABEL[x.tool]) : x.tool || t('干活')}${d ? t('：') + d : ''}`;
  }
  return t({ thinking: '思考中', ask: '等你批准', waiting: '等你回复', done: '完成', error: '出错了' }[x.state] || '');
}
const CC_ICON = { thinking: '💭', tool: '⚙️', ask: '🙋', waiting: '💬', done: '✅', error: '⚠️' };
function fmtElapsed(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  if (EN_UI) return s < 60 ? `${s}s` : s < 3600 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${Math.floor(s / 3600)}h ${Math.floor(s % 3600 / 60)}m`;
  return s < 60 ? `${s} 秒` : s < 3600 ? `${Math.floor(s / 60)} 分 ${s % 60} 秒` : `${Math.floor(s / 3600)} 小时 ${Math.floor(s % 3600 / 60)} 分`;
}
function ccSessionsHtml() {   // 用量面板底部的会话列表
  ccPurge();
  if (!ccSessions.size) return '';
  const now = Date.now();
  const rows = [...ccSessions.values()].sort((a, b) => b.last - a.last).slice(0, 5).map(x => {
    const busy = CC_BUSY.includes(x.state);
    const time = busy ? fmtElapsed(now - x.started) : x.state === 'done' || x.state === 'error' ? t('{0}前', fmtElapsed(now - x.since)) : fmtElapsed(now - x.since);
    return `<div class="sess st-${x.state}"><span>${esc(x.title || x.project || t('会话'))}</span><b>${CC_ICON[x.state] || ''} ${esc(ccActivity(x, true))}</b><i>${time}</i></div>`;
  }).join('');
  return `<div class="sep"></div><div class="sub">${t('Claude Code 会话')}</div>${rows}`;
}
function ccProject(ev) { const n = ev.title || ev.project; return n ? `<br><b>${esc(n)}</b>` : ''; }
function ccAlert(html, secs, jump) {
  if (paused) return;
  say(html, secs);
  if (isClinging() || action.type === 'drag') { action.waveT = 0; return; }
  setAction(jump ? { type: 'jump', dir: 0, big: true } : { type: 'wave', dur: 2.4 });
}
window.pet?.onClaude?.(ev => {
  const sid = ev.session || '?', now = Date.now();
  ccHooks = true;   // 收到过事件就说明 hooks 已经连上了
  const wasWorking = ccWorking();
  const x = ccSessions.get(sid) || { state: 'thinking', tool: '', detail: '', project: '', since: now, started: now, last: now };
  const to = (state) => { if (x.state !== state) x.since = now; x.state = state; };
  x.last = now;
  if (ev.project) x.project = ev.project;
  if (ev.title) x.title = ev.title;   // 会话标题,没有就退回项目名
  if (ev.app) { x.app = ev.app; x.tty = ev.tty; x.host = ev.host; }   // 会话开在哪个 App / 终端,点小螃蟹时跳过去
  ccSessions.set(sid, x);
  switch (ev.event) {
    case 'UserPromptSubmit': to('thinking'); x.started = now; x.since = now; x.tool = x.detail = ''; break;
    case 'PreToolUse':
      if (!CC_BUSY.includes(x.state)) x.started = now;   // 批准后继续干活,或者中途才连上
      to('tool'); x.since = now; x.tool = ev.tool; x.detail = ev.detail;
      { const k = cmdKind(ev.cmd); if (k === 'rm' || k === 'force' || k === 'sudo') react(k); }
      break;
    case 'PostToolUse': {
      const k = cmdKind(ev.cmd);
      if (k === 'test') react('test-pass'); else if (k === 'build') react('build-pass');
      else if (['push', 'commit', 'install', 'docker'].includes(k)) react(k);
      break;
    }
    case 'PostToolUseFailure':
      // 工具失败很常见(比如搜索没结果),只晕一下,不弹对话框;测试没过就垂头丧气
      { const k = cmdKind(ev.cmd); if (k === 'test') react('test-fail'); else if (k === 'build') react('build-fail'); else flashFace('dizzy', 1.6); }
      break;
    case 'Stop': {
      const took = now - x.started;
      to('done');
      if (userAway) awayLog.set(sid, 'done');
      // 很快就答完的不打扰,干了一会儿(≥ 15 秒)的才报告
      if (ccNotify.done && took >= 15e3) { sfx('done'); flashFace('happy', 2.5); ccAlert(t('Claude 做完啦 ✅') + ccProject(ev), 6, true); }
      break;
    }
    case 'StopFailure':
      to('error');
      if (userAway) awayLog.set(sid, 'error');
      if (ccNotify.done) { sfx('error'); flashFace('cry', 2.5); ccAlert(t('⚠️ Claude 出错停下了') + ccProject(ev), 7); }
      break;
    case 'Notification': {
      // 优先看官方的 notification_type;老版本没有这个字段时再看提示文字
      const perm = ev.ntype === 'permission_prompt' || /permission/i.test(ev.message);
      const idle = ev.ntype === 'idle_prompt' || ev.ntype === 'agent_needs_input' || /waiting for your input/i.test(ev.message);
      const dialog = ev.ntype === 'elicitation_dialog' || ev.ntype === 'elicitation_url_dialog';
      if (!perm && !idle && !dialog) break;   // 其他通知(登录成功等)不打扰
      to(perm || dialog ? 'ask' : 'waiting');
      if (!ccNotify.ask) break;
      sfx('ask');
      const tool = (ev.message.match(/permission to use (.+)$/i) || [])[1] || (x.state === 'ask' && x.tool) || '';
      if (perm) ccAlert((tool ? t('🙋 要用 <b>{0}</b>，需要你批准', esc(tool)) : t('🙋 需要你批准')) + ccProject(ev), 8);
      else if (dialog) ccAlert(t('🙋 Claude 有问题要问你') + ccProject(ev), 8);
      else ccAlert(t('💬 Claude 在等你回复') + ccProject(ev), 6);
      break;
    }
    case 'SessionEnd': ccSessions.delete(sid); break;
  }
  if (wasWorking !== ccWorking() && action.type === 'rest') delete action.prop;   // 状态一变,马上拿起 / 放下电脑
  if (bubbleKind === 'usage') setBubbleHtml(usageHtml(usage), false);   // 面板开着就马上更新会话列表
});
// ---------------- 会话小螃蟹 & 任务标记「!」 ----------------
// 每个 Claude Code 会话一只像素小螃蟹,不加框直接趴在 Clawd 头顶,跟着它一起转(贴边时侧过来趴在朝屏幕里的头顶上)。颜色表示状态:
// 灰 = 思考中,橙 = 在干活(轻轻颠),红 = 等你批准 / 回复(头顶一个像素「!」,一起蹦),绿 = 刚做完,红 = 出错
// (做完 / 出错的 1 分钟后消失)。光标移到小螃蟹上,列出每个会话在干什么。
const DOT_MAX = 6, DOT_DONE_KEEP = 60e3, RIDERS_MAX = SCALE < 0.6 ? 3 : 4;   // 头顶最多趴 4 只(迷你只有 3 只的地方),多的显示 +N
const DOT_RANK = { ask: 0, waiting: 1, tool: 2, thinking: 3, error: 4, done: 5 };
const CRAB_PX = ['.#######.', '.#.###.#.', '#########', '.#######.', '.#.#.#.#.'];   // 9×5 像素,和菜单栏图标同一个造型
const CRAB_RECTS = CRAB_PX.flatMap((row, y) => [...row].map((c, x) => (c === '#' ? `<rect x="${x}" y="${y}" width="1" height="1"/>` : ''))).join('');
const BANG = '<svg class="bang" viewBox="0 0 1 6" width="2" height="12"><rect width="1" height="4"/><rect y="5" width="1" height="1"/></svg>';   // 像素「!」
const crabSvg = state => {
  const crab = `<svg class="crab" viewBox="0 0 9 5" width="18" height="10">${CRAB_RECTS}</svg>`;
  return `<i class="rider st-${state}">${state === 'ask' || state === 'waiting' ? BANG : ''}${crab}</i>`;   // 等你的那只头顶一个「!」
};
const dotsTip = document.getElementById('dotstip'), ridersEl = document.getElementById('riders');
let dotsHover = false, dotsSince = 0, dotList = [], dotsTargets = [], ridersTop = Infinity, ridersSide = 0, crabsOn = true;   // crabsOn:菜单里可以关掉
function dotSessions() {   // 要显示的会话:干活 / 等你的,加上刚做完或出错不到 1 分钟的;等你的排前面
  ccPurge();
  const now = Date.now();
  return [...ccSessions.entries()]
    .filter(([, x]) => CC_BUSY.includes(x.state) || x.state === 'ask' || x.state === 'waiting' || now - x.since < DOT_DONE_KEEP)
    .sort((a, b) => DOT_RANK[a[1].state] - DOT_RANK[b[1].state] || b[1].started - a[1].started)
    .slice(0, DOT_MAX);
}
const headPt = new THREE.Vector3(), headUp = new THREE.Vector3();
// 身体顶面中心在屏幕上的位置,以及「头顶朝上」在屏幕上的方向(取最接近的 90° 倍数,像素保持清晰;
// 贴边时 Clawd 侧过来,头顶朝着屏幕里面)。按不带呼吸的姿态量,螃蟹不会一像素一像素地抖
function headTopScreen() {
  const pos = bodyG.position.clone(), scl = bodyG.scale.clone();
  if (steadyPose) setBodyPose(...steadyPose);
  root.updateMatrixWorld(true); camera.updateMatrixWorld();
  headPt.set(0, BH / 2, 0).applyMatrix4(bodyMesh.matrixWorld).project(camera);
  headUp.set(0, BH / 2 + 1, 0).applyMatrix4(bodyMesh.matrixWorld).project(camera);
  bodyG.position.copy(pos); bodyG.scale.copy(scl); root.updateMatrixWorld(true);
  const deg = Math.atan2(headUp.x - headPt.x, (headUp.y - headPt.y) * CH / CW) * 180 / Math.PI;
  return { x: canvasLeft + (headPt.x + 1) / 2 * CW, y: canvasTop + (1 - headPt.y) / 2 * CH, rot: Math.round(deg / 90) * 90 };
}
// 每帧在画血条之前:算出要显示的会话,摆好头顶的小螃蟹(血条和气泡要让到它们上面)
function updateRiders() {
  // 打开用量面板时先藏起来(面板里本来就列着会话);其他气泡出现时照常显示,气泡会抬到它上面
  const hidden = !crabsOn || paused || bubbleKind === 'usage' || ['drag', 'leave'].includes(action.type);
  dotList = hidden ? [] : dotSessions();
  const html = dotList.slice(0, RIDERS_MAX).map(([, x]) => crabSvg(x.state)).join('')
    + (dotList.length > RIDERS_MAX ? `<b>+${dotList.length - RIDERS_MAX}</b>` : '');
  if (ridersEl.dataset.html !== html) { ridersEl.dataset.html = html; ridersEl.innerHTML = html; }
  ridersEl.classList.toggle('show', dotList.length > 0);
  ridersTop = Infinity; ridersSide = 0;
  let rot = 0;
  if (dotList.length) {
    const w = ridersEl.offsetWidth, h = ridersEl.offsetHeight, hp = headTopScreen();
    // 整组以脚底中点为轴,跟着头顶的朝向转;脚稍微陷进顶面一点,像趴在上面
    const x = Math.round(hp.x - w / 2), y = Math.round(hp.y - h + 2);
    rot = hp.rot;
    setTransform(ridersEl, `translate(${x}px, ${y + (rot === 0 ? Math.round(ridersPop.y) : 0)}px) rotate(${rot}deg)`);   // 被 Clawd 颠起来时往上飞
    if (rot === 0) ridersTop = y;        // 站着:血条、气泡挂到螃蟹上面
    else ridersSide = h + 2;             // 侧着(贴边):螃蟹占了身体朝屏幕里的那一侧,血条再往里让开
  }
  trackLeavers(hidden, rot);
}
// 做完 / 出错的会话到时间离开时,那只螃蟹不是直接消失,而是从头顶跳下来:做完的挥挥手(蹦两下),
// 出错的翻个肚皮蹬蹬腿,然后横着爬走。只在站着时这样;贴边、拖着、藏起来时照旧直接消失
const ridersPrev = new Map();   // 上一帧趴在头顶的螃蟹:sid → { state, rect }
function trackLeavers(hidden, rot) {
  if (hidden) { ridersPrev.clear(); return; }
  const cx = canvasLeft + CW / 2;
  for (const [sid, p] of ridersPrev)
    if ((p.state === 'done' || p.state === 'error') && !dotList.some(([s]) => s === sid))
      crabLeave(p.state, p.rect, Math.sign(p.rect.left + p.rect.width / 2 - cx) || 1);   // 往离 Clawd 远的那边走
  ridersPrev.clear();
  if (rot !== 0) return;
  const els = ridersEl.querySelectorAll('.rider');
  dotList.slice(0, RIDERS_MAX).forEach(([sid, x], i) => { if (els[i]) ridersPrev.set(sid, { state: x.state, rect: els[i].getBoundingClientRect() }); });
}
// 头顶最高处:身体 / 道具的顶边,头上趴着螃蟹时取螃蟹(连同「!」)的顶边。血条、气泡都挂在它上面
const petTop = an => Math.min(an.top, ridersTop - 4);

// ---------------- 小特效:彩纸、烟、跳下去爬走的小螃蟹 ----------------
// 都是屏幕上的像素小方块(DOM),跟着主循环一帧帧动,动完就删掉
const fxEl = document.getElementById('fx'), fx = [];
const ridersPop = { y: 0, v: 0 };   // Clawd 把头顶的螃蟹颠起来:往上飞多高(px)、速度
const CONFETTI = ['#D97757', '#7FA383', '#D4A24C', '#6A9BCC', '#B8433F', '#E8DFD0'];
function fxAdd(o, cls = '', html = '') {
  const el = document.createElement('i');
  el.className = cls; el.innerHTML = html;
  if (o.color) el.style.background = o.color;
  if (o.size) el.style.width = el.style.height = o.size + 'px';
  fxEl.appendChild(el);
  fx.push({ el, age: 0, g: 0, vx: 0, vy: 0, drag: 0, life: 1, ...o });
}
function confetti(x, y) {   // 测试全过:从头顶撒一把像素彩纸
  for (let i = 0; i < 36; i++)
    fxAdd({ x, y, vx: rand(-240, 240), vy: rand(-540, -260), g: 900, drag: 1.4, life: rand(1.4, 2.1), color: CONFETTI[i % CONFETTI.length], flip: rand(0, 1) });
}
function smoke(x, y) {   // git push:脚底往两边喷烟
  for (let i = 0; i < 16; i++) {
    const d = i % 2 ? 1 : -1;
    fxAdd({ x: x + d * rand(0, 14), y: y - rand(0, 6), vx: d * rand(50, 170), vy: rand(-60, -10), g: -40, drag: 2.6, life: rand(0.5, 0.9), color: '#D3CCC0', size: 2 * Math.round(rand(2, 4)) });
  }
}
function bubbles(x, y) {   // docker:从头顶冒几个蓝泡泡
  for (let i = 0; i < 10; i++)
    fxAdd({ x: x + rand(-18, 18), y, vx: rand(-20, 20), vy: rand(-170, -90), g: -30, drag: 1, life: rand(0.9, 1.4), color: '#6A9BCC', size: 2 * Math.round(rand(2, 4)) });
}
function boxes(x, y) {   // 装依赖:几个小纸箱从头顶上方落下,砸在头上
  for (let i = 0; i < 3; i++)
    fxAdd({ x: x + (i - 1) * 12 - 6, y: y - 70 - i * 26, vx: 0, vy: 0, g: 1500, drag: 0, life: 0.5 + i * 0.05, color: i % 2 ? '#B98B5A' : '#D6B07C', size: 12 });
}
function sparkles(x, y) {   // 构建成功:头顶闪一把金色小星星
  for (let i = 0; i < 12; i++)
    fxAdd({ x: x + rand(-24, 24), y: y - rand(0, 20), vx: rand(-40, 40), vy: rand(-120, -40), g: 120, drag: 1.2, life: rand(0.6, 1), color: i % 2 ? '#D4A24C' : '#F2E3B0', size: 4 });
}
function crabLeave(state, r, dir) {
  fxAdd({ crab: true, x: r.left, y: r.top, h: r.height, vx: dir * 70, vy: -240, g: 1100, dir, phase: 'hop', hops: state === 'error' ? 0 : 2, belly: state === 'error', life: 30 },
    `crab rider st-${state}`, `<svg viewBox="0 0 9 5" width="18" height="10">${CRAB_RECTS}</svg>`);
}
function stepCrab(f, dt) {
  const floor = Hpx - f.h;   // 和 Clawd 站在同一条地面上
  let rot = 0, bob = 0;
  if (f.phase === 'hop' || f.phase === 'wave') {
    f.vy += f.g * dt; f.x += f.vx * dt; f.y += f.vy * dt;
    if (f.y >= floor) {
      f.y = floor; f.vx = 0; f.vy = 0;
      if (f.phase === 'hop') { f.phase = f.belly ? 'belly' : 'wave'; f.t0 = f.age; }
      if (f.phase === 'wave') { if (f.hops-- > 0) f.vy = -150; else { f.phase = 'crawl'; f.t0 = f.age; } }   // 挥手 = 原地蹦两下
    }
  } else if (f.phase === 'belly') {   // 翻过来肚皮朝天,蹬腿
    rot = 180; f.jit = Math.floor(f.age * 14) % 2 ? 1 : -1;
    if (f.age - f.t0 > 1) { f.phase = 'crawl'; f.t0 = f.age; f.jit = 0; }
  } else {   // 横着爬走,一步一颠,慢慢淡出
    f.x += f.dir * 55 * dt; bob = Math.floor(f.age * 9) % 2 ? -1 : 0;
    const k = f.age - f.t0;
    f.el.style.opacity = Math.max(0, Math.min(1, (2.4 - k) / 0.7));
    if (k > 2.4) f.age = f.life;
  }
  setTransform(f.el, `translate(${Math.round(f.x + (f.jit || 0))}px, ${Math.round(f.y) + bob}px)${rot ? ` rotate(${rot}deg)` : ''}`);
}
function updateFx(dt) {
  if (ridersPop.v || ridersPop.y) {   // 被颠起来的螃蟹落回头顶
    ridersPop.v += 1500 * dt; ridersPop.y += ridersPop.v * dt;
    if (ridersPop.y >= 0) ridersPop.y = ridersPop.v = 0;
  }
  for (let i = fx.length - 1; i >= 0; i--) {
    const f = fx[i];
    f.age += dt;
    if (f.crab) stepCrab(f, dt);
    else {
      const k = Math.exp(-f.drag * dt);
      f.vx *= k; f.vy = f.vy * k + f.g * dt; f.x += f.vx * dt; f.y += f.vy * dt;
      if (f.flip !== undefined) {   // 彩纸翻转:一会儿宽一会儿窄
        const w = Math.floor((f.age + f.flip) * 9) % 2;
        f.el.style.width = (w ? 6 : 3) + 'px'; f.el.style.height = (w ? 3 : 6) + 'px';
      }
      f.el.style.opacity = Math.max(0, Math.min(1, (f.life - f.age) / 0.35));
      setTransform(f.el, `translate(${Math.round(f.x)}px, ${Math.round(f.y)}px)`);
    }
    if (f.age >= f.life || f.y > Hpx + 20 || f.x < -40 || f.x > Wpx + 40) { f.el.remove(); fx.splice(i, 1); }
  }
}

// ---------------- 对 Claude 干的活做出反应 ----------------
// 测试全过:蹦起来撒彩纸;没过:垂头丧气;git push 成功:像火箭一样蹿起来,脚底冒烟;rm -rf:吓得缩成一团发抖
// 强制推送:比 rm -rf 更紧张;git commit:盖章;装依赖:头顶落下一堆箱子;构建:成功闪星星、失败垂头丧气;docker:冒蓝泡泡;sudo:皱眉
// 顺序有讲究:先匹配到的优先(强制推送要排在 push 前,sudo 排最后)
const CMD_KINDS = [
  ['rm', /\brm\s+(-[a-zA-Z]*r[a-zA-Z]*f|-[a-zA-Z]*f[a-zA-Z]*r|-[rR]\s+-f|-f\s+-[rR])\b/],
  ['force', /\bgit\b[^;&|]*\spush\b[^;&|]*(\s--force(?!-with)\b|\s-[a-zA-Z]*f[a-zA-Z]*\b|\s\+\S)/],
  ['push', /\bgit\b[^;&|]*\spush\b/],
  ['commit', /\bgit\b[^;&|]*\scommit\b/],
  ['test', /\b(npm|pnpm|yarn|bun)\s+(run\s+)?test\b|\b(pytest|jest|vitest|rspec|phpunit|mocha)\b|\b(go|cargo|swift|mix|dotnet|deno)\s+test\b|\bmake\s+(test|check)\b/],
  ['build', /\b(npm|pnpm|yarn|bun)\s+(run\s+)?build\b|\b(cargo|go|swift|dotnet|gradle|mvn)\s+build\b|\bxcodebuild\b|\btsc\b|\bmake\b(?!\s+(test|check))/],
  ['install', /\b(npm|pnpm|yarn|bun)\s+(install|i|add|ci)\b|\bpip3?\s+install\b|\bbrew\s+install\b|\bcargo\s+(add|install)\b|\bgo\s+(get|mod\s+download)\b|\bbundle\s+install\b/],
  ['docker', /\bdocker(-compose|\s+compose)?\s+(build|run|up|compose)\b/],
  ['sudo', /(^|[;&|]\s*)sudo\b/],
];
const cmdKind = c => (c && (CMD_KINDS.find(([, re]) => re.test(c)) || [])[0]) || '';
const reactAt = {};
function react(kind) {
  const now = Date.now();
  if (now - (reactAt[kind] || 0) < 15e3) return;   // 好几个会话一起跑测试时别刷屏
  if (paused || userAway || permShown || isClinging() || ['drag', 'leave', 'fall', 'sleep'].includes(action.type)) return;
  reactAt[kind] = now;
  const an = petAnchor();
  if (kind === 'test-pass') { setAction({ type: 'jump', dir: 0, big: true }); flashFace('star', 2); sfx('recover'); confetti(an.x, an.top); }
  else if (kind === 'test-fail') { setAction({ type: 'slump', dur: 2.4 }); flashFace('cry', 2.4); sfx('low'); }
  else if (kind === 'push') { setAction({ type: 'jump', dir: 0, big: true }); flashFace('joy', 1.6); sfx('leave'); smoke(an.x, Hpx - st.y * S); }
  else if (kind === 'rm') { setAction({ type: 'shiver', dur: 1.6 }); flashFace('surprised', 1.6); sweatT = clock.elapsedTime; }
  else if (kind === 'force') { setAction({ type: 'shiver', dur: 2.4 }); flashFace('dizzy', 2.4); sweatT = clock.elapsedTime; }
  else if (kind === 'commit') { setAction({ type: 'jump', dir: 0 }); flashFace('happy', 1.2); sfx('recover'); }
  else if (kind === 'install') { setAction({ type: 'slump', dur: 1.2 }); flashFace('surprised', 1.2); boxes(an.x, an.top); }
  else if (kind === 'build-pass') { setAction({ type: 'jump', dir: 0 }); flashFace('joy', 1.4); sfx('recover'); sparkles(an.x, an.top); }
  else if (kind === 'build-fail') { setAction({ type: 'slump', dur: 2.4 }); flashFace('cry', 2.4); sfx('low'); }
  else if (kind === 'docker') { setAction({ type: 'jump', dir: 0 }); flashFace('wink', 1.4); bubbles(an.x, an.top); }
  else if (kind === 'sudo') { setAction({ type: 'shiver', dur: 0.8 }); flashFace('annoyed', 1.6); }
}
// 血条里的内容:格子 = 5 小时额度,小圆环 = 本周额度;nums 时两个百分比都写出来
function usageHTML(L, vert, nums) {
  const r = Math.max(0, Math.round(L.fiveHour ? L.fiveHour.remaining : 100));   // 5 小时窗口过期 = 已重置,满格
  const hl = levelOf(r), cells = Math.min(10, Math.ceil(r / 10));
  const text = hl === 4 && !vert && L.fiveHour ? `0% · ${fmtReset(L.fiveHour.resetsAt, true)}` : hl >= 2 || nums ? `${r}%` : '';
  const wk = L.sevenDay ? Math.max(0, Math.min(100, Math.round(L.sevenDay.remaining))) : null;
  const pct = (v, cls = '') => vert ? `<b class="${cls}"><span>${v}</span><span>%</span></b>` : `<b class="${cls}">${v}%</b>`;
  const html = '<div class="hp">' + Array.from({ length: 10 }, (_, i) => `<i${i < cells ? ' class="on"' : ''}></i>`).join('') + '</div>'
    + (!text ? '' : vert ? pct(r) : `<b>${text}</b>`)
    + (wk === null ? '' : `<svg class="ring lv${levelOf(wk)}" viewBox="0 0 16 16"><circle class="track" cx="8" cy="8" r="6"/>`
      + `<circle class="arc" cx="8" cy="8" r="6" pathLength="100" stroke-dasharray="${wk} 100" transform="rotate(-90 8 8)"/></svg>`
      + (nums ? pct(wk, `wk lv${levelOf(wk)}`) : ''));
  return { html, hl };
}
let hpUsage = null, hpFromDots = false;   // 这一帧血条该显示的用量(没有就是 null);最近一次悬停是不是在小螃蟹上
function updateDots() {   // 光标停在小螃蟹上时的会话详情
  dotsTargets = dotList.length ? [ridersEl] : [];
  if (!dotsTargets.length) { dotsHover = false; dotsTip.classList.remove('show'); return; }
  // 悬停详情:每个会话一行(图标 项目 在干什么 多久)
  dotsTip.classList.toggle('show', dotsHover);
  if (!dotsHover) return;
  const now = Date.now();
  const u = hpUsage && usageHTML(hpUsage, false, true);
  const html = (u ? `<section class="usage lv${u.hl}">${u.html}</section>` : '') + dotList.map(([, s]) => {
    const time = CC_BUSY.includes(s.state) ? fmtElapsed(now - s.started) : fmtElapsed(now - s.since);
    return `<div class="st-${s.state}"><span>${CC_ICON[s.state] || ''} ${esc(s.title || s.project || t('会话'))}</span><b>${esc(ccActivity(s, true))}</b><i>${time}</i></div>`;
  }).join('') + (dotList.some(([, s]) => s.app) ? `<p>${t('点小螃蟹跳到它的窗口')}</p>` : '');
  if (dotsTip.dataset.html !== html) { dotsTip.dataset.html = html; dotsTip.innerHTML = html; }
  const rs = dotsTargets.map(e => e.getBoundingClientRect());
  const top = Math.min(...rs.map(r => r.top)), bottom = Math.max(...rs.map(r => r.bottom)), cx = rs[0].left + rs[0].width / 2;
  const tw = dotsTip.offsetWidth, th = dotsTip.offsetHeight;
  let tx = Math.round(Math.min(Wpx - tw - 8, Math.max(8, cx - tw / 2)));
  let ty = Math.round(top - th - 8 < 8 ? bottom + 8 : top - th - 8);
  if (isClinging()) {   // 贴边:螃蟹在身体朝屏幕里的那一侧,详情放到它们再往里
    tx = Math.round(action.side > 0 ? Math.min(...rs.map(r => r.left)) - tw - 8 : Math.max(...rs.map(r => r.right)) + 8);
    tx = Math.min(Wpx - tw - 8, Math.max(8, tx));
    ty = Math.round(Math.min(Hpx - th - 8, Math.max(8, (top + bottom) / 2 - th / 2)));
  }
  setTransform(dotsTip, `translate(${tx}px, ${ty}px)`);
}

// 点小螃蟹:跳到这个会话所在的窗口(iTerm / Terminal 精确到标签页,Claude App 精确到会话,其他 App 切到最前面)
// 螃蟹很小,按离光标最近的那只算;在捕获阶段拦下来,不让 Clawd 本身当成被点了
window.addEventListener('pointerdown', e => {
  if (!dotsHover) return;
  e.stopPropagation(); e.preventDefault();
  const dist = el => { const r = el.getBoundingClientRect(); return Math.hypot(e.clientX - (r.left + r.right) / 2, e.clientY - (r.top + r.bottom) / 2); };
  const els = [...ridersEl.querySelectorAll('.rider')];
  if (!els.length) return;
  const i = els.indexOf(els.reduce((a, b) => (dist(b) < dist(a) ? b : a)));
  const s = dotList[i]?.[1];
  if (!s) return;
  if (s.app) { sfx('pop'); window.pet?.focusSession({ app: s.app, tty: s.tty, host: s.host }); }
  else say(t('这个会话开得早，还不知道它在哪个窗口<br>重新打开会话后就能跳过去了'), 4);   // 旧版 hooks 连的会话不带 App 信息
}, true);

// ---------------- 在 Clawd 上批准权限 ----------------
// Claude 要你批准、而它所在的终端不在最前面时,Clawd 弹出「允许 / 拒绝 / 去终端处理」。一次只问一个,其他的排队;
// 60 秒没点(主进程计时)就交回终端照常弹框
const permQueue = [];   // { id, project, tool, preview, app, tty, host }
let permShown = null, permHover = false;
function showPerm() {
  if (permShown || !permQueue.length || paused) return;
  const p = permShown = permQueue[0];
  if (bubbleKind === 'usage') hideBubble();
  say(t('🙋 <b>{0}</b> 要用 <b>{1}</b>', esc(p.title || p.project || t('会话')), esc(p.tool)) + (p.preview ? `<code>${esc(p.preview)}</code>` : '')
    + `<div class="btns"><button data-d="allow">${t('允许')}<small>⌥⌘Y</small></button><button data-d="deny">${t('拒绝')}<small>⌥⌘N</small></button><button data-d="pass">${t('去终端处理')}</button></div>`
    + (permQueue.length > 1 ? `<i class="more">${t('后面还有 {0} 个', permQueue.length - 1)}</i>` : ''), 3600, 'perm');
  bubble.classList.add('say');   // 外观和对你说话的气泡一样
  sfx('ask');
  if (!isClinging() && !['drag', 'leave'].includes(action.type)) setAction({ type: 'wave', dur: 2.4 });
}
function dropPerm(id) {
  const i = permQueue.findIndex(p => p.id === id);
  if (i < 0) return;
  permQueue.splice(i, 1);
  if (permShown?.id === id) { permShown = null; permHover = false; hideBubble(true); }
  showPerm();
}
window.pet?.onPerm?.(p => { permQueue.push(p); showPerm(); if (permShown && permShown !== p) showPermCount(); });
function showPermCount() {   // 排队的数量变了:更新「后面还有 N 个」
  const el = bubble.querySelector('.more'), n = permQueue.length - 1;
  if (el) el.textContent = t('后面还有 {0} 个', n);
  else if (n > 0) bubble.insertAdjacentHTML('beforeend', `<i class="more">${t('后面还有 {0} 个', n)}</i>`);
}
bubble.addEventListener('click', e => {
  const b = e.target.closest('button[data-d]');
  if (b) decidePerm(b.dataset.d);
});
function decidePerm(d) {   // 点按钮或按快捷键
  if (!permShown) return;
  const p = permShown;
  window.pet?.permDecision(p.id, d);
  sfx(d === 'allow' ? 'pop' : 'poke');
  if (d === 'pass' && p.app) window.pet?.focusSession({ app: p.app, tty: p.tty, host: p.host });   // 去终端处理:顺便跳过去
  dropPerm(p.id);
}

// ---------------- 你离开时的小结 ----------------
// 5 分钟没碰键盘鼠标:Clawd 去睡觉,记下这期间哪些会话做完 / 出错;一回来就醒,告诉你错过了什么
let userAway = false;
const awayLog = new Map();   // session → 'done' | 'error'
function welcomeBack() {
  if (paused) return;
  const now = Date.now(), asks = [], others = [];
  for (const [sid, x] of ccSessions) {
    const name = esc(x.title || x.project || t('会话'));
    if (x.state === 'ask') asks.push(t('🙋 <b>{0}</b> 等你批准，已经等了 {1}', name, fmtMin(Math.max(1, Math.round((now - x.since) / 60e3)))));
    else if (awayLog.get(sid) === 'error') others.unshift(t('⚠️ <b>{0}</b> 出错停下了', name));
    else if (awayLog.get(sid) === 'done') others.push(t('✅ <b>{0}</b> 做完了', name));
  }
  awayLog.clear();
  const lines = [...asks, ...others];
  if (!lines.length) { if (action.type === 'sleep' && mood < 4) setAction({ type: 'wave', dur: 1.6 }); return; }   // 没什么事:醒来挥挥手
  const shown = lines.length > 4 ? [...lines.slice(0, 3), t('…还有 {0} 个', lines.length - 3)] : lines;
  sfx(asks.length ? 'ask' : 'chime');
  ccAlert(t('你不在的时候：') + '<br>' + shown.join('<br>'), 10);
}

// ---------------- 等太久再催一下 ----------------
// Claude 等你批准(权限确认 / 有问题问你)超过 3 分钟还没处理,Clawd 再挥手提醒;之后每 5 分钟一次,最多催 3 次。
// 你一处理,会话状态变了,计时就重新开始。「等你回复」不催(回答完了等你下一句很正常)。
const NUDGE_FIRST = 3 * 60e3, NUDGE_EVERY = 5 * 60e3, NUDGE_MAX = 3;
setInterval(() => {
  if (!ccNotify.ask || paused || bubbleKind === 'usage' || action.type === 'drag') return;
  const now = Date.now();
  for (const x of ccSessions.values()) {
    if (x.state !== 'ask') continue;
    if (x.nudgeFor !== x.since) { x.nudgeFor = x.since; x.nudges = 0; }   // 新的一次等待
    if (x.nudges >= NUDGE_MAX || now - x.since < NUDGE_FIRST + x.nudges * NUDGE_EVERY) continue;
    x.nudges++;
    sfx('ask');
    ccAlert(t('🙋 <b>{0}</b> 还在等你批准<br>已经等了 {1}', esc(x.title || x.project || t('会话')), fmtMin(Math.round((now - x.since) / 60e3))), 8);
    break;   // 一次只催一个
  }
}, 15e3);

// 面板开着时,会话列表里的计时每秒走一下
setInterval(() => { if (bubbleKind === 'usage' && ccSessions.size) setBubbleHtml(usageHtml(usage), false); }, 1000);

// ---------------- 额度用完预测 & 休息提醒(每次用量更新时检查) ----------------
let etaWarnedFor = null, breakState = { start: null, n: 0 };
function fmtMin(m) {
  if (EN_UI) return m >= 60 ? `${Math.floor(m / 60)} h${m % 60 ? ' ' + (m % 60) + ' min' : ''}` : `${m} min`;
  return m >= 60 ? `${Math.floor(m / 60)} 小时${m % 60 ? ' ' + (m % 60) + ' 分' : ''}` : `${m} 分钟`;
}
function etaInfo(w) {
  if (!w || w.etaMin == null) return null;
  const toReset = w.resetsAt ? (w.resetsAt - Date.now()) / 60e3 : Infinity;
  return { min: w.etaMin, beforeReset: w.etaMin < toReset - 5 };
}
function checkEtaAndBreak(u) {
  const five = u.limits && u.limits.fiveHour, e = etaInfo(five);
  if (e && e.beforeReset && e.min <= 45 && mood < 4 && etaWarnedFor !== five.resetsAt && !paused) {
    etaWarnedFor = five.resetsAt;
    sfx('chime');
    say(t('⏳ 照现在的速度<br>5 小时额度大约 <b>{0}</b>后用完', fmtMin(e.min)), 7);
  }
  if (breakMin > 0 && u.streakStart && !paused) {
    if (breakState.start !== u.streakStart) breakState = { start: u.streakStart, n: 0 };
    const mins = Math.floor((Date.now() - u.streakStart) / 60e3), n = Math.floor(mins / breakMin);
    if (n > breakState.n) {
      breakState.n = n;
      sfx('chime');
      say(t('已经连续写了 <b>{0}</b> 啦<br>起来活动一下吧 🧘', fmtMin(mins)), 7);
      if (!isClinging() && action.type !== 'drag') setAction({ type: 'stretch', dur: 3 });
    }
  }
}

// ---------------- 贴边 ----------------
// Clawd 侧过身扒在屏幕左/右边缘,大半个身子藏在屏幕外,只露出眼睛偷看;不走动、不挡东西。
// 进入:拖到边缘松手 / 用力甩向边缘 / 菜单「贴到屏幕边上」。离开:把它拖走 / 菜单「离开边缘」。
const CLING_HIDE = LEG_L + BH * 0.42;   // 藏进屏幕外的深度(从脚底算起)
const CLING_PEEK = 0.45;                // 光标靠近时多探出来的距离
let peek = 0;
const isClinging = () => action.type === 'cling';
function startCling(side, y) {
  const top = Hpx / S - BW / 2 - 0.3;
  setAction({ type: 'cling', side, y: Math.min(top, Math.max(BW / 2 + 0.3, y)) });
  st.air = false; st.vx = st.vy = 0;
  window.pet?.setClinging(true);
}
function stopCling() {
  // 从墙上跳下来,回到地面上活动
  const side = action.side;
  st.x = side < 0 ? minX() : maxX();
  st.air = true; st.vx = -side * 3; st.vy = 4;
  setAction({ type: 'fall' });
  window.pet?.setClinging(false);
}

// ---------------- 行为 ----------------
let action = { type: 'rest', t: 0, dur: 1.5 };
const rand = (a, b) => a + Math.random() * (b - a);

function pickAction() {
  if (interactive || permShown) return { type: 'rest', dur: 1 };   // 光标停在它身上 / 等你点批准按钮:乖乖待着,方便点
  if (!wander) return { type: 'rest', dur: 3 };
  const r = Math.random();
  if (mood === 4 || userAway) return { type: 'sleep' };     // 额度用完 / 你不在电脑前:睡觉
  if (ccHooks && ccWorking() && r < 0.65) return { type: 'rest', dur: rand(5, 10) };   // Claude 在干活:多抱着电脑待着
  if (mood === 3) {
    // 快没电了:很少走动,大多趴着
    if (r < 0.15) return pickWalk();
    if (r < 0.7) return { type: 'flop', dur: rand(6, 12) };
    return { type: 'rest', dur: rand(3, 6) };
  }
  if (mood === 2) {
    // 累了:少走动,不蹦不跳,常趴下打盹
    if (r < 0.3) return pickWalk();
    if (r < 0.62) return { type: 'flop', dur: rand(4, 8) };
    if (r < 0.72) return { type: 'lean', dir: Math.random() < 0.5 ? -1 : 1, dur: 2.2 };
    return { type: 'rest', dur: rand(3, 6) };
  }
  if (mood === 1 && r >= 0.62 && r < 0.72) return { type: 'flop', dur: rand(3, 5) };   // 忙的时候偶尔歇一会
  if (r < 0.42) {
    let tx, n = 0;
    do { tx = rand(minX(), maxX()); } while (Math.abs(tx - st.x) < 2.5 && ++n < 20);
    return { type: 'walk', target: tx };
  }
  if (r < 0.62) return { type: 'lean', dir: Math.random() < 0.5 ? -1 : 1, dur: 1.8 };
  if (r < 0.72) return { type: 'jump', dir: 0 };
  if (r < 0.78) return { type: 'wave', dur: 2.2 };
  if (r < 0.82) return { type: 'dance', dur: 3 };
  if (r < 0.9 && dotList.length && !isClinging()) return { type: 'bounce' };   // 和头顶的小螃蟹玩一下
  return { type: 'rest', dur: rand(2, 5) };
}
function setAction(a) { action = { t: 0, ...a }; }
function finish() { setAction(action.type === 'rest' ? pickAction() : { type: 'rest', dur: rand(1.5, 4) }); }

let paused = false;
window.pet?.onCommand(cmd => {
  wake();
  if (cmd === 'minimize') {
    if (press) { press = null; canvas.classList.remove('dragging'); }
    for (const p of permQueue.splice(0)) window.pet?.permDecision(p.id, 'pass');   // 收起了就没法点:全部交回终端
    permShown = null; hideBubble(true);
    setAction({ type: 'leave' });
    hideBubble();
    return;
  }
  if (cmd === 'restore') {
    // 从屏幕上方原来的位置掉下来
    paused = false;
    hovering = false; interactive = false;
    canvas.classList.remove('ghost');
    root.scale.setScalar(1); root.rotation.y = 0; root.rotation.z = 0;
    window.pet?.setClinging(false);
    st.y = Hpx / S + 1; st.vx = 0; st.vy = 0; st.air = true;
    feet.forEach((f, i) => { f.x = st.x + REST_X[i]; f.y = st.y - LEG_L; f.vx = f.vy = 0; f.swing = null; });
    setAction({ type: 'fall' });
    clock.getDelta();
    startLoop();
    return;
  }
  // 偏好设置:随时生效(拖着它的时候也不能丢)
  if (cmd.startsWith('chat:')) { chatLevel = cmd.slice(5); return; }
  if (cmd.startsWith('break:')) { breakMin = Number(cmd.slice(6)) || 0; return; }
  if (cmd.startsWith('holiday:')) { holidayOn = cmd.slice(8) !== 'off'; return; }
  if (cmd.startsWith('cc-notify:')) { ccNotify = { done: cmd[10] === '1', ask: cmd[11] === '1' }; return; }
  if (cmd.startsWith('cc-hooks:')) { ccHooks = cmd.slice(9) === 'on'; return; }
  if (cmd.startsWith('crabs:')) { crabsOn = cmd === 'crabs:on'; return; }
  if (cmd.startsWith('hp:')) { hpMode = cmd.slice(3); return; }
  if (cmd.startsWith('power:')) { onBattery = cmd === 'power:battery'; return; }
  if (cmd.startsWith('power-save:')) { powerSave = cmd === 'power-save:on'; return; }
  if (cmd.startsWith('sound:')) { soundOn = cmd === 'sound:on'; return; }
  if (cmd.startsWith('fade:')) { canvas.dataset.fade = cmd.slice(5); return; }
  if (cmd === 'away') {
    userAway = true; awayLog.clear();
    if (!paused && !isClinging() && !['drag', 'leave', 'fall'].includes(action.type)) setAction({ type: 'sleep' });
    return;
  }
  if (cmd === 'back') { userAway = false; welcomeBack(); return; }
  if (cmd.startsWith('perm-cancel:')) { dropPerm(Number(cmd.slice(12))); return; }
  if (cmd.startsWith('perm-key:')) { decidePerm(cmd.slice(9)); return; }
  if (action.type === 'drag' || action.type === 'leave') return;
  if (isClinging() && ['jump', 'wave', 'dance', 'lean', 'walk', 'home'].includes(cmd)) stopCling();
  if (cmd === 'passthrough-on') { passthrough = true; interactive = false; canvas.classList.remove('ghost'); return; }
  if (cmd === 'passthrough-off') { passthrough = false; return; }
  if (cmd === 'wander-on') { wander = true; return; }
  if (cmd === 'wander-off') { wander = false; if (!isClinging()) setAction({ type: 'rest', dur: 2 }); return; }   // 贴着墙就继续贴着,直接换动作会悬在半空
  if (cmd === 'home') { setAction({ type: 'walk', target: Wpx / S / 2 }); return; }
  if (cmd === 'walk') { setAction(pickWalk()); return; }
  if (cmd === 'cling') {
    if (isClinging()) { stopCling(); return; }
    // 往近的那边墙跳过去,撞上就贴住
    const side = st.x < Wpx / S / 2 ? -1 : 1;
    st.air = true; st.vx = side * 14; st.vy = 10;
    setAction({ type: 'fall', wantCling: true });
    return;
  }
  if (cmd === 'chat') { chatter(true); return; }
  if (cmd.startsWith('say:')) { say(cmd.slice(4), 4); return; }   // 开发自测:让它说一句
  if (cmd.startsWith('holiday-test:')) { holidayForce = cmd.slice(13) || null; return; }   // 开发自测:提前看节日装扮
  if (cmd === 'stretch') { if (!isClinging()) setAction({ type: 'stretch', dur: 3 }); return; }
  if (cmd.startsWith('sfx:')) { const was = soundOn; soundOn = true; sfx(cmd.slice(4)); soundOn = was; return; }   // 开发自测:试听
  if (cmd.startsWith('face:')) { flashFace(cmd.slice(5), 6); return; }
  if (cmd.startsWith('prop:')) { propOverride = cmd.slice(5); propOverrideUntil = clock.elapsedTime + 6; return; }
  if (cmd === 'usage') { showUsage(); if (!isClinging()) setAction({ type: 'present', dur: 2.4 }); return; }
  if (cmd === 'jump') setAction({ type: 'jump', dir: Math.random() < 0.5 ? -1 : 1 });
  if (cmd === 'wave') setAction({ type: 'wave', dur: 2.4 });
  if (cmd === 'dance') setAction({ type: 'dance', dur: 4 });
  if (cmd === 'lean') setAction({ type: 'lean', dir: Math.random() < 0.5 ? -1 : 1, dur: 1.8 });
});
function pickWalk() {
  let tx, n = 0;
  do { tx = rand(minX(), maxX()); } while (Math.abs(tx - st.x) < 3 && ++n < 20);
  return { type: 'walk', target: tx };
}

// ---------------- 交互:拖拽 / 点击 / 穿透 ----------------
const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();
let canvasLeft = 0, canvasTop = 0;
let hovering = false;

function hitTest(px, py) {
  const lx = px - canvasLeft, ly = py - canvasTop;
  if (lx < 0 || ly < 0 || lx > CW || ly > CH) return false;
  ndc.set(lx / CW * 2 - 1, -(ly / CH * 2 - 1));
  raycaster.setFromCamera(ndc, camera);
  return raycaster.intersectObject(root, true).length > 0;
}

// ---- 防挡 ----
// 1. 光标只是路过时:Clawd 变半透明,点击直接穿透到下面的 App;
//    在它身上停留 HOVER_INTENT 秒才变实、可以点和拖,同时停下脚步看着你。
// 2. 光标在它附近忙活一阵(说明你在那块区域干活):它自己走开,让出地方。
const HOVER_INTENT = 0.1, SHY_AFTER = 1.2, SHY_COOLDOWN = 6;
let hoverSince = 0, permSince = 0, interactive = false, passthrough = false;
let nearSince = 0, lastShy = -99;
window.pet?.onCursor(p => {
  const now = nowSec();
  const moved = p.x !== cursor.x || p.y !== cursor.y;
  if (moved) cursor.at = now;
  cursor.x = p.x; cursor.y = p.y;
  if (moved && targetFps() >= 55) wake();
  if (paused) return;

  const onPet = hitTest(p.x, p.y);
  if (dotsTargets.length) {   // 光标在会话小螃蟹或「!」上(多留 6px 余量):显示每个会话的详情
    const was = dotsHover;
    dotsHover = dotsTargets.some(el => { const r = el.getBoundingClientRect(); return p.x > r.left - 6 && p.x < r.right + 6 && p.y > r.top - 6 && p.y < r.bottom + 6; });
    if (dotsHover && !was) dotsSince = now;
    if (dotsHover && action.type === 'walk') { st.vx = 0; setAction({ type: 'rest', dur: 2.5 }); }   // 在看详情:别走开
  } else dotsHover = false;
  if (permShown) {   // 光标在批准气泡上:变成可点,Clawd 也别走开
    const r = bubble.getBoundingClientRect(), was = permHover;
    permHover = p.x > r.left && p.x < r.right && p.y > r.top && p.y < r.bottom;
    if (permHover && !was) permSince = now;
  } else permHover = false;
  if (onPet && !hovering) hoverSince = now;
  hovering = onPet;
  // 光标停在小螃蟹上也一样变成可点(点一下跳到会话窗口)
  const want = action.type === 'drag' || (!passthrough && ((onPet && now - hoverSince >= HOVER_INTENT) || (dotsHover && now - dotsSince >= HOVER_INTENT) || (permHover && now - permSince >= HOVER_INTENT)));
  if (want !== interactive) {
    interactive = want;
    window.pet.setIgnore(!want);
    if (want && action.type === 'walk') { st.vx = 0; setAction({ type: 'rest', dur: 2.5 }); }
  }
  canvas.classList.toggle('ghost', onPet && !interactive && action.type !== 'drag');

  const px = st.x * S, groundY = Hpx - st.y * S;
  const near = !onPet && !dotsHover && !permHover && st.y < 0.5
    && Math.abs(p.x - px) < BW * S / 2 + 120
    && p.y > groundY - (LEG_L + BH) * S - 140 && p.y < groundY + 40;
  if (!near) nearSince = 0;
  else if (moved && !nearSince) nearSince = now;
  if (near && nearSince && now - nearSince > SHY_AFTER && now - lastShy > SHY_COOLDOWN
      && ['rest', 'walk', 'lean', 'flop', 'present'].includes(action.type)) {
    lastShy = now; nearSince = 0;
    // 往远离光标的一侧走开 8~12 个身位;那边没地方就往另一边
    const dir = p.x / S < st.x ? 1 : -1;
    let tx = st.x + dir * rand(8, 12);
    if (tx < minX() || tx > maxX()) tx = st.x - dir * rand(8, 12);
    setAction({ type: 'walk', target: Math.min(maxX(), Math.max(minX(), tx)) });
  }
});

let press = null;
canvas.addEventListener('pointerdown', e => {
  wake();
  canvas.setPointerCapture(e.pointerId);
  press = { px: e.clientX, py: e.clientY, x0: st.x, y0: st.y, moved: false, last: [e.clientX, e.clientY, performance.now()] , v: [0, 0] };
});
canvas.addEventListener('pointermove', e => {
  if (!press) return;
  const dx = e.clientX - press.px, dy = e.clientY - press.py;
  if (!press.moved && Math.hypot(dx, dy) > 4) {
    press.moved = true;
    if (isClinging()) { window.pet?.setClinging(false); press.x0 = st.x = Math.min(maxX(), Math.max(minX(), st.x)); }
    canvas.classList.add('dragging');
    sfx('pickup');
    setAction({ type: 'drag' });
    st.air = true;
  }
  if (!press.moved) return;
  const now = performance.now();
  const [lx, ly, lt] = press.last;
  const ddt = Math.max(1, now - lt) / 1000;
  // 指数平滑的拖拽速度(世界单位/秒),松手时用来"甩"出去
  press.v[0] = press.v[0] * 0.6 + ((e.clientX - lx) / S / ddt) * 0.4;
  press.v[1] = press.v[1] * 0.6 + (-(e.clientY - ly) / S / ddt) * 0.4;
  press.last = [e.clientX, e.clientY, now];
  press.lastX = e.clientX; pressSide = e.clientX < Wpx / 2 ? -1 : 1;
  const nx = Math.min(maxX(), Math.max(minX(), press.x0 + dx / S));
  const ny = Math.max(0, press.y0 - dy / S);
  st.vx = Math.max(-15, Math.min(15, (nx - st.x) / ddt));
  st.vy = Math.max(-15, Math.min(15, (ny - st.y) / ddt));
  st.x = nx; st.y = ny;
});
let pressSide = 1;
const press_side = () => pressSide;
let pokes = [];
function release() {
  if (!press) return;
  canvas.classList.remove('dragging');
  if (press.moved) {
    const EDGE = 60;
    if (press.lastX <= EDGE || press.lastX >= Wpx - EDGE) {
      press = null;
      startCling(press_side(), st.y + LEG_L);
      return;
    }
    st.vx = Math.max(-14, Math.min(14, press.v[0]));
    st.vy = Math.max(-10, Math.min(14, press.v[1]));
    st.air = st.y > 0.001 || st.vy > 0;
    setAction({ type: 'fall' });
  } else {
    // 1.5 秒内连戳 4 下:不耐烦
    const now = nowSec();
    pokes = pokes.filter(x => now - x < 1.5); pokes.push(now);
    if (pokes.length >= 4) {
      pokes = [];
      hideBubble(); sfx('poke'); say(t('别戳啦！😤'), 2); flashFace('annoyed', 2.5);
      press = null;
      return;
    }
    if (isClinging()) {
      if (bubbleKind === 'usage') hideBubble(); else showUsage();
      action.waveT = 0;
    } else if (bubbleKind === 'usage') {
      hideBubble();
      setAction(mood === 4 ? { type: 'sleep' } : mood >= 2 ? { type: 'wave', dur: 1.6 } : { type: 'jump', dir: 0, big: true });
      if (mood < 2) sfx('jump');
    } else {
      sfx('pop');
      showUsage();
      setAction({ type: 'present', dur: 2.4 });
    }
  }
  press = null;
}
canvas.addEventListener('pointerup', release);
canvas.addEventListener('pointercancel', release);
canvas.addEventListener('lostpointercapture', release);   // 万一丢了指针捕获,也不会卡在"被拎着"的状态

addEventListener('resize', () => { Wpx = innerWidth; Hpx = innerHeight; st.x = Math.min(maxX(), Math.max(minX(), st.x)); });

// ---------------- 主循环 ----------------
const clock = new THREE.Clock();
let nextBlink = 2, blinkT = -1, blinkN = 0;
let idleLook = 0, nextIdleLook = 3;
let landKick = 0;
let curFace = 'normal';
let sweatT = -1, nextSweat = 3;
// 每档的身体颜色:越累越暗淡,额度用完时变成灰色(直接混灰会发脏)
const BODY_COLOR = [0xD97757, 0xD97757, 0xCB7556, 0xB5735F, 0x9A9894].map(c => new THREE.Color(c));
const badge = document.getElementById('badge');
const tmp = new THREE.Vector3();
// Clawd 身体(连同身上的道具)在屏幕上的可见范围(把包围盒投影到屏幕上;贴边时只算露出来的那部分)。
// 血条和气泡都挂在它的顶边中点上,不管是站着还是转过来趴在墙上都对得上。
const bodyBox = new THREE.Box3(), corner = new THREE.Vector3();
let steadyPose = null;   // 不带呼吸的身体姿态,见 frame() 第 4 步
function setBodyPose(x, y, q) {
  bodyG.position.set(x, y, 0);
  bodyG.scale.set(1 / Math.sqrt(q), q, 1 / Math.sqrt(q));
}
function setTransform(el, v) { if (el.dataset.tf !== v) { el.dataset.tf = v; el.style.transform = v; } }   // 没变就不写,省得每帧重排
function petAnchor() {
  const pos = bodyG.position.clone(), scl = bodyG.scale.clone();
  if (steadyPose) setBodyPose(...steadyPose);   // 按不带呼吸的姿态量,量完再放回去
  const an = measureAnchor();
  bodyG.position.copy(pos); bodyG.scale.copy(scl);
  root.updateMatrixWorld(true);
  return an;
}
function measureAnchor() {
  root.updateMatrixWorld(true);
  camera.updateMatrixWorld();
  bodyBox.setFromObject(bodyMesh);
  for (const g of [...Object.values(PROPS), ...Object.values(HOLIDAY)]) if (g.visible) bodyBox.expandByObject(g);   // 戴着帽子等道具时,血条和气泡要让到道具上面
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (let i = 0; i < 8; i++) {
    corner.set(i & 1 ? bodyBox.max.x : bodyBox.min.x, i & 2 ? bodyBox.max.y : bodyBox.min.y, i & 4 ? bodyBox.max.z : bodyBox.min.z).project(camera);
    const sx = canvasLeft + (corner.x + 1) / 2 * CW, sy = canvasTop + (1 - corner.y) / 2 * CH;
    x0 = Math.min(x0, sx); x1 = Math.max(x1, sx); y0 = Math.min(y0, sy); y1 = Math.max(y1, sy);
  }
  x0 = Math.max(0, x0); x1 = Math.min(Wpx, x1);
  return { x: (x0 + x1) / 2, top: y0, left: x0, right: x1, midY: (y0 + y1) / 2 };
}

// ---- 省电:闲着时降帧 ----
// 走路、跳、被拎着、摸它时满帧;站着发呆 / 贴墙时 20 帧,光标在远处动(眼睛要跟着转)30 帧、
// 在它附近动才满帧;睡觉 12 帧。用电池或开了省电模式时上限 30 帧。
let onBattery = false, powerSave = false;
function targetFps() {
  const cap = onBattery || powerSave ? 30 : 60;
  if (press || hovering || st.air || bubbleKind === 'usage' || fx.length || ridersPop.v) return cap;   // 特效在动时满帧
  if (action.type === 'sleep') return 12;
  if (action.type !== 'rest' && action.type !== 'cling') return cap;
  if (nowSec() - cursor.at > 1.5) return 20;
  const near = Math.hypot(cursor.x - (canvasLeft + CW / 2), cursor.y - (canvasTop + CH / 2)) < CW;
  return near ? cap : Math.min(cap, 30);
}
// 满帧时跟着屏幕刷新走;降帧时用定时器隔一段再要下一帧,中间整个渲染进程都能睡着(光跳过帧还是会被每秒唤醒 60 次)
let lastFrameAt = 0, lastErr = '', framePending = false, frameGen = 0, backupTimer = 0;
// 要下一帧:同一时间最多挂一个,免得出现两条循环。
// 同时挂一个 100ms 的备用定时器:macOS 上透明窗口偶尔(比如屏幕休眠唤醒后)不再触发 requestAnimationFrame,
// 这时由定时器顶上,不会卡死。谁先到算谁,另一个作废。
function requestFrame() {
  if (framePending) return;
  framePending = true;
  const g = ++frameGen;
  const run = now => { if (g !== frameGen) return; frameGen++; framePending = false; clearTimeout(backupTimer); loop(now); };
  requestAnimationFrame(run);
  backupTimer = setTimeout(() => run(performance.now()), 100);
}
function loop(now) {
  if (!looping) return;
  lastFrameAt = performance.now();
  try {
    frame();
  } catch (e) {
    // 某一帧出错也要继续排下一帧,不然 Clawd 会整个卡住(气泡、血条都停在原地)
    const msg = String(e && e.stack || e);
    if (msg !== lastErr) { lastErr = msg; console.error('Clawd 渲染出错', msg); }
    try { renderer.render(scene, camera); } catch {}   // 后半帧被跳过了,至少把 Clawd 画出来
  }
  if (!looping) return;   // frame() 里可能刚收起
  schedule(now);
}
function schedule(now) {
  const fps = targetFps();
  if (fps >= 55) requestFrame();
  else loopTimer = setTimeout(() => { loopTimer = 0; requestFrame(); }, Math.max(0, 1000 / fps - (performance.now() - now) - 8));
}
// 看门狗:万一循环还是断了(超过 2 秒没出新帧),作废排着的帧,重新拉起来
setInterval(() => {
  if (!looping || performance.now() - lastFrameAt < 2000) return;
  console.error('Clawd 主循环停了,重新启动');
  frameGen++; framePending = false; clearTimeout(backupTimer); clearTimeout(loopTimer); loopTimer = 0;
  requestFrame();
}, 1000);
function startLoop() { if (looping) return; looping = true; lastFrameAt = performance.now(); requestFrame(); }
function stopLoop() { looping = false; clearTimeout(loopTimer); }
// 有动静(光标靠近、点、拖、来了提醒)时马上回到满帧,不用等到下一个定时器
function wake() { if (looping && loopTimer) { clearTimeout(loopTimer); loopTimer = 0; requestFrame(); } }

function frame() {
  const dt = Math.min(clock.getDelta(), 1 / 10);
  const t = clock.elapsedTime;
  action.t += dt;
  const a = action, p = a.t;

  // ---- 1. 当前动作给出"目标姿态" ----
  // 累的时候呼吸更慢更深、眼睛半闭
  // 累的时候呼吸更慢更深、眼睛半闭、手耷拉;快没电时还会微微发抖
  const br = mood >= 2 ? Math.sin(t * 1.4) * 0.03 : Math.sin(t * 2.3) * 0.012;
  let bx = 0, by = 0, rz = 0, squash = 1;
  // 呼吸起伏和发抖单独一层,最后才叠到身体上:气泡和血条定位时会把它扣掉,不然它们会跟着一像素一像素地抖
  let breathY = br, breathQ = br;
  let shakeX = mood === 3 ? Math.sin(t * 47) * 0.006 : 0;
  let armRot = [0, 0], armDrop = mood >= 2 ? [0.05 + (mood - 2) * 0.04, 0.05 + (mood - 2) * 0.04] : [0, 0];
  let look = null, eyeOpen = [1, 1, 0.55, 0.4, 0.1][mood], walkDir = 0;
  let footLift = null;                      // 跳舞时直接指定抬脚高度
  let airKick = 0;                          // 被拎起来时的蹬腿幅度

  if (a.type === 'rest') {
    armRot = [Math.sin(t * 1.1) * 0.04, Math.sin(t * 1.1 + 1) * 0.04];
    if (p > a.dur) finish();
  }

  else if (a.type === 'walk') {
    const dx = a.target - st.x;
    walkDir = Math.sign(dx);
    const vmax = 2.3 * [1, 0.85, 0.55, 0.4, 0.4][mood];             // 越累走得越慢
    const v = walkDir * Math.min(vmax, Math.abs(dx) * 2.2 + 0.25);  // 起步、到站自然减速
    st.vx = v;
    st.x += v * dt;
    rz = -v * 0.022;                                                // 往前进方向倾
    look = walkDir;
    // 迈步时身体随之一起一伏
    const swingK = Math.max(0, ...feet.map(f => (f.swing ? Math.sin(Math.PI * Math.min(1, f.swing.k)) : 0)));
    by += swingK * 0.05;
    armRot = feet[0].swing ? [0.14, -0.05] : feet[1].swing ? [-0.05, 0.14] : [0, 0];
    if (Math.abs(dx) < 0.04) { st.vx = 0; finish(); }
  }

  else if (a.type === 'lean') {
    // 官方"张望":0.4s 内身体往一侧挪、抬高、微微倾斜,脚不动,腿被拉长斜过去
    const on = p < a.dur - 0.45;
    if (on) { bx = a.dir * 0.16; by = 0.17; rz = -a.dir * 0.07; look = a.dir; }
    armRot = on ? [a.dir < 0 ? 0.12 : -0.05, a.dir > 0 ? 0.12 : -0.05] : [0, 0];
    if (p > a.dur) finish();
  }

  else if (a.type === 'jump') {
    const CROUCH = 0.13;
    if (!a.launched) {
      // 快速下蹲蓄力,手往下压
      by = -0.16; squash = 0.86; armDrop = [0.12, 0.12]; eyeOpen = 0.6;
      if (p >= CROUCH) {
        a.launched = true;
        st.vy = a.big ? 12.5 : 10;
        st.vx = (a.dir || 0) * 2.6;
        st.air = true;
      }
    } else if (st.air) {
      squash = st.vy > 2 ? 1.1 : 1.0;
      armRot = [0.55, 0.55];
      look = a.dir || 0;
    } else {
      armRot = [-0.1, -0.1];
      if (!a.landedAt) a.landedAt = p;
      if (p - a.landedAt > 0.45) finish();
    }
  }

  else if (a.type === 'wave') {
    // 举起右手挥;身体反方向轻轻摆,左手跟着沉一下(参考官方挥旗动画)
    const k = Math.min(1, p / 0.25);
    const w = Math.sin(p * 11);
    armRot[1] = k < 1 ? -0.15 : 1.25 + w * 0.32;
    bx = k < 1 ? 0.04 : -w * 0.05;
    armDrop[0] = w > 0.3 ? 0.05 : 0;
    rz = 0.03;
    eyeOpen = 0.7;
    if (p > a.dur) finish();
  }

  else if (a.type === 'dance') {
    // 参考官方"踩脚撒彩带":8 帧一循环,每帧 125ms —— 往左歪、举手、往右歪、举手
    const f = Math.floor(p / 0.125) % 8;
    const side = f < 2 ? -1 : f >= 4 && f < 6 ? 1 : 0;
    if (side) {
      rz = -side * 0.11; bx = side * 0.1; by = 0.04;
      footLift = GROUP.map((g, i) => (Math.sign(REST_X[i]) === -side ? 0.17 : 0));   // 抬起另一侧的脚
      armRot = side < 0 ? [-0.1, 0.5] : [0.5, -0.1];
    } else {
      by = 0.16; squash = 1.06;
      armRot = f < 4 ? [1.2, 0.2] : [0.2, 1.2];
      footLift = [0, 0, 0, 0];
    }
    look = -side;
    eyeOpen = 0.75;
    if (p > a.dur) finish();
  }

  else if (a.type === 'drag') {
    // 被拎起来:手乱挥,腿乱蹬,眯着眼,身体随拖动方向晃
    armRot = [0.6 + Math.sin(t * 17) * 0.5, 0.6 + Math.sin(t * 17 + 2) * 0.5];
    rz = Math.max(-0.35, Math.min(0.35, -st.vx * 0.025));
    eyeOpen = 0.35;
    airKick = 1;
    st.vx *= Math.pow(0.02, dt);       // 鼠标停住时速度慢慢归零,腿就会垂下来
    look = 0;
  }

  else if (a.type === 'present') {
    // 双手举起"递上"用量卡片,看着你
    armRot = [0.9 + Math.sin(p * 8) * 0.08, 0.9 + Math.sin(p * 8 + 1) * 0.08];
    by = 0.06; look = 0; eyeOpen = Math.max(eyeOpen, 0.8);
    if (p > a.dur) finish();
  }

  else if (a.type === 'bounce') {
    // 和头顶的小螃蟹玩:蹲一下再往上一顶,把它们颠到半空,再落回头顶
    if (p < 0.14) { by = -0.12; squash = 0.88; armDrop = [0.1, 0.1]; }
    else {
      if (!a.popped) { a.popped = true; ridersPop.v = -320; sfx('pop'); flashFace('joy', 1.1); }
      const k = Math.max(0, 1 - (p - 0.14) / 0.25);
      by = 0.1 * k; squash = 1 + 0.06 * k; armRot = [0.5 * k, 0.5 * k];
    }
    look = 0;
    if (p > 1.2) finish();
  }

  else if (a.type === 'slump') {
    // 测试没过:垂头丧气,身子矮一截,手耷拉着
    const k = Math.min(1, p / 0.3);
    by = -0.07 * k; squash = 1 - 0.07 * k; armRot = [-0.18 * k, -0.18 * k]; armDrop = [0.12 * k, 0.12 * k]; eyeOpen = 0.4; look = 0;
    if (p > a.dur) finish();
  }

  else if (a.type === 'shiver') {
    // 看到 rm -rf:缩成一团直发抖
    by = -0.08; squash = 0.9; shakeX = Math.sin(t * 70) * 0.022; armRot = [-0.22, -0.22]; armDrop = [0.1, 0.1]; look = 0;
    if (p > a.dur) finish();
  }

  else if (a.type === 'stretch') {
    // 伸懒腰:双手举高、身体拉长、眯眼,然后放松
    const k = p < 0.5 ? p / 0.5 : p < a.dur - 0.6 ? 1 : Math.max(0, (a.dur - p) / 0.6);
    const e = k * k * (3 - 2 * k);
    armRot = [1.5 * e, 1.5 * e];
    armDrop = [-0.7 * e, -0.7 * e];   // 手臂短,光转不够高:整只往上提,举过头顶
    squash = 1 + 0.12 * e; by = 0.06 * e;
    rz = Math.sin(p * 2.2) * 0.04 * e;
    eyeOpen = 1 - 0.85 * e;
    if (p > a.dur) finish();
  }

  else if (a.type === 'flop') {
    // 趴下打盹:身体沉下去(脚不动,腿被压短),眼睛闭上,手耷拉着,呼吸起伏
    by = -LEG_L * 0.5; breathY = Math.sin(t * 1.2) * 0.025; breathQ = 0;
    squash = 0.95; eyeOpen = 0.06; armRot = [-0.28, -0.28]; look = 0;
    if (p > 0.8 && !a.said && bubbleKind === null) { a.said = true; say('Zzz…', Math.min(3, a.dur - 1), 'chat'); }
    if (p > a.dur) finish();
  }

  else if (a.type === 'cling') {
    // 扒在墙上偷看:光标靠近 / 能点时多探出来一点;累了就闭眼趴着
    const wantPeek = interactive || hovering || bubbleKind ? CLING_PEEK : 0;
    peek += (wantPeek - peek) * Math.min(1, dt * 6);
    st.x = a.side < 0 ? -CLING_HIDE + peek : Wpx / S + CLING_HIDE - peek;
    st.y = a.y; st.vx = st.vy = 0;
    armRot = [-0.15, -0.15];
    if (a.waveT !== undefined) {                       // 被点了:探出来招招手
      a.waveT += dt;
      armRot[a.side < 0 ? 1 : 0] = 1.0 + Math.sin(a.waveT * 11) * 0.3;
      if (a.waveT > 1.6) delete a.waveT;
    }
    look = interactive ? null : -a.side;               // 平时朝屏幕里面看
    if (mood === 4) eyeOpen = 0.06;
  }

  else if (a.type === 'sleep') {
    // 额度用完 / 你离开电脑:趴着睡,直到额度恢复 / 你回来
    by = -LEG_L * 0.55; breathY = Math.sin(t * 0.9) * 0.03; breathQ = 0;
    squash = 0.94; eyeOpen = 0.06; armRot = [-0.32, -0.32]; look = 0;
    if (!a.nextZ) a.nextZ = 1.5;
    if (p > a.nextZ) { a.nextZ = p + 14; if (bubbleKind === null) say('Zzz…', 3, 'chat'); }
    if (mood < 4 && !userAway && p > 1) finish();
  }

  else if (a.type === 'leave') {
    if (p < 0.14) { by = -0.16; squash = 0.85; armDrop = [0.12, 0.12]; eyeOpen = 0.6; }
    else {
      if (!a.launched) { a.launched = true; st.vy = 9; st.vx = 0; st.air = true; sfx('leave'); }
      const k = Math.min(1, (p - 0.14) / 0.42);
      root.scale.setScalar(Math.max(0.001, 1 - k * k));
      root.rotation.y = k * Math.PI * 2;
      armRot = [1, 1];
      if (k >= 1 && !paused) {
        paused = true;
        stopLoop();
        renderer.clear();
        window.pet?.hiddenDone();
        return;
      }
    }
  }

  else if (a.type === 'fall') {
    armRot = [0.7, 0.7];
    eyeOpen = 0.5;
    if (!st.air) { if (!a.landedAt) a.landedAt = p; armRot = [-0.1, -0.1]; if (p - a.landedAt > 0.6) finish(); }
  }

  // ---- 2. 物理:空中受重力,撞到屏幕左右边缘会弹回 ----
  if (st.air && a.type !== 'drag') {
    st.vy -= G * dt;
    st.x += st.vx * dt;
    st.y += st.vy * dt;
    const wallHit = st.x < minX() ? -1 : st.x > maxX() ? 1 : 0;
    if (wallHit && (a.wantCling || Math.abs(st.vx) > 9) && a.type !== 'drag') {
      startCling(wallHit, st.y + LEG_L);
    } else {
      if (st.x < minX()) { st.x = minX(); st.vx = Math.abs(st.vx) * 0.5; }
      if (st.x > maxX()) { st.x = maxX(); st.vx = -Math.abs(st.vx) * 0.5; }
    }
    if (st.y <= 0) {
      const impact = -st.vy;
      st.y = 0;
      if (impact > 13) { st.vy = impact * 0.28; st.vx *= 0.6; dizzyUntil = t + 1.8; }   // 摔得重会弹一下,还会晕一会
      else { st.vy = 0; st.vx = 0; st.air = false; }
      // 落地:身体压扁后果冻回弹,手往下"弹"一下
      sp.squash.x = Math.max(0.68, 1 - impact * 0.02); sp.squash.v = 0;
      sp.armDrop[0].v += impact * 0.08; sp.armDrop[1].v += impact * 0.08;
      landKick = 1;
      if (impact > 13) sfx('bonk'); else if (a.type === 'fall' && impact > 4) sfx('land');
    }
  }
  if (!st.air && a.type !== 'walk') st.vx = 0;

  // ---- 3. 眼睛看哪:光标在附近就看光标,否则随机张望 ----
  const eyeWorld = { x: st.x + sp.bx.x, y: st.y + LEG_L + sp.by.x + EYE_Y };
  const cwx = cursor.x / S, cwy = (Hpx - cursor.y) / S;
  const near = Math.hypot(cwx - eyeWorld.x, cwy - eyeWorld.y) < 10;
  let lx = 0, ly = 0;
  if (look !== null && !(near && a.type === 'rest')) { lx = look; }
  else if (near) {
    lx = Math.max(-1, Math.min(1, (cwx - eyeWorld.x) / 3));
    ly = Math.max(-1, Math.min(1, (cwy - eyeWorld.y) / 3));
  } else {
    if (t > nextIdleLook) { idleLook = idleLook ? 0 : (Math.random() < 0.5 ? -1 : 1); nextIdleLook = t + rand(1.5, 4); }
    lx = idleLook;
  }

  // ---- 4. 弹簧求解,摆好身体 ----
  const BX = sp.bx.step(bx, dt), BY = sp.by.step(by, dt), RZ = sp.rz.step(rz, dt);
  const Q = sp.squash.step(squash, dt);
  setBodyPose(BX + shakeX, LEG_L + BY + breathY, Q + breathQ);
  bodyG.rotation.z = RZ;
  steadyPose = [BX, LEG_L + BY, Q];
  arms.forEach((arm, i) => {
    arm.g.rotation.z = arm.s * sp.armRot[i].step(armRot[i], dt);    // > 0:外端抬起
    arm.g.position.y = ARM_Y - sp.armDrop[i].step(armDrop[i], dt);
  });
  root.position.set(st.x, st.y, 0);
  // 注意用 action(当前动作)而不是 a:撞墙贴上的那一帧,a 还是之前的 fall,没有 side
  const rzTarget = isClinging() ? action.side * Math.PI / 2 : 0;
  root.rotation.z += (rzTarget - root.rotation.z) * Math.min(1, dt * 10);
  if (!Number.isFinite(root.rotation.z)) root.rotation.z = rzTarget;   // 兜底:防止一次异常值让 Clawd 永久消失
  bodyG.updateMatrix();

  // ---- 5. 脚:落地时钉住、按需迈步;在空中时挂在髋下面晃荡 ----
  const hips = REST_X.map(rx => tmp.set(rx, 0.12, 0).applyMatrix4(bodyG.matrix).clone().add(root.position));
  feet.forEach((f, i) => {
    if (isClinging()) { f.x = st.x + REST_X[i]; f.y = st.y; f.vx = f.vy = 0; f.swing = null; return; }
    const hip = hips[i];
    if (st.air) {
      f.swing = null;
      const kick = airKick * Math.sin(t * 16 + i * 1.7) * 0.22;
      const lag = Math.max(-0.22, Math.min(0.22, st.vx * 0.03));      // 拖拽时脚向后甩,但有上限
      const tx = hip.x - lag + kick;
      const ty = hip.y - LEG_L * 0.95 + airKick * Math.abs(Math.sin(t * 16 + i * 1.7)) * 0.1;
      const w = 2 * Math.PI * 3.2, z = 0.35;
      f.vx += (-w * w * (f.x - tx) - 2 * z * w * f.vx) * dt;
      f.vy += (-w * w * (f.y - ty) - 2 * z * w * f.vy) * dt;
      f.x += f.vx * dt; f.y += f.vy * dt;
      // 腿长约束:在空中腿只能在 0.85~1.08 倍原长之间伸缩,甩得再快也不会被拉长
      let dx = f.x - hip.x, dy = f.y - hip.y;
      const len = Math.hypot(dx, dy) || 1e-6;
      const cl = Math.min(LEG_L * 1.08, Math.max(LEG_L * 0.85, len));
      if (cl !== len) {
        f.x = hip.x + dx / len * cl; f.y = hip.y + dy / len * cl;
        // 去掉沿腿方向的速度分量,保留摆动
        const nx = dx / len, ny = dy / len, vn = f.vx * nx + f.vy * ny;
        f.vx -= vn * nx; f.vy -= vn * ny;
      }
      f.y = Math.max(0, f.y);
      return;
    }
    f.vx = f.vy = 0;
    const home = st.x + REST_X[i];
    if (footLift) {                                   // 跳舞:原地跺脚
      f.swing = null;
      f.x += (home - f.x) * Math.min(1, dt * 12);
      f.y += (footLift[i] - f.y) * Math.min(1, dt * 22);
      return;
    }
    if (f.swing) {
      const s = f.swing;
      s.k += dt / STEP_T;
      const k = Math.min(1, s.k), e = k * k * (3 - 2 * k);
      const to = walkDir ? st.x + REST_X[i] + walkDir * 0.2 : home;   // 落脚点跟着身体走
      f.x = s.fx + (to - s.fx) * e;
      f.y = s.fy * (1 - e) + Math.sin(Math.PI * k) * STEP_H;
      if (k >= 1) { f.swing = null; f.y = 0; }
      return;
    }
    if (f.y > 0) f.y = Math.max(0, f.y - dt * 3);
    const target = walkDir ? home + walkDir * 0.2 : home;
    const reach = walkDir ? 0.22 : 0.07;
    const otherGroupBusy = feet.some((g, j) => g.swing && GROUP[j] !== GROUP[i]);
    if ((Math.abs(f.x - target) > reach || f.y > 0.02) && !otherGroupBusy) f.swing = { k: 0, fx: f.x, fy: f.y };
  });

  // 腿 = 从脚连到髋的柱子(顶端插进身体一点,不露缝)
  legs.forEach((m, i) => {
    const fx = feet[i].x - st.x, fy = feet[i].y - st.y;
    const hip = hips[i];
    let dx = hip.x - st.x - fx, dy = hip.y - st.y - fy;
    const L = Math.hypot(dx, dy);
    m.position.set(fx, fy, 0);
    m.rotation.z = Math.atan2(-dx, dy);
    m.scale.y = L + 0.1;
  });

  // ---- 6. 眼睛 + 眨眼 ----
  const EX = sp.eyeX.step(lx, dt), EY = sp.eyeY.step(ly, dt);
  if (t > nextBlink && blinkT < 0) { blinkT = t; blinkN = Math.random() < 0.3 ? 2 : 1; }
  let blink = 1;
  if (blinkT >= 0) {
    const b = (t - blinkT) / 0.15;
    blink = b < 1 ? Math.abs(1 - 2 * b) * 0.9 + 0.1 : 1;
    if (b >= 1.5) { if (--blinkN > 0) blinkT = t; else { blinkT = -1; nextBlink = t + rand(2, 5); } }
  }
  // 当前表情:由动作决定(跳舞时有一定概率戴墨镜)
  let face = 'normal';
  const petting = hovering && interactive && !press && nowSec() - hoverSince > 2.5;   // 光标停在身上不动 = 在摸它
  if (petting && !a.purred) { a.purred = true; sfx('purr'); if (!bubbleKind) say(tr('嘿嘿～ 好舒服 💗'), 2.5); }
  if (a.type === 'drag') face = 'surprised';
  else if (t < dizzyUntil) face = 'dizzy';
  else if (faceOverride && t < faceOverrideUntil) face = faceOverride;
  else if (petting) face = 'love';
  else if (a.type === 'dance') { if (a.cool === undefined) a.cool = Math.random() < 0.4; face = a.face || (a.cool ? 'cool' : 'happy'); }
  else if (a.type === 'jump' && a.big) face = 'happy';
  else if (a.type === 'wave' || a.type === 'present') face = mood >= 2 ? 'normal' : 'joy';
  else if (a.type === 'rest' && mood < 2) {
    // 闲着时偶尔眨一只眼
    if (a.winkAt === undefined) a.winkAt = Math.random() < 0.18 ? rand(0.3, 1.2) : -1;
    if (a.winkAt >= 0 && p > a.winkAt && p < a.winkAt + 0.55) face = 'wink';
  }
  if (face !== curFace) { curFace = face; setFace(face); }

  // 当前道具:跟着动作/场景走,每段动作开始时决定一次
  if (a.prop === undefined) {
    const h = new Date().getHours();
    const coding = ccHooks ? ccWorking() : usage && usage.lastActive && Date.now() - usage.lastActive < 3 * 60e3;
    a.prop = null;
    if (a.type === 'sleep') a.prop = 'nightcap';
    else if (a.type === 'dance') a.prop = a.face === 'star' ? 'party' : a.cool ? null : (Math.random() < 0.45 ? 'headphones' : Math.random() < 0.5 ? 'party' : null);
    else if (a.type === 'rest' && mood < 3 && coding && (ccHooks || Math.random() < 0.55)) a.prop = 'laptop';   // 连上 hooks 后:Claude 在干活就一定抱着电脑
    else if (a.type === 'rest' && mood < 3 && h >= 6 && h < 11 && Math.random() < 0.4) a.prop = 'coffee';
  }
  let want = propOverride && t < propOverrideUntil ? propOverride : a.prop;
  if (dotList.length && HAT_PROPS.includes(want)) want = null;   // 头顶趴着小螃蟹:不戴帽子,免得压住它们
  if (want !== curProp) { curProp = want; setProp(want); }
  const hol = holidayOn ? holidayForce || holidayToday() : null;
  const wantHol = hol && !(HOLIDAY[hol] && hol !== 'scarf' && HAT_PROPS.includes(curProp)) && !isClinging() ? hol : null;
  if (wantHol !== curHoliday) { curHoliday = wantHol; for (const [k, g] of Object.entries(HOLIDAY)) g.visible = k === wantHol; }
  eyes.forEach(e => {
    e.g.position.x = e.s * EYE_X + EX * 0.16;
    e.g.position.y = EYE_Y + EY * 0.09;
    const s = Math.min(blink, eyeOpen);
    e.m.scale.y = s;
    for (const k of ['happy', 'joy', 'love', 'star']) e.faces[k].scale.y = Math.max(0.2, blink);   // 像素表情也跟着眨眼
    e.m.position.y = -(1 - s) * EYE * 0.3;
  });

  // ---- 7. 相机 / 灯光 / 影子 跟随,画布挪到 Clawd 所在的屏幕位置 ----
  const aim = tmp.set(st.x, st.y + AIM_Y, 0);
  camera.position.copy(aim).addScaledVector(CAM_DIR, 20);
  camera.lookAt(aim);
  sun.position.set(st.x - 2, 9, 4); sun.target.position.set(st.x, 0, 0);
  rim.position.set(st.x + 3, 4, -5); rim.target.position.set(st.x, 1, 0);
  shadowPlane.position.set(st.x, 0, 0);
  shadowPlane.material.opacity = isClinging() ? 0 : 0.18 * Math.max(0, 1 - st.y / 8);

  canvasLeft = Math.round(st.x * S - CW / 2);
  canvasTop = Math.round(Hpx - st.y * S - (CH - GROUND_PX));
  canvas.style.transform = `translate(${canvasLeft}px, ${canvasTop}px)`;

  // ---- 8. 汗珠:忙时偶尔、累时经常从额头侧边滑下来 ----
  if (mood > 0 && mood < 4 && sweatT < 0 && t > nextSweat && a.type !== 'drag' && a.type !== 'sleep') sweatT = t;
  if (sweatT >= 0) {
    const k = (t - sweatT) / 1.1;
    sweat.position.set(BW / 2 - 0.28, BH * 0.92 - k * 0.5, BD / 2 + 0.04);
    sweatMat.opacity = k < 0.15 ? k / 0.15 : Math.max(0, 1 - (k - 0.15) / 0.85);
    if (k >= 1) { sweatT = -1; sweatMat.opacity = 0; nextSweat = t + [0, rand(5, 9), rand(2, 4), rand(1, 2.5), 99][mood]; }
  }

  // ---- 9. 身体颜色随档位渐变 ----
  orange.color.lerp(BODY_COLOR[mood], Math.min(1, dt * 2));

  // ---- 10. 头顶血条:格子 = 5 小时额度,旁边的小圆环 = 本周额度。有额度数据就常驻(气泡开着时让位) ----
  const L = usage && usage.limits;
  if (hovering || dotsHover) { hpHoverUntil = t + 1.5; hpFromDots = dotsHover; }   // 悬停模式:移开后再停 1.5 秒(在看小螃蟹详情时也别收起)
  updateFx(dt);
  updateRiders();
  const hpOn = hpMode === 'always' || (hpMode === 'hover' && t < hpHoverUntil);
  hpUsage = hpOn && L && (L.fiveHour || L.sevenDay) && !bubbleKind && !paused ? L : null;
  if (hpUsage && !(dotList.length && (dotsHover || (hpFromDots && t < hpHoverUntil)))) {   // 在看小螃蟹详情时,用量并进详情框里,不单独显示(移开后也别再单独冒出来)
    const vert = isClinging();
    const { html, hl } = usageHTML(L, vert, t < hpHoverUntil);   // 鼠标悬停时(移开后 1.5 秒内)把两个百分比都显示出来
    if (badge.dataset.key !== html) { badge.dataset.key = html; badge.innerHTML = html; }
    const cls = 'show lv' + hl + (vert ? ' vert' : '');
    if (badge.className !== cls) badge.className = cls;
    const bw = badge.offsetWidth, bh = badge.offsetHeight, an = petAnchor();
    // 站着:挂在头顶;贴边:露出来的身体太窄,挂到身体朝屏幕里的那一侧
    const bx = isClinging() ? (action.side > 0 ? an.left - bw - 10 - ridersSide : an.right + 10 + ridersSide) : an.x - bw / 2;
    const by = isClinging() ? an.midY - bh / 2 : petTop(an) - bh - 8;   // 头上趴着螃蟹时挂到它们上面
    setTransform(badge, `translate(${Math.round(Math.min(Wpx - bw - 8, Math.max(8, bx)))}px, ${Math.round(Math.min(Hpx - bh - 8, Math.max(8, by)))}px)`);
  } else if (badge.classList.contains('show')) {
    badge.classList.remove('show');   // 只去掉 show,保留竖排等样式,淡出时不会从竖条跳成横条
  }

  updateDots();
  chatter();

  // ---- 11. 头顶气泡跟着 Clawd 走,不超出屏幕 ----
  if (bubbleKind && nowSec() > bubbleUntil) hideBubble();
  if (bubbleKind) {
    const bw = bubble.offsetWidth, bh = bubble.offsetHeight, an = petAnchor(), px = an.x;
    const left = Math.round(Math.min(Wpx - bw - 8, Math.max(8, px - bw / 2)));
    const top = Math.round(Math.max(8, petTop(an) - bh - (bubbleKind === 'chat' ? 30 : bubbleKind === 'say' ? 18 : 14)));   // 心里话下面挂着两颗小方块,要多让一点
    setTransform(bubble, `translate(${left}px, ${top}px)`);
    const tail = `${Math.min(bw - 18, Math.max(18, px - left))}px`;
    if (bubble.dataset.tail !== tail) { bubble.dataset.tail = tail; bubble.style.setProperty('--tail', tail); }
  }

  renderer.render(scene, camera);
}
startLoop();
