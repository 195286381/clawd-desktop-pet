// 头顶的会话小螃蟹和悬停时的会话详情
import { prefs, state } from './state.js';
import { esc, fmtElapsed, t } from './i18n.js';
import { nearRect, setTransform } from './util.js';
import { CW, SCALE } from './scene.js';
import { headTopScreen, petAnchor } from './anchor.js';
import { Hpx, Wpx } from './world.js';
import { sfx } from './sfx.js';
import { PX_FRAME, bubbleKind, hideBubble, say } from './bubble.js';
import { hpUsage, usageHTML } from './hud.js';
import { CC_BUSY, ccActivity, ccIcon, ccPurge, ccSessions } from './sessions.js';
import { crabLeave, packTop, ridersPop } from './fx.js';
import { action, isClinging } from './behavior.js';

// ---------------- 会话小螃蟹 & 任务标记「!」 ----------------
// 每个 Claude Code 会话一只像素小螃蟹,不加框直接趴在 Clawd 头顶,跟着它一起转(贴边时侧过来趴在朝屏幕里的头顶上)。颜色表示状态:
// 灰 = 思考中,橙 = 在干活(轻轻颠),红 = 等你批准 / 回复(头顶一个像素「!」,一起蹦),绿 = 刚做完,红 = 出错
// (做完 / 出错的 1 分钟后消失)。光标移到小螃蟹上,列出每个会话在干什么,点螃蟹或详情里的一行跳到那个会话。
const DOT_MAX = 6, DOT_DONE_KEEP = 60e3, RIDERS_MAX = SCALE < 0.6 ? 3 : 4;   // 头顶最多趴 4 只(迷你只有 3 只的地方),多的每个一颗像素点
const DOT_RANK = { ask: 0, waiting: 1, tool: 2, thinking: 3, error: 4, done: 5 };
// 9×5 像素,和菜单栏图标同一个造型;上下文快满时换成胖一圈(≥ 75%)、再胖一圈并冒汗(≥ 90%)的
const CRAB_PX = [
  ['.#######.', '.#.###.#.', '#########', '.#######.', '.#.#.#.#.'],
  ['.#########.', '.#.#####.#.', '###########', '###########', '.#########.', '.#..#.#..#.'],
  ['.###########.', '.#.#######.#.', '#############', '#############', '#############', '.###########.', '.#..#...#..#.'],
];
export const CTX_FAT = 0.75, CTX_FULL = 0.9;
const crabFat = x => (x.ctx >= CTX_FULL ? 2 : x.ctx >= CTX_FAT ? 1 : 0);
export const crabArt = fat => {
  const px = CRAB_PX[fat], w = px[0].length, h = px.length;
  const rects = px.flatMap((row, y) => [...row].map((c, x) => (c === '#' ? `<rect x="${x}" y="${y}" width="1" height="1"/>` : ''))).join('');
  return `<svg class="crab" viewBox="0 0 ${w} ${h}" width="${w * 2}" height="${h * 2}">${rects}</svg>`;
};
const BANG = '<svg class="bang" viewBox="0 0 1 6" width="2" height="12"><rect width="1" height="4"/><rect y="5" width="1" height="1"/></svg>';   // 像素「!」
const DROP = '<svg class="drop" viewBox="0 0 2 3" width="4" height="6"><rect width="1" height="1"/><rect y="1" width="2" height="2"/></svg>';   // 像素汗珠
// 子助手:派出它们的那只背上驮一只 5×3 像素的小螃蟹,不止一个时旁边写像素数字「×2」「×3」
const KID = '<svg class="kid" viewBox="0 0 5 3" width="10" height="6"><path d="M1 0h3v1H1zM0 1h5v1H0zM0 2h1v1H0zM2 2h1v1H2zM4 2h1v1H4z"/></svg>';
const DIGITS = { x: ['...', '#.#', '.#.', '#.#', '...'], 0: ['###', '#.#', '#.#', '#.#', '###'], 1: ['.#.', '##.', '.#.', '.#.', '###'],
  2: ['###', '..#', '###', '#..', '###'], 3: ['###', '..#', '###', '..#', '###'], 4: ['#.#', '#.#', '###', '..#', '..#'], 5: ['###', '#..', '###', '..#', '###'],
  6: ['###', '#..', '###', '#.#', '###'], 7: ['###', '..#', '..#', '..#', '..#'], 8: ['###', '#.#', '###', '#.#', '###'], 9: ['###', '#.#', '###', '..#', '###'] };
