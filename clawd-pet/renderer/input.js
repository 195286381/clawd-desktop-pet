// 交互:光标、拖拽、点击、穿透、防挡
import * as THREE from 'three';
import { prefs, state } from './state.js';
import { t } from './i18n.js';
import { nearRect, nowSec, rand } from './util.js';
import { CH, CW, S, camera, canvas } from './scene.js';
import { BH, BW, LEG_L, flashFace, root } from './model.js';
import { Hpx, Wpx, cursor, maxX, minX, st } from './world.js';
import { sfx } from './sfx.js';
import { bubble, bubbleKind, hideBubble, say } from './bubble.js';
import { mood, showUsage } from './quota.js';
import { dotList, dotsPick, dotsTip, kbIdx, kbOpen, tipAnchor, tipList } from './crabs.js';
import { action, isClinging, setAction, startCling } from './behavior.js';
import { targetFps, wake } from './loop.js';

// ---------------- 交互:拖拽 / 点击 / 穿透 ----------------
const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();



function hitTest(px, py) {
  const lx = px - state.canvasLeft, ly = py - state.canvasTop;
  if (lx < 0 || ly < 0 || lx > CW || ly > CH) return false;
  ndc.set(lx / CW * 2 - 1, -(ly / CH * 2 - 1));
  raycaster.setFromCamera(ndc, camera);
  // three.js 的射线不管 visible:没戴的帽子、没拿的电脑等藏起来的道具也会被打中,光标在头顶空白处就被当成在身上
  return raycaster.intersectObject(root, true).some(h => { for (let o = h.object; o; o = o.parent) if (!o.visible) return false; return true; });
}

