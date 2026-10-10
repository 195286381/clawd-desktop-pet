// 主循环和省电降帧
import { prefs, state } from './state.js';
import { nowSec } from './util.js';
import { CH, CW, camera, renderer, scene } from './scene.js';
import { cursor, st } from './world.js';
import { bubbleKind } from './bubble.js';
import { fx, ridersPop } from './fx.js';
import { action } from './behavior.js';
import { frame } from './animation.js';

let looping = false, loopTimer = 0;   // 主循环状态,见「省电」

// ---------------- 主循环 ----------------
// ---- 省电:闲着时降帧 ----
// 走路、跳、被拎着、摸它时满帧;站着发呆 / 贴墙时 20 帧,光标在远处动(眼睛要跟着转)30 帧、
// 在它附近动才满帧;睡觉 12 帧。用电池或开了省电模式时上限 30 帧。

export function targetFps() {
  const cap = prefs.onBattery || prefs.powerSave ? 30 : 60;
  if (state.press || state.hovering || st.air || bubbleKind === 'usage' || fx.length || ridersPop.v) return cap;   // 特效在动时满帧
  if (action.type === 'sleep') return 12;
  if (action.type !== 'rest' && action.type !== 'cling') return cap;
  if (nowSec() - cursor.at > 1.5) return 20;
  const near = Math.hypot(cursor.x - (state.canvasLeft + CW / 2), cursor.y - (state.canvasTop + CH / 2)) < CW;
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
export function startLoop() { if (looping) return; looping = true; lastFrameAt = performance.now(); requestFrame(); }
export function stopLoop() { looping = false; clearTimeout(loopTimer); }
// 有动静(光标靠近、点、拖、来了提醒)时马上回到满帧,不用等到下一个定时器
export function wake() { if (looping && loopTimer) { clearTimeout(loopTimer); loopTimer = 0; requestFrame(); } }