const pxText = str => {   // 3×5 像素字,每格 1px,字间空 1px
  const rects = [...str].flatMap((c, k) => DIGITS[c].flatMap((row, y) => [...row].map((p, x) => (p === '#' ? `<rect x="${k * 4 + x}" y="${y}" width="1" height="1"/>` : ''))));
  return `<svg class="kn" viewBox="0 0 ${str.length * 4 - 1} 5" width="${str.length * 4 - 1}" height="5">${rects.join('')}</svg>`;
};
const kidsOf = x => x.agents?.size || 0;
const crabSvg = (state, fat, lift, kids) =>   // 等你的那只头顶一个「!」;快满的那只冒汗;光标指着的那只抬起来;背上驮着子助手
  `<i class="rider st-${state}${lift ? ' lift' : ''}">${state === 'ask' || state === 'waiting' ? BANG : ''}${kids ? `<span class="kids">${KID}${kids > 1 ? pxText('x' + kids) : ''}</span>` : ''}${fat === 2 ? DROP : ''}${crabArt(fat)}</i>`;
export const dotsTip = document.getElementById('dotstip'), ridersEl = document.getElementById('riders');
export let dotList = [], ridersTop = Infinity, ridersSide = 0;
export let tipList = [], tipAnchor = null;   // 会话详情里列的会话(和头顶螃蟹同一批);详情挂在哪(头顶螃蟹那一排,没有螃蟹就是头顶)
let dotsNoteUntil = 0;   // 点了跳不过去的会话时,详情底部的说明显示到什么时候
function dotSessions() {   // 要显示的会话:干活 / 等你的,加上刚做完或出错不到 1 分钟的;等你的排前面
  ccPurge();
  const now = Date.now();
  return [...ccSessions.entries()]
    .filter(([, x]) => CC_BUSY.includes(x.state) || x.state === 'ask' || x.state === 'waiting' || x.compacting || now - x.since < DOT_DONE_KEEP)
    .sort((a, b) => DOT_RANK[a[1].state] - DOT_RANK[b[1].state] || b[1].started - a[1].started)
    .slice(0, DOT_MAX);
}
// 每帧在画血条之前:算出要显示的会话,摆好头顶的小螃蟹(血条和气泡要让到它们上面)
export function updateRiders() {
  // 打开用量面板时先藏起来(面板里本来就列着会话);其他气泡出现时照常显示,气泡会抬到它上面
  const hidden = !prefs.crabsOn || state.paused || bubbleKind === 'usage' || ['drag', 'leave'].includes(action.type);
  dotList = hidden ? [] : dotSessions();
  // 拎着时不显示详情;等你批准的气泡(带按钮)和用量面板开着时也不显示,免得盖住
  tipList = (!prefs.crabsOn && !kbOpen) || state.paused || state.permShown || bubbleKind === 'usage' || ['drag', 'leave'].includes(action.type) ? [] : dotSessions();   // 和头顶螃蟹同一批:螃蟹走了详情里也不列
  const html = dotList.slice(0, RIDERS_MAX).map(([sid, x]) => crabSvg(x.state, crabFat(x), sid === state.dotsPicked, kidsOf(x))).join('')
    + (dotList.length > RIDERS_MAX ? `<span class="pips">${dotList.slice(RIDERS_MAX).map(([, x]) => `<i class="pip st-${x.state}"></i>`).join('')}</span>` : '');
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
const ridersPrev = new Map();   // 上一帧趴在头顶的螃蟹:sid → { state, fat, rect }
function trackLeavers(hidden, rot) {
  if (hidden) { ridersPrev.clear(); return; }
  const cx = state.canvasLeft + CW / 2;
  for (const [sid, p] of ridersPrev)
    if ((p.state === 'done' || p.state === 'error') && !dotList.some(([s]) => s === sid))
      crabLeave(p.state, p.fat, p.rect, Math.sign(p.rect.left + p.rect.width / 2 - cx) || 1);   // 往离 Clawd 远的那边走
  ridersPrev.clear();
  if (rot !== 0) return;
  const els = ridersEl.querySelectorAll('.rider');
  dotList.slice(0, RIDERS_MAX).forEach(([sid, x], i) => { if (els[i]) ridersPrev.set(sid, { state: x.state, fat: crabFat(x), rect: els[i].getBoundingClientRect() }); });
}
// 头顶最高处:身体 / 道具的顶边,头上趴着螃蟹时取螃蟹(连同「!」)的顶边。血条、气泡都挂在它上面
export const petTop = an => Math.min(an.top, ridersTop - 4, packTop - 4);
export function updateDots() {   // 光标停在 Clawd 或小螃蟹上时的会话详情
  if (kbOpen) {   // 用键盘挑会话:详情一直开着,高亮选中的那行;会话都没了 / 15 秒没按键就关掉
    if (!tipList.length || Date.now() > kbUntil) kbClose();
    else { kbIdx = Math.min(kbIdx, tipList.length - 1); state.dotsHover = true; state.dotsPicked = tipList[kbIdx][0]; }
  }
  if (!tipList.length) { tipAnchor = null; state.dotsHover = false; state.dotsPicked = null; dotsTip.classList.remove('show'); return; }
  // 详情挂在头顶那排螃蟹上;没有螃蟹(会话都在等你回复)时挂在头顶,和血条一个位置
  const an = !dotList.length && petAnchor();
  tipAnchor = dotList.length ? ridersEl.getBoundingClientRect() : { left: an.left, right: an.right, top: petTop(an), bottom: an.top, midY: an.midY };
  // 悬停详情:每个会话一行(图标 项目 在干什么 多久),光标可以移进来点
  dotsTip.classList.toggle('show', state.dotsHover);
  if (!state.dotsHover) { state.dotsPicked = null; return; }
  const now = Date.now();
  const u = hpUsage && usageHTML(hpUsage, false, true);
  const html = PX_FRAME + (u ? `<section class="usage lv${u.hl}">${u.html}</section>` : '') + tipList.map(([sid, s], i) => {
    const time = CC_BUSY.includes(s.state) ? fmtElapsed(now - s.started) : fmtElapsed(now - s.since);
    const ctx = s.ctx >= CTX_FAT ? ` · ${t('上下文 {0}%', Math.min(99, Math.round(s.ctx * 100)))}` : '';   // 快满了才显示
    const kids = s.agents?.size ? ` · ${t('{0} 个子助手', s.agents.size)}` : '';
    return `<div class="row st-${s.state}${sid === state.dotsPicked ? ' on' : ''}" data-i="${i}"><span>${ccIcon(s.state)}${esc(s.title || s.project || t('会话'))}</span><b>${esc(ccActivity(s, true) + kids + ctx)}</b><i>${time}</i></div>`;
  }).join('') + (now < dotsNoteUntil ? `<p class="note">${t('还不知道这个会话在哪个窗口，重开一次就能跳了')}</p>`   // 说明写在详情框里(另弹气泡会被详情框挡住),只占一行,框不会变高把行挤走
    : kbOpen ? `<p>${t('↑↓ 选择 · ⏎ 跳过去 · esc 关闭')}</p>`
    : tipList.some(([, s]) => s.app) ? `<p>${t('点一下跳到它的窗口')}</p>` : '');
  if (dotsTip.dataset.html !== html) { dotsTip.dataset.html = html; dotsTip.innerHTML = html; }
  const { left, right, top, bottom } = tipAnchor, cx = (left + right) / 2;
  const tw = dotsTip.offsetWidth, th = dotsTip.offsetHeight;
  let tx = Math.round(Math.min(Wpx - tw - 8, Math.max(8, cx - tw / 2)));
  const below = top - th - 14 < 8;   // 头顶放不下:挂到下面
  let ty = Math.round(below ? bottom + 8 : top - th - 14);   // 底下还挂着像素小尖角,多让一点
  if (isClinging()) {   // 贴边:螃蟹在身体朝屏幕里的那一侧,详情放到它们再往里
    tx = Math.round(action.side > 0 ? left - tw - 8 : right + 8);
    tx = Math.min(Wpx - tw - 8, Math.max(8, tx));
    ty = Math.round(Math.min(Hpx - th - 8, Math.max(8, (tipAnchor.midY ?? (top + bottom) / 2) - th / 2)));
  }
  setTransform(dotsTip, `translate(${tx}px, ${ty}px)`);
  // 和对话框一样的像素外框;挂在头顶时小尖角指着螃蟹 / Clawd,贴边或挂到下面时不要尖角
  const tail = !isClinging() && !below;
  dotsTip.classList.toggle('notail', !tail);
  const tp = tail ? `${Math.round(Math.min(tw - 18, Math.max(18, cx - tx)))}px` : '50%';
  if (dotsTip.dataset.tail !== tp) { dotsTip.dataset.tail = tp; dotsTip.style.setProperty('--tail', tp); }
}

// ⌃⌥⌘C 打开会话详情,用键盘挑:↑ ↓ 选,⏎ 跳过去,Esc 或再按一次 ⌃⌥⌘C 关掉。框开着时主进程才占用这几个键
export let kbOpen = false, kbIdx = 0, kbUntil = 0;
const KB_KEEP = 15e3;
export function kbClose() { if (!kbOpen) return; kbOpen = false; window.pet?.kbNav(false); }
export function kbOpenList() {
  if (kbOpen) { kbClose(); return; }
  if (!dotSessions().length) { say(t('现在没有在跑的会话'), 3); return; }
  if (state.permShown) return;   // 批准气泡开着:先处理它(⌥⌘Y / ⌥⌘N)
  if (bubbleKind === 'usage') hideBubble();
  kbOpen = true; kbIdx = 0; kbUntil = Date.now() + KB_KEEP;
  window.pet?.kbNav(true);
}
export function kbKey(k) {
  if (!kbOpen) return;
  kbUntil = Date.now() + KB_KEEP;
  const n = tipList.length;
  if (k === 'close' || !n) { kbClose(); return; }
  if (k === 'up') kbIdx = (kbIdx - 1 + n) % n;
  else if (k === 'down') kbIdx = (kbIdx + 1) % n;
  else if (k === 'go') {
    const s = ccSessions.get(tipList[kbIdx][0]);
    if (s && jumpSession(s)) kbClose(); else { sfx('poke'); dotsNoteUntil = Date.now() + 4000; }
  }
}

// 点小螃蟹或详情里的一行:跳到这个会话所在的窗口(iTerm / Terminal 精确到标签页,Claude App 精确到会话,其他 App 切到最前面)
export function jumpSession(s) {   // 跳过去了返回 true;旧版 hooks 连的会话不带 App 信息,跳不了
  if (!s.app) return false;
  sfx('pop'); window.pet?.focusSession({ app: s.app, tty: s.tty, host: s.host });
  return true;
}
// 光标下是哪个会话:详情里的那一行,或者头顶的螃蟹(螃蟹很小,按离光标最近的那只算)
export function dotsPick(x, y) {
  const row = document.elementFromPoint(x, y)?.closest('#dotstip [data-i]');
  if (row) return tipList[row.dataset.i]?.[0] ?? null;
  if (!dotList.length || !nearRect(ridersEl.getBoundingClientRect(), x, y, 6)) return null;
  const els = [...ridersEl.querySelectorAll('.rider')];
  if (!els.length) return null;
  const dist = el => { const r = el.getBoundingClientRect(); return Math.hypot(x - (r.left + r.right) / 2, y - (r.top + r.bottom) / 2); };
  return dotList[els.indexOf(els.reduce((a, b) => (dist(b) < dist(a) ? b : a)))]?.[0] ?? null;
}
// 在捕获阶段拦下来,不让 Clawd 本身当成被点了;点在详情框的空白处什么也不做
window.addEventListener('pointerdown', e => {
  if (!state.dotsHover) return;
  const sid = dotsPick(e.clientX, e.clientY);
  if (!sid && !e.target.closest?.('#dotstip')) return;
  e.stopPropagation(); e.preventDefault();
  const s = sid && ccSessions.get(sid);
  if (s && !jumpSession(s)) { sfx('poke'); dotsNoteUntil = Date.now() + 4000; }
}, true);
