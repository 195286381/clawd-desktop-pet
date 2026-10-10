// 每一帧:按当前动作算姿态、物理、脚步、表情、道具,再摆好血条和气泡
import * as THREE from 'three';
import { prefs, state } from './state.js';
import { tr } from './i18n.js';
import { nowSec, rand } from './util.js';
import { AIM_Y, CAM_DIR, CH, CW, GROUND_PX, S, camera, canvas, clock, renderer, rim, scene, shadowPlane, sun } from './scene.js';
import { ARM_Y, BD, BH, BW, EYE, EYE_X, EYE_Y, GROUP, HAT_PROPS, HOLIDAY, LEG_L, MARKS, PROPS, REST_X, WEAR, arms, bodyG, eyes, faceOverride, faceOverrideUntil, flashFace, holidayToday, legs, orange, rainDrops, root, seasonHat, setFace, setProp, setWear, sweat, sweatMat } from './model.js';
import { setBodyPose } from './anchor.js';
import { G, Hpx, STEP_H, STEP_T, Wpx, cursor, feet, maxX, minX, st } from './world.js';
import { sfx } from './sfx.js';
import { bubbleKind, placeBubble, say } from './bubble.js';
import { mood, usage } from './quota.js';
import { updateHud } from './hud.js';
import { chatter } from './chatter.js';
import { ccWorking } from './sessions.js';
import { dotList, updateDots, updateRiders } from './crabs.js';
import { ridersPop, updateFx, updatePack } from './fx.js';
import { CLING_HIDE, CLING_PEEK, action, ccNow, finish, isClinging, setAction, startCling } from './behavior.js';
import { hoverSince } from './input.js';
import { stopLoop } from './loop.js';

let curHoliday = null;
let curProp = null, curWear = null, nextSpin = 0;
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
  squash: new Spring(1, 3.4, 0.3), rx: new Spring(0, 3, 0.6),
  armRot: [new Spring(0, 3.2, 0.42), new Spring(0, 3.2, 0.42)],
  armDrop: [new Spring(0, 5, 0.35), new Spring(0, 5, 0.35)],
  eyeX: new Spring(0, 4, 0.8), eyeY: new Spring(0, 4, 0.8),
};