// ---- 防挡 ----
// 1. 光标只是路过时:Clawd 变半透明,点击直接穿透到下面的 App;
//    在它身上停留 HOVER_INTENT 秒才变实、可以点和拖,同时停下脚步看着你。
// 2. 光标在它附近忙活一阵(说明你在那块区域干活):它自己走开,让出地方。
export const HOVER_INTENT = 0.1, SHY_AFTER = 1.2, SHY_COOLDOWN = 6;
export let hoverSince = 0, bubbleSince = 0;
let nearSince = 0, lastShy = -99;
window.pet?.onCursor(p => {
  const now = nowSec();
  const moved = p.x !== cursor.x || p.y !== cursor.y;
  if (moved) cursor.at = now;
  cursor.x = p.x; cursor.y = p.y; cursor.other = !!p.other;   // other:光标在别的屏幕上
  if (moved && targetFps() >= 55) wake();
  if (state.paused) return;

  const onPet = hitTest(p.x, p.y);
  if (tipAnchor) {   // 光标在会话小螃蟹或「!」上(多留 6px 余量),或者在 Clawd 身上停住:显示每个会话的详情(额度在第一行)
    const was = state.dotsMouse, r = tipAnchor;
    const onBody = onPet && state.hovering && now - hoverSince >= HOVER_INTENT;   // 只是路过不算,免得详情一闪
    // 详情开着时,从螃蟹到详情框之间(连同详情框)都算,光标移过去点某一行时详情不会收起
    const span = was && dotsTip.classList.contains('show') && (() => { const d = dotsTip.getBoundingClientRect();
      return { left: Math.min(r.left, d.left), right: Math.max(r.right, d.right), top: Math.min(r.top, d.top), bottom: Math.max(r.bottom, d.bottom) }; })();
    state.dotsMouse = !!(onBody || (dotList.length && nearRect(r, p.x, p.y, 6)) || (span && nearRect(span, p.x, p.y, 6)));
    if (state.dotsMouse && !was) state.dotsSince = now;
    if (state.dotsMouse && action.type === 'walk') { st.vx = 0; setAction({ type: 'rest', dur: 2.5 }); }   // 在看详情:别走开
  } else state.dotsMouse = false;
  state.dotsHover = state.dotsMouse || kbOpen;   // 用键盘挑会话时详情也开着,但光标不在上面就不接收点击
  state.dotsPicked = kbOpen ? tipList[kbIdx]?.[0] ?? null : state.dotsHover ? dotsPick(p.x, p.y) : null;
  document.body.classList.toggle('picking', !!state.dotsPicked);
  if (state.permShown || bubbleKind === 'usage') {   // 光标在批准气泡 / 用量面板上:变成可点,Clawd 也别走开
    const was = state.bubbleHover;
    state.bubbleHover = nearRect(bubble.getBoundingClientRect(), p.x, p.y);
    if (state.bubbleHover && !was) bubbleSince = now;
    if (state.bubbleHover && action.type === 'walk') { st.vx = 0; setAction({ type: 'rest', dur: 2.5 }); }   // 在看面板:别走开
  } else state.bubbleHover = false;
  if (onPet && !state.hovering) hoverSince = now;
  state.hovering = onPet;
  // 光标停在小螃蟹上也一样变成可点(点一下跳到会话窗口)
  const want = action.type === 'drag' || (!prefs.passthrough && ((onPet && now - hoverSince >= HOVER_INTENT) || (state.dotsMouse && now - state.dotsSince >= HOVER_INTENT) || (state.bubbleHover && now - bubbleSince >= HOVER_INTENT)));
  if (want !== state.interactive) {
    state.interactive = want;
    window.pet.setIgnore(!want);
    if (want && action.type === 'walk') { st.vx = 0; setAction({ type: 'rest', dur: 2.5 }); }
  }
  canvas.classList.toggle('ghost', onPet && !state.interactive && action.type !== 'drag');

  const px = st.x * S, groundY = Hpx - st.y * S;
  const near = !onPet && !state.dotsMouse && !state.bubbleHover && st.y < 0.5
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


canvas.addEventListener('pointerdown', e => {
  wake();
  canvas.setPointerCapture(e.pointerId);
  state.press = { px: e.clientX, py: e.clientY, x0: st.x, y0: st.y, moved: false, last: [e.clientX, e.clientY, performance.now()] , v: [0, 0] };
});
canvas.addEventListener('pointermove', e => {
  if (!state.press) return;
  const dx = e.clientX - state.press.px, dy = e.clientY - state.press.py;
  if (!state.press.moved && Math.hypot(dx, dy) > 4) {
    state.press.moved = true;
    if (isClinging()) { window.pet?.setClinging(false); state.press.x0 = st.x = Math.min(maxX(), Math.max(minX(), st.x)); }
    canvas.classList.add('dragging');
    sfx('pickup');
    setAction({ type: 'drag' });
    st.air = true;
  }
  if (!state.press.moved) return;
  const now = performance.now();
  const [lx, ly, lt] = state.press.last;
  const ddt = Math.max(1, now - lt) / 1000;
  // 指数平滑的拖拽速度(世界单位/秒),松手时用来"甩"出去
  state.press.v[0] = state.press.v[0] * 0.6 + ((e.clientX - lx) / S / ddt) * 0.4;
  state.press.v[1] = state.press.v[1] * 0.6 + (-(e.clientY - ly) / S / ddt) * 0.4;
  state.press.last = [e.clientX, e.clientY, now];
  state.press.lastX = e.clientX; pressSide = e.clientX < Wpx / 2 ? -1 : 1;
  const nx = Math.min(maxX(), Math.max(minX(), state.press.x0 + dx / S));
  const ny = Math.max(0, state.press.y0 - dy / S);
  st.vx = Math.max(-15, Math.min(15, (nx - st.x) / ddt));
  st.vy = Math.max(-15, Math.min(15, (ny - st.y) / ddt));
  st.x = nx; st.y = ny;
});
let pressSide = 1;
const press_side = () => pressSide;
let pokes = [];
function release() {
  if (!state.press) return;
  canvas.classList.remove('dragging');
  if (state.press.moved) {
    if (cursor.other) {   // 拖到了别的屏幕上:主进程把窗口搬过去,Clawd 从光标处落下(见 'display:')
      state.press = null;
      st.vx = st.vy = 0; st.air = true;
      setAction({ type: 'fall' });
      window.pet?.dropDisplay();
      return;
    }
    const EDGE = 60;
    if (state.press.lastX <= EDGE || state.press.lastX >= Wpx - EDGE) {
      state.press = null;
      startCling(press_side(), st.y + LEG_L);
      return;
    }
    st.vx = Math.max(-14, Math.min(14, state.press.v[0]));
    st.vy = Math.max(-10, Math.min(14, state.press.v[1]));
    st.air = st.y > 0.001 || st.vy > 0;
    setAction({ type: 'fall' });
  } else {
    // 1.5 秒内连戳 4 下:不耐烦
    const now = nowSec();
    pokes = pokes.filter(x => now - x < 1.5); pokes.push(now);
    if (pokes.length >= 4) {
      pokes = [];
      hideBubble(); sfx('poke'); say(t('别戳啦！😤'), 2); flashFace('annoyed', 2.5);
      state.press = null;
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
  state.press = null;
}
canvas.addEventListener('pointerup', release);
canvas.addEventListener('pointercancel', release);
canvas.addEventListener('lostpointercapture', release);   // 万一丢了指针捕获,也不会卡在"被拎着"的状态
