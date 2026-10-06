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

// ---------------- 画布与相机 ----------------
const S = 40;                      // 1 个世界单位 = 40 屏幕像素
const CW = 340, CH = 340;          // 跟着 Clawd 走的小画布
const GROUND_PX = 70;              // Clawd 脚底在画布里离底边的距离
const YAW = 0.34, PITCH = 0.2;     // 略微侧着、俯视一点,露出侧面和顶面

const canvas = document.getElementById('c');
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

// ---------------- 模型(尺寸取自官方动画的比例) ----------------
const U = 0.33;                   // 一条腿的宽度
const BW = 7.7 * U, BH = 4.5 * U, BD = 3.0 * U;
const LEG_L = 2.1 * U, LEG_W = U;
const EYE = 0.85 * U;
const EYE_X = BW / 2 - 1.55 * U, EYE_Y = BH * 0.58;
const ARM_Y = BH * 0.6, ARM_OUT = 1.0 * U, ARM_H = 1.9 * U, ARM_TUCK = 0.35;
const REST_X = [0, 1.91, 4.82, 6.73].map(e => -BW / 2 + (e + 0.5) * U);   // 四条腿的 x
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
box(bodyG, orange, [0, BH / 2, 0], [BW, BH, BD], 0.06);

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
  box(g, orange, [s * (ARM_OUT - ARM_TUCK) / 2, 0, 0], [ARM_OUT + ARM_TUCK, ARM_H, BD * 0.62], 0.05);
  return { g, s };
});

const legGeo = new RoundedBoxGeometry(LEG_W, 1, LEG_W, 2, 0.03);
legGeo.translate(0, 0.5, 0);             // 底端在原点,沿 +y 伸长
const legs = REST_X.map(() => {
  const m = new THREE.Mesh(legGeo, orange);
  m.castShadow = true;
  root.add(m);
  return m;
});

// 汗珠:用量多的时候从额头侧边滑下来
const sweatMat = new THREE.MeshStandardMaterial({ color: 0x8fd3ff, roughness: 0.1, transparent: true, opacity: 0 });
const sweat = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 12), sweatMat);
sweat.scale.set(0.09, 0.13, 0.06);
bodyG.add(sweat);