let peek = 0;
let nextBlink = 2, blinkT = -1, blinkN = 0;
let idleLook = 0, nextIdleLook = 3;
let curFace = 'normal';
let nextSweat = 3;
// 每档的身体颜色:越累越暗淡,额度用完时变成灰色(直接混灰会发脏)
const BODY_COLOR = [0xD97757, 0xD97757, 0xCB7556, 0xB5735F, 0x9A9894].map(c => new THREE.Color(c));
const tmp = new THREE.Vector3();
export let steadyPose = null;   // 不带呼吸的身体姿态,见 frame() 第 4 步
export function frame() {
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
  let rx = 0, lookY = null;                 // 身子前倾(鞠躬、打瞌睡)、眼睛往上 / 下看
  let flipAng = 0, spinY = 0;               // 后空翻的角度、原地转圈的角度
  let typing = false;
  const cc = ccNow();                       // Claude 这会儿在干什么

  if (a.type === 'rest') {
    armRot = [Math.sin(t * 1.1) * 0.04, Math.sin(t * 1.1 + 1) * 0.04];
    if (curProp === 'laptop' && cc?.typing) {
      // Claude 在改文件:双手交替狂敲键盘,盯着屏幕
      const k = Math.sin(t * 19) > 0;
      armRot = k ? [0.3, -0.05] : [-0.05, 0.3]; armDrop = k ? [-0.04, 0.06] : [0.06, -0.04];
      look = 0; lookY = -0.6; typing = true;
    } else if (curProp === 'cook') armRot = [0.35 + Math.sin(t * 3) * 0.05, 0.45 + Math.max(0, Math.sin(t * 5)) * 0.35];   // 一手端锅,一手翻铲
    else if (curProp === 'wrench') armRot[0] = 0.5 + Math.abs(Math.sin(t * 7)) * 0.2;   // 拿扳手敲敲打打
    else if (curProp === 'umbrella') armRot[0] = 0.15;
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
    // 心情好时偶尔被绊一跤
    if (a.tripAt === undefined) a.tripAt = mood <= 1 && Math.abs(dx) > 3 && Math.random() < 0.03 ? rand(0.5, 1.2) : -1;
    if (a.tripAt >= 0 && p > a.tripAt && !st.air) { st.vx = 0; flashFace('surprised', 0.3); setAction({ type: 'trip', dir: walkDir }); }
    else if (Math.abs(dx) < 0.04) { st.vx = 0; finish(); }
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
      if (a.flip) {   // 后空翻:在空中绕身体中心翻一整圈,落地前翻完
        a.airT = (a.airT || 0) + dt;
        const k = Math.min(1, a.airT / 0.62);
        flipAng = Math.PI * 2 * k * k * (3 - 2 * k);
        armRot = [0.9, 0.9];
      }
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
    const wantPeek = state.interactive || state.hovering || bubbleKind ? CLING_PEEK : 0;
    peek += (wantPeek - peek) * Math.min(1, dt * 6);
    st.x = a.side < 0 ? -CLING_HIDE + peek : Wpx / S + CLING_HIDE - peek;
    st.y = a.y; st.vx = st.vy = 0;
    armRot = [-0.15, -0.15];
    if (a.waveT !== undefined) {                       // 被点了:探出来招招手
      a.waveT += dt;
      armRot[a.side < 0 ? 1 : 0] = 1.0 + Math.sin(a.waveT * 11) * 0.3;
      if (a.waveT > 1.6) delete a.waveT;
    }
    look = state.interactive ? null : -a.side;               // 平时朝屏幕里面看
    if (mood === 4) eyeOpen = 0.06;
  }

  else if (a.type === 'sleep') {
    // 额度用完 / 你离开电脑:趴着睡,直到额度恢复 / 你回来
    by = -LEG_L * 0.55; breathY = Math.sin(t * 0.9) * 0.03; breathQ = 0;
    squash = 0.94; eyeOpen = 0.06; armRot = [-0.32, -0.32]; look = 0;
    if (!a.nextZ) a.nextZ = 1.5;
    if (p > a.nextZ) { a.nextZ = p + 14; if (bubbleKind === null) say('Zzz…', 3, 'chat'); }
    if (mood < 4 && !state.userAway && p > 1) finish();
  }

  else if (a.type === 'leave') {
    if (p < 0.14) { by = -0.16; squash = 0.85; armDrop = [0.12, 0.12]; eyeOpen = 0.6; }
    else {
      if (!a.launched) { a.launched = true; st.vy = 9; st.vx = 0; st.air = true; sfx('leave'); }
      const k = Math.min(1, (p - 0.14) / 0.42);
      root.scale.setScalar(Math.max(0.001, 1 - k * k));
      root.rotation.y = k * Math.PI * 2;
      armRot = [1, 1];
      if (k >= 1 && !state.paused) {
        state.paused = true;
        stopLoop();
        renderer.clear();
        window.pet?.hiddenDone();
        return;
      }
    }
  }

  else if (a.type === 'think') {
    // Claude 在想事:右手托着脸,眼睛往上瞟、左右换着看,头顶右上方冒"…"
    armRot = [-0.05, 1.15]; armDrop[1] = -0.15;
    rz = Math.sin(p * 1.1) * 0.04;
    look = Math.sin(p * 0.7) > 0 ? -0.8 : 0.8; lookY = 1;
    if (p > a.dur) finish();
  }

  else if (a.type === 'search') {
    // Claude 在搜索:举着放大镜挡在右眼前,身子左右探着找
    const k = Math.sin(p * 1.3);
    armRot[1] = 0.9; bx = k * 0.12; rz = -k * 0.05; by = Math.max(0, -k) * 0.08;
    look = k > 0.3 ? 0.9 : k < -0.3 ? -0.9 : 0; lookY = -0.3;
    if (p > a.dur) finish();
  }

  else if (a.type === 'trip') {
    // 绊了一跤:往前一扑,趴在地上晕一会儿(头上转小星星),再爬起来
    const d = a.dir || 1;
    if (p < 0.22) { rz = -d * 0.45; bx = d * 0.15; by = 0.05; armRot = [1.1, 1.1]; }
    else if (p < 2.1) {
      if (!a.hit) { a.hit = true; sfx('bonk'); state.dizzyUntil = t + 1.7; }
      by = -LEG_L * 0.75; squash = 0.9; rz = -d * 0.06; armRot = [-0.05, -0.05]; armDrop = [0.22, 0.22];
    }
    look = 0;
    if (p > 2.7) finish();
  }

  else if (a.type === 'nod') {
    // 站着打瞌睡:眼睛快闭上,身子一点一点往前栽,最后猛地惊醒
    if (p < a.dur - 1) {
      const c = (p % 1.7) / 1.7;
      rx = 0.08 + 0.22 * c * c; by = -0.05 - 0.04 * c; eyeOpen = 0.08;
      armRot = [-0.25, -0.25]; armDrop = [0.08, 0.08];
      breathY = Math.sin(t * 1.2) * 0.02; breathQ = 0;
    } else {
      if (!a.woke) { a.woke = true; flashFace('surprised', 0.9); sfx('pop'); }
      by = 0.12; squash = 1.05; armRot = [0.5, 0.5];
    }
    look = 0;
    if (p > a.dur) finish();
  }

  else if (a.type === 'spin') {
    // 被摸得开心:原地转一圈
    const k = Math.min(1, p / 0.9);
    spinY = Math.PI * 2 * k * k * (3 - 2 * k);
    by = 0.12 * Math.sin(Math.PI * k); armRot = [0.8, 0.8]; look = 0;
    if (p > 1.1) finish();
  }

  else if (a.type === 'bow') {
    // 每天第一次见到你:朝你鞠个躬,再挥挥手
    if (p < 1.2) { const k = Math.min(1, p / 0.3); rx = 0.5 * k; by = -0.04 * k; armRot = [-0.25, -0.25]; armDrop = [0.06, 0.06]; }
    else if (p > 1.45) { const w = Math.sin((p - 1.45) * 11); armRot[1] = 1.25 + w * 0.32; bx = -w * 0.05; rz = 0.03; }
    look = 0;
    if (p > 2.6) finish();
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
      if (impact > 13) { st.vy = impact * 0.28; st.vx *= 0.6; state.dizzyUntil = t + 1.8; }   // 摔得重会弹一下,还会晕一会
      else { st.vy = 0; st.vx = 0; st.air = false; }
      // 落地:身体压扁后果冻回弹,手往下"弹"一下
      sp.squash.x = Math.max(0.68, 1 - impact * 0.02); sp.squash.v = 0;
      sp.armDrop[0].v += impact * 0.08; sp.armDrop[1].v += impact * 0.08;
      if (impact > 13) sfx('bonk'); else if (a.type === 'fall' && impact > 4) sfx('land');
    }
  }
  if (!st.air && a.type !== 'walk') st.vx = 0;

  // ---- 3. 眼睛看哪:光标在附近就看光标,否则随机张望 ----
  const eyeWorld = { x: st.x + sp.bx.x, y: st.y + LEG_L + sp.by.x + EYE_Y };
  const cwx = cursor.x / S, cwy = (Hpx - cursor.y) / S;
  const near = Math.hypot(cwx - eyeWorld.x, cwy - eyeWorld.y) < 10;
  let lx = 0, ly = 0;
  if (look !== null && !(near && a.type === 'rest')) { lx = look; if (lookY !== null) ly = lookY; }
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
  // 后空翻绕身体中心转:底面是转轴,所以转的时候把身体挪回去
  setBodyPose(BX + shakeX + Math.sin(flipAng) * BH / 2, LEG_L + BY + breathY + (1 - Math.cos(flipAng)) * BH / 2, Q + breathQ);
  bodyG.rotation.z = RZ + flipAng;
  bodyG.rotation.x = sp.rx.step(rx, dt);
  if (a.type !== 'leave') root.rotation.y = spinY;
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
      // 脚挂在髋"下面";翻跟头时"下面"跟着身体转
      const tx = hip.x - lag + kick + Math.sin(flipAng) * LEG_L * 0.95;
      const ty = hip.y - Math.cos(flipAng) * LEG_L * 0.95 + airKick * Math.abs(Math.sin(t * 16 + i * 1.7)) * 0.1;
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
  const petting = state.hovering && state.interactive && !state.press && nowSec() - hoverSince > 2.5;   // 光标停在身上不动 = 在摸它
  if (petting && !a.purred) { a.purred = true; sfx('purr'); if (!bubbleKind) say(tr('嘿嘿～ 好舒服 💗'), 2.5); }
  if (petting && a.type === 'rest' && nowSec() - hoverSince > 5 && t > nextSpin) { nextSpin = t + 25; setAction({ type: 'spin' }); }   // 摸久了:开心地转一圈
  if (a.type === 'drag') face = 'surprised';
  else if (t < state.dizzyUntil) face = 'dizzy';
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
    const coding = prefs.ccHooks ? ccWorking() : usage && usage.lastActive && Date.now() - usage.lastActive < 3 * 60e3;
    a.prop = null;
    const raining = Date.now() < state.rainUntil && ['rest', 'walk', 'lean', 'flop', 'slump'].includes(a.type);
    if (a.type === 'sleep') a.prop = 'nightcap';
    else if (a.type === 'search') a.prop = 'magnifier';
    else if (raining) a.prop = 'umbrella';   // 测试 / 构建连着失败:撑伞
    else if (a.type === 'dance') a.prop = a.face === 'star' ? 'party' : a.cool ? null : (Math.random() < 0.45 ? 'headphones' : Math.random() < 0.5 ? 'party' : null);
    else if (a.type === 'rest' && mood < 3 && coding && (prefs.ccHooks || Math.random() < 0.55)) a.prop = cc?.long ? 'cook' : cc?.building ? 'wrench' : 'laptop';   // 连上 hooks 后:Claude 在干活就一定抱着电脑(跑了很久系围裙,在构建拿扳手)
    else if (a.type === 'rest' && mood < 3 && h >= 6 && h < 11 && Math.random() < 0.4) a.prop = 'coffee';
  }
  if (a.prop === null && prefs.holidayOn && ['rest', 'walk', 'lean', 'wave', 'jump', 'stretch'].includes(a.type)) {
    // 季节帽子(冬天毛线帽、夏天草帽);戴着节日帽子时不换
    const hol = state.holidayForce || holidayToday();
    if (!hol || hol === 'scarf') a.prop = seasonHat();
  }
  const ov = state.propOverride && t < state.propOverrideUntil ? state.propOverride : null;
  let want = ov && !WEAR[ov] ? ov : Date.now() < state.wrenchUntil && !['sleep', 'search'].includes(a.type) ? 'wrench' : a.prop;
  if (dotList.length && HAT_PROPS.includes(want)) want = null;   // 头顶趴着小螃蟹:不戴帽子,免得压住它们
  if (want !== curProp) { curProp = want; setProp(want); }
  const hol = prefs.holidayOn ? state.holidayForce || holidayToday() : null;
  const wantHol = hol && !(HOLIDAY[hol] && hol !== 'scarf' && HAT_PROPS.includes(curProp)) && !isClinging() ? hol : null;
  if (wantHol !== curHoliday) { curHoliday = wantHol; for (const [k, g] of Object.entries(HOLIDAY)) g.visible = k === wantHol; }
  // 穿戴:push 后背火箭背包,测试连过挂金牌,Claude 在读文件 / 看网页就戴眼镜
  const now = Date.now();
  let wearWant = now < state.jetpackUntil ? 'jetpack' : now < state.medalUntil ? 'medal' : cc?.reading && ['rest', 'think'].includes(a.type) ? 'glasses' : null;
  if (ov && WEAR[ov]) wearWant = ov;
  if (isClinging() || a.type === 'sleep') wearWant = null;
  if (wearWant !== curWear) { curWear = wearWant; setWear(wearWant); }
  // 动作里的小记号
  MARKS.dots.visible = a.type === 'think';
  MARKS.dots.children.forEach((c, i) => { c.visible = (p * 2.2) % 4 > i + 0.5; });   // "…"一个一个冒出来
  MARKS.bang.visible = a.type === 'nod' && !!a.woke;
  MARKS.taps.visible = typing && Math.floor(t * 8) % 2 === 0;
  MARKS.stars.visible = a.type === 'trip' && !!a.hit && p < 2.1;
  MARKS.stars.rotation.y = t * 4;
  if (curProp === 'umbrella') rainDrops.forEach((d, i) => { d.position.y = d.userData.y - ((t * 1.4 + i * 0.37) % 1) * 0.9; });
  if (curProp === 'magnifier') PROPS.magnifier.position.x = eyes[1].g.position.x;
  eyes.forEach(e => {
    const big = curProp === 'magnifier' && e.s > 0 ? 1.6 : 1;   // 放大镜后面的那只眼睛变大
    e.g.scale.set(big, big, 1);
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

  state.canvasLeft = Math.round(st.x * S - CW / 2);
  state.canvasTop = Math.round(Hpx - st.y * S - (CH - GROUND_PX));
  canvas.style.transform = `translate(${state.canvasLeft}px, ${state.canvasTop}px)`;

  // ---- 8. 汗珠:忙时偶尔、累时经常从额头侧边滑下来 ----
  if (mood > 0 && mood < 4 && state.sweatT < 0 && t > nextSweat && a.type !== 'drag' && a.type !== 'sleep') state.sweatT = t;
  if (state.sweatT >= 0) {
    const k = (t - state.sweatT) / 1.1;
    sweat.position.set(BW / 2 - 0.28, BH * 0.92 - k * 0.5, BD / 2 + 0.04);
    sweatMat.opacity = k < 0.15 ? k / 0.15 : Math.max(0, 1 - (k - 0.15) / 0.85);
    if (k >= 1) { state.sweatT = -1; sweatMat.opacity = 0; nextSweat = t + [0, rand(5, 9), rand(2, 4), rand(1, 2.5), 99][mood]; }
  }

  // ---- 9. 身体颜色随档位渐变 ----
  orange.color.lerp(BODY_COLOR[mood], Math.min(1, dt * 2));

  // ---- 10. 头顶血条:格子 = 5 小时额度,旁边的小圆环 = 本周额度。有额度数据就常驻(气泡开着时让位) ----
  updateFx(dt);
  updateRiders();
  updatePack(t);
  const bubbleYield = updateHud(t);
  updateDots();
  chatter();

  // ---- 11. 头顶气泡跟着 Clawd 走,不超出屏幕 ----
  placeBubble(bubbleYield);

  renderer.render(scene, camera);
}
