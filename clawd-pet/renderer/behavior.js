// 行为:挑下一个动作、贴边
import { prefs, state } from './state.js';
import { rand } from './util.js';
import { S } from './scene.js';
import { BH, BW, LEG_L } from './model.js';
import { Hpx, maxX, minX, st } from './world.js';
import { mood } from './quota.js';
import { CC_BUSY, ccSessions, ccWorking } from './sessions.js';
import { cmdKind } from './reactions.js';
import { dotList } from './crabs.js';

// ---------------- 贴边 ----------------
// Clawd 侧过身扒在屏幕左/右边缘,大半个身子藏在屏幕外,只露出眼睛偷看;不走动、不挡东西。
// 进入:拖到边缘松手 / 用力甩向边缘 / 菜单「贴到屏幕边上」。离开:把它拖走 / 菜单「离开边缘」。
export const CLING_HIDE = LEG_L + BH * 0.42;   // 藏进屏幕外的深度(从脚底算起)
export const CLING_PEEK = 0.45;                // 光标靠近时多探出来的距离
export const isClinging = () => action.type === 'cling';
export function startCling(side, y) {
  const top = Hpx / S - BW / 2 - 0.3;
  setAction({ type: 'cling', side, y: Math.min(top, Math.max(BW / 2 + 0.3, y)) });
  st.air = false; st.vx = st.vy = 0;
  window.pet?.setClinging(true);
}
export function stopCling() {
  // 从墙上跳下来,回到地面上活动
  const side = action.side;
  st.x = side < 0 ? minX() : maxX();
  st.air = true; st.vx = -side * 3; st.vy = 4;
  setAction({ type: 'fall' });
  window.pet?.setClinging(false);
}

// ---------------- 行为 ----------------
export let action = { type: 'rest', t: 0, dur: 1.5 };

// Claude 这会儿在干什么(取最近有动静、还在忙的那个会话):决定抱电脑敲键盘、托腮、举放大镜、戴眼镜、拿扳手、系围裙
const TYPING = ['Edit', 'MultiEdit', 'Write', 'NotebookEdit'], SEARCH = ['Grep', 'Glob'], READING = ['Read', 'WebFetch', 'WebSearch'];
export const LONG_RUN = 10 * 60e3;   // 一轮任务跑这么久算"憋大招"
export function ccNow() {
  if (!prefs.ccHooks) return null;
  let x = null;
  for (const s of ccSessions.values()) if (CC_BUSY.includes(s.state) && (!x || s.last > x.last)) x = s;
  if (!x) return null;
  const tool = x.state === 'tool' ? x.tool : '', kind = tool === 'Bash' ? cmdKind(x.detail) : '';   // 命令短时 detail 就是命令本身
  return {
    thinking: x.state === 'thinking', typing: TYPING.includes(tool), search: SEARCH.includes(tool), reading: READING.includes(tool),
    building: kind === 'build' || kind === 'install', long: Date.now() - x.started > LONG_RUN,
  };
}
export const lateNight = () => new Date().getHours() < 5;   // 0–5 点还在用:站着打瞌睡

function pickAction() {
  if (state.interactive || state.permShown) return { type: 'rest', dur: 1 };   // 光标停在它身上 / 等你点批准按钮:乖乖待着,方便点
  if (!prefs.wander) return { type: 'rest', dur: 3 };
  const r = Math.random();
  if (mood === 4 || state.userAway) return { type: 'sleep' };     // 额度用完 / 你不在电脑前:睡觉
  if (prefs.ccHooks && ccWorking() && r < 0.65) {   // Claude 在干活:多抱着电脑待着;在想事就托腮,在搜索就举放大镜
    const cc = ccNow();
    if (cc?.thinking && !cc.long) return { type: 'think', dur: rand(4, 7) };
    if (cc?.search) return { type: 'search', dur: rand(4, 7) };
    return { type: 'rest', dur: rand(5, 10) };
  }
  if (mood === 3) {
    // 快没电了:很少走动,大多趴着
    if (r < 0.15) return pickWalk();
    if (r < 0.55) return { type: 'flop', dur: rand(6, 12) };
    if (r < 0.7) return { type: 'nod', dur: rand(4, 6) };
    return { type: 'rest', dur: rand(3, 6) };
  }
  if (mood === 2) {
    // 累了:少走动,不蹦不跳,常趴下打盹
    if (r < 0.3) return pickWalk();
    if (r < 0.5) return { type: 'flop', dur: rand(4, 8) };
    if (r < 0.62) return { type: 'nod', dur: rand(4, 6) };
    if (r < 0.72) return { type: 'lean', dir: Math.random() < 0.5 ? -1 : 1, dur: 2.2 };
    return { type: 'rest', dur: rand(3, 6) };
  }
  if (lateNight() && r >= 0.9) return { type: 'nod', dur: rand(4, 6) };   // 深夜:偶尔站着打瞌睡
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
export function setAction(a) { action = { t: 0, ...a }; }
export function finish() { setAction(action.type === 'rest' ? pickAction() : { type: 'rest', dur: rand(1.5, 4) }); }

export function pickWalk() {
  let tx, n = 0;
  do { tx = rand(minX(), maxX()); } while (Math.abs(tx - st.x) < 3 && ++n < 20);
  return { type: 'walk', target: tx };
}