// ---------------- 弹簧 ----------------
class Spring {
  constructor(x, freq, zeta) { this.x = x; this.v = 0; this.w = 2 * Math.PI * freq; this.z = zeta; }
  step(target, dt) {
    const a = -this.w * this.w * (this.x - target) - 2 * this.z * this.w * this.v;
    this.v += a * dt; this.x += this.v * dt;
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

// ---------------- 用量 & 心情 ----------------
// 心情由当前 5 小时窗口的估算花费(美元)决定:低于 MOOD_BUSY 精神饱满,超过 MOOD_TIRED 就累了
const MOOD_BUSY = 8, MOOD_TIRED = 25;
const MOOD_NAME = ['精神饱满', '有点忙', '累了'];
let usage = null, mood = 0;

const bubble = document.getElementById('bubble');
const nowSec = () => performance.now() / 1000;
let bubbleUntil = 0, bubbleKind = null;
function say(html, secs, kind = 'say') {
  bubble.innerHTML = html;
  bubble.classList.add('show');
  bubbleUntil = nowSec() + secs;
  bubbleKind = kind;
}
function hideBubble() { bubble.classList.remove('show'); bubbleKind = null; }

const fmtCost = c => '$' + (c >= 100 ? c.toFixed(0) : c.toFixed(2));
function fmtTokens(n) {
  if (n >= 1e8) return (n / 1e8).toFixed(2) + ' 亿';
  if (n >= 1e4) return Math.round(n / 1e4) + ' 万';
  return String(n);
}
function usageHtml(u) {
  if (!u) return '<div class="title">正在统计用量…</div>';
  if (!u.week.messages) return '<div class="title">最近 7 天还没用过 Claude Code</div>';
  const row = (k, v, note) => `<div class="row"><span>${k}</span><b>${v}</b><i>${note}</i></div>`;
  let html = '<div class="title">Claude Code 用量</div>';
  html += row('今天', fmtCost(u.today.cost), fmtTokens(u.today.tokens) + ' tokens');
  if (u.block) {
    const h = Math.floor(u.block.remainingMin / 60), m = u.block.remainingMin % 60;
    html += row('5 小时窗口', fmtCost(u.block.cost), `还剩 ${h ? h + ' 小时 ' : ''}${m} 分`);
  } else {
    html += row('5 小时窗口', '—', '当前没有进行中的窗口');
  }
  html += row('近 7 天', fmtCost(u.week.cost), fmtTokens(u.week.tokens) + ' tokens');
  const models = Object.entries(u.byModel).sort((a, b) => b[1].cost - a[1].cost);
  if (models.length && u.today.cost > 0) {
    html += '<div class="models">' + models.slice(0, 3)
      .map(([k, v]) => `${k} ${Math.round(v.cost / u.today.cost * 100)}%`).join(' · ') + '</div>';
  }
  html += `<div class="foot">按 API 价格估算 · Clawd 现在${MOOD_NAME[mood]}</div>`;
  return html;
}
function showUsage() {
  window.pet?.requestUsage();
  say(usageHtml(usage), 8, 'usage');
}

let usageInit = false;
window.pet?.onUsage(u => {
  usage = u;
  const c = u.block ? u.block.cost : 0;
  const m = c >= MOOD_TIRED ? 2 : c >= MOOD_BUSY ? 1 : 0;
  // 心情变差时主动冒一句(启动时的第一次不算)
  if (usageInit && m > mood && !paused && bubbleKind !== 'usage') {
    say(m === 2 ? '这 5 小时用得好凶…有点累了 💦' : '忙起来啦 💦', 4);
  }
  mood = m;
  usageInit = true;
  if (bubbleKind === 'usage') bubble.innerHTML = usageHtml(usage);   // 气泡开着时实时刷新
});

// ---------------- 行为 ----------------
let action = { type: 'rest', t: 0, dur: 1.5 };
const rand = (a, b) => a + Math.random() * (b - a);

function pickAction() {
  if (!wander) return { type: 'rest', dur: 3 };
  const r = Math.random();
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
  return { type: 'rest', dur: rand(2, 5) };
}
function setAction(a) { action = { t: 0, ...a }; }
function finish() { setAction(action.type === 'rest' ? pickAction() : { type: 'rest', dur: rand(1.5, 4) }); }

let paused = false;
window.pet?.onCommand(cmd => {
  if (cmd === 'minimize') {
    if (press) { press = null; canvas.classList.remove('dragging'); }
    setAction({ type: 'leave' });
    hideBubble();
    return;
  }
  if (cmd === 'restore') {
    // 从屏幕上方原来的位置掉下来
    paused = false;
    hovering = false;
    root.scale.setScalar(1); root.rotation.y = 0;
    st.y = Hpx / S + 1; st.vx = 0; st.vy = 0; st.air = true;
    feet.forEach((f, i) => { f.x = st.x + REST_X[i]; f.y = st.y - LEG_L; f.vx = f.vy = 0; f.swing = null; });
    setAction({ type: 'fall' });
    clock.getDelta();
    renderer.setAnimationLoop(frame);
    return;
  }
  if (action.type === 'drag' || action.type === 'leave') return;
  if (cmd === 'wander-on') { wander = true; return; }
  if (cmd === 'wander-off') { wander = false; setAction({ type: 'rest', dur: 2 }); return; }
  if (cmd === 'home') { setAction({ type: 'walk', target: Wpx / S / 2 }); return; }
  if (cmd === 'walk') { setAction(pickWalk()); return; }
  if (cmd === 'usage') { showUsage(); setAction({ type: 'present', dur: 2.4 }); return; }
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

window.pet?.onCursor(p => {
  if (p.x !== cursor.x || p.y !== cursor.y) cursor.at = performance.now() / 1000;
  cursor.x = p.x; cursor.y = p.y;
  const hit = action.type === 'drag' || hitTest(p.x, p.y);
  if (hit !== hovering) { hovering = hit; window.pet.setIgnore(!hit); }
  // 鼠标停在它身上:停下脚步看着你(也更容易点中)
  if (hit && action.type === 'walk') { st.vx = 0; setAction({ type: 'rest', dur: 2.5 }); }
});

let press = null;
canvas.addEventListener('pointerdown', e => {
  canvas.setPointerCapture(e.pointerId);
  press = { px: e.clientX, py: e.clientY, x0: st.x, y0: st.y, moved: false, last: [e.clientX, e.clientY, performance.now()] , v: [0, 0] };
});
canvas.addEventListener('pointermove', e => {
  if (!press) return;
  const dx = e.clientX - press.px, dy = e.clientY - press.py;
  if (!press.moved && Math.hypot(dx, dy) > 4) {
    press.moved = true;
    canvas.classList.add('dragging');
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
  const nx = Math.min(maxX(), Math.max(minX(), press.x0 + dx / S));
  const ny = Math.max(0, press.y0 - dy / S);
  st.vx = Math.max(-15, Math.min(15, (nx - st.x) / ddt));
  st.vy = Math.max(-15, Math.min(15, (ny - st.y) / ddt));
  st.x = nx; st.y = ny;
});
function release() {
  if (!press) return;
  canvas.classList.remove('dragging');
  if (press.moved) {
    st.vx = Math.max(-14, Math.min(14, press.v[0]));
    st.vy = Math.max(-10, Math.min(14, press.v[1]));
    st.air = st.y > 0.001 || st.vy > 0;
    setAction({ type: 'fall' });
  } else {
    if (bubbleKind === 'usage') {
      hideBubble();
      setAction(mood === 2 ? { type: 'wave', dur: 1.6 } : { type: 'jump', dir: 0, big: true });
    } else {
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
let sweatT = -1, nextSweat = 3;
const tmp = new THREE.Vector3();

function frame() {
  const dt = Math.min(clock.getDelta(), 1 / 30);
  const t = clock.elapsedTime;
  action.t += dt;
  const a = action, p = a.t;

  // ---- 1. 当前动作给出"目标姿态" ----
  // 累的时候呼吸更慢更深、眼睛半闭
  const br = mood === 2 ? Math.sin(t * 1.4) * 0.03 : Math.sin(t * 2.3) * 0.012;
  let bx = 0, by = br, rz = 0, squash = 1 + br;
  let armRot = [0, 0], armDrop = mood === 2 ? [0.05, 0.05] : [0, 0];
  let look = null, eyeOpen = mood === 2 ? 0.55 : 1, walkDir = 0;
  let footLift = null;                      // 跳舞时直接指定抬脚高度
  let airKick = 0;                          // 被拎起来时的蹬腿幅度

  if (a.type === 'rest') {
    armRot = [Math.sin(t * 1.1) * 0.04, Math.sin(t * 1.1 + 1) * 0.04];
    if (p > a.dur) finish();
  }

  else if (a.type === 'walk') {
    const dx = a.target - st.x;
    walkDir = Math.sign(dx);
    const vmax = 2.3 * [1, 0.85, 0.55][mood];                       // 累了走得慢
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

  else if (a.type === 'flop') {
    // 趴下打盹:身体沉下去(脚不动,腿被压短),眼睛闭上,手耷拉着,呼吸起伏
    by = -LEG_L * 0.5 + Math.sin(t * 1.2) * 0.025;
    squash = 0.95; eyeOpen = 0.06; armRot = [-0.28, -0.28]; look = 0;
    if (p > 0.8 && !a.said && bubbleKind === null) { a.said = true; say('Zzz…', Math.min(3, a.dur - 1)); }
    if (p > a.dur) finish();
  }

  else if (a.type === 'leave') {
    if (p < 0.14) { by = -0.16; squash = 0.85; armDrop = [0.12, 0.12]; eyeOpen = 0.6; }
    else {
      if (!a.launched) { a.launched = true; st.vy = 9; st.vx = 0; st.air = true; }
      const k = Math.min(1, (p - 0.14) / 0.42);
      root.scale.setScalar(Math.max(0.001, 1 - k * k));
      root.rotation.y = k * Math.PI * 2;
      armRot = [1, 1];
      if (k >= 1 && !paused) {
        paused = true;
        renderer.setAnimationLoop(null);
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
    if (st.x < minX()) { st.x = minX(); st.vx = Math.abs(st.vx) * 0.5; }
    if (st.x > maxX()) { st.x = maxX(); st.vx = -Math.abs(st.vx) * 0.5; }
    if (st.y <= 0) {
      const impact = -st.vy;
      st.y = 0;
      if (impact > 13) { st.vy = impact * 0.28; st.vx *= 0.6; }   // 摔得重会弹一下
      else { st.vy = 0; st.vx = 0; st.air = false; }
      // 落地:身体压扁后果冻回弹,手往下"弹"一下
      sp.squash.x = Math.max(0.68, 1 - impact * 0.02); sp.squash.v = 0;
      sp.armDrop[0].v += impact * 0.08; sp.armDrop[1].v += impact * 0.08;
      landKick = 1;
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
  bodyG.position.set(BX, LEG_L + BY, 0);
  bodyG.rotation.z = RZ;
  bodyG.scale.set(1 / Math.sqrt(Q), Q, 1 / Math.sqrt(Q));
  arms.forEach((arm, i) => {
    arm.g.rotation.z = arm.s * sp.armRot[i].step(armRot[i], dt);    // > 0:外端抬起
    arm.g.position.y = ARM_Y - sp.armDrop[i].step(armDrop[i], dt);
  });
  root.position.set(st.x, st.y, 0);
  bodyG.updateMatrix();

  // ---- 5. 脚:落地时钉住、按需迈步;在空中时挂在髋下面晃荡 ----
  const hips = REST_X.map(rx => tmp.set(rx, 0.12, 0).applyMatrix4(bodyG.matrix).clone().add(root.position));
  feet.forEach((f, i) => {
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
  eyes.forEach(e => {
    e.g.position.x = e.s * EYE_X + EX * 0.16;
    e.g.position.y = EYE_Y + EY * 0.09;
    const s = Math.min(blink, eyeOpen);
    e.m.scale.y = s;
    e.m.position.y = -(1 - s) * EYE * 0.3;
  });

  // ---- 7. 相机 / 灯光 / 影子 跟随,画布挪到 Clawd 所在的屏幕位置 ----
  const aim = tmp.set(st.x, st.y + AIM_Y, 0);
  camera.position.copy(aim).addScaledVector(CAM_DIR, 20);
  camera.lookAt(aim);
  sun.position.set(st.x - 2, 9, 4); sun.target.position.set(st.x, 0, 0);
  rim.position.set(st.x + 3, 4, -5); rim.target.position.set(st.x, 1, 0);
  shadowPlane.position.set(st.x, 0, 0);
  shadowPlane.material.opacity = 0.18 * Math.max(0, 1 - st.y / 8);

  canvasLeft = Math.round(st.x * S - CW / 2);
  canvasTop = Math.round(Hpx - st.y * S - (CH - GROUND_PX));
  canvas.style.transform = `translate(${canvasLeft}px, ${canvasTop}px)`;

  // ---- 8. 汗珠:忙时偶尔、累时经常从额头侧边滑下来 ----
  if (mood > 0 && sweatT < 0 && t > nextSweat && a.type !== 'drag') sweatT = t;
  if (sweatT >= 0) {
    const k = (t - sweatT) / 1.1;
    sweat.position.set(BW / 2 - 0.28, BH * 0.92 - k * 0.5, BD / 2 + 0.04);
    sweatMat.opacity = k < 0.15 ? k / 0.15 : Math.max(0, 1 - (k - 0.15) / 0.85);
    if (k >= 1) { sweatT = -1; sweatMat.opacity = 0; nextSweat = t + (mood === 2 ? rand(2, 4) : rand(5, 9)); }
  }

  // ---- 9. 头顶气泡跟着 Clawd 走,不超出屏幕 ----
  if (bubbleKind && nowSec() > bubbleUntil) hideBubble();
  if (bubbleKind) {
    const bw = bubble.offsetWidth, bh = bubble.offsetHeight;
    const px = st.x * S;
    const headY = Hpx - (st.y + LEG_L + BY + BH * Q + 0.2) * S;
    const left = Math.round(Math.min(Wpx - bw - 8, Math.max(8, px - bw / 2)));
    const top = Math.round(Math.max(8, headY - bh - 14));
    bubble.style.transform = `translate(${left}px, ${top}px)`;
    bubble.style.setProperty('--tail', `${Math.min(bw - 18, Math.max(18, px - left))}px`);
  }

  renderer.render(scene, camera);
}
renderer.setAnimationLoop(frame);
